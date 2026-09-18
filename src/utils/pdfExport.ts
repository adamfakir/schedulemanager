import { jsPDF } from 'jspdf';
import {
    DAYS,
    ScheduleBlock,
    HoursSummary,
    buildSortedTimes,
    buildStudentScheduleBlocks,
    buildTeacherScheduleBlocks,
    computeTeacherHours,
    cropSemesterTag,
    formatHoursLabel,
    timeToMinutes,
    minutesToTime,
} from './scheduleData';

export type PdfExportProgress = {
    current: number;
    total: number;
    name: string;
};

type RenderOptions = {
    type: 'Student' | 'Teacher';
    name: string;
    blocks: ScheduleBlock[];
    hours?: HoursSummary | null;
    includeHours?: boolean;
    excludeEmptyHours?: boolean;
    hideTeacherNames?: boolean;
    showEndTime?: boolean;
};

const SCALE = 2;
const PX_PER_MINUTE = 1.35;
const MIN_ROW_HEIGHT = 24;
const TIME_COL_WIDTH = 74;
const DAY_COL_WIDTH = 148;
const HEADER_H = 30;
const PAGE_PAD = 24;
const HOURS_WIDTH = 230;
const HOURS_GAP = 18;
const BG = '#e6fcef';
const BLUE = '#4299e1';

const roundRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
) => {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
};

const fillStrokeRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string,
    stroke = '#000',
    radius = 0
) => {
    ctx.fillStyle = fill;
    if (radius > 0) {
        roundRect(ctx, x, y, w, h, radius);
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
    } else {
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
};

/** Wrap text to fit maxWidth — never shrink; break long words if needed. */
const wrapTextToWidth = (
    ctx: CanvasRenderingContext2D,
    text: string,
    maxWidth: number
): string[] => {
    const raw = String(text || '').trim();
    if (!raw) return [];
    if (ctx.measureText(raw).width <= maxWidth) return [raw];

    const words = raw.split(/\s+/);
    const lines: string[] = [];
    let cur = '';

    const pushBrokenWord = (word: string) => {
        let chunk = '';
        for (const ch of word) {
            const next = chunk + ch;
            if (chunk && ctx.measureText(next).width > maxWidth) {
                lines.push(chunk);
                chunk = ch;
            } else {
                chunk = next;
            }
        }
        if (chunk) cur = chunk;
    };

    words.forEach((word) => {
        const next = cur ? `${cur} ${word}` : word;
        if (ctx.measureText(next).width <= maxWidth) {
            cur = next;
            return;
        }
        if (cur) lines.push(cur);
        if (ctx.measureText(word).width <= maxWidth) {
            cur = word;
        } else {
            cur = '';
            pushBrokenWord(word);
        }
    });
    if (cur) lines.push(cur);
    return lines;
};

type StyledLine = { text: string; font: string; lineHeight: number };

/** Draw wrapped, vertically+horizontally centered lines (no text shrinking). */
const drawCenteredStyledLines = (
    ctx: CanvasRenderingContext2D,
    parts: Array<{ text: string; font: string; lineHeight: number }>,
    x: number,
    y: number,
    w: number,
    h: number,
    padX = 8
) => {
    const maxWidth = Math.max(20, w - padX * 2);
    const styled: StyledLine[] = [];

    parts.forEach((part) => {
        const t = String(part.text || '').trim();
        if (!t) return;
        ctx.font = part.font;
        wrapTextToWidth(ctx, t, maxWidth).forEach((line) => {
            styled.push({ text: line, font: part.font, lineHeight: part.lineHeight });
        });
    });

    if (!styled.length) return;

    const totalH = styled.reduce((sum, l) => sum + l.lineHeight, 0);
    let cursorY = y + h / 2 - totalH / 2;
    const cx = x + w / 2;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, w - 2, h - 2);
    ctx.clip();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';

    styled.forEach((line) => {
        const mid = cursorY + line.lineHeight / 2;
        ctx.font = line.font;
        // IMPORTANT: no 4th maxWidth arg — that compresses glyphs instead of wrapping
        ctx.fillText(line.text, cx, mid);
        cursorY += line.lineHeight;
    });
    ctx.restore();
};

/** Draw one or more centered text lines inside a box. */
const drawCenteredLines = (
    ctx: CanvasRenderingContext2D,
    lines: string[],
    x: number,
    y: number,
    w: number,
    h: number,
    opts: { font: string; color?: string; lineHeight?: number; maxWidth?: number }
) => {
    drawCenteredStyledLines(
        ctx,
        lines.map((text) => ({
            text,
            font: opts.font,
            lineHeight: opts.lineHeight || 14,
        })),
        x,
        y,
        w,
        h
    );
};

const blockSubtitle = (
    block: ScheduleBlock,
    type: 'Student' | 'Teacher',
    hideTeacherNames: boolean
): string => {
    if (type === 'Teacher' && block.isMeeting && block.teachers?.length) {
        return block.teachers.map(cropSemesterTag).join(', ');
    }
    if (type === 'Teacher' && block.displayclass) {
        return cropSemesterTag(block.displayclass);
    }
    if (type === 'Student' && !hideTeacherNames && block.teachers?.length) {
        return block.teachers.map(cropSemesterTag).join(', ');
    }
    return '';
};

const blockKey = (block: ScheduleBlock): string =>
    `${block.subjectId}|${block.start.day}|${block.start.time}|${block.end.time}|${block.name}`;

const canShareOverlap = (a: ScheduleBlock, b: ScheduleBlock): boolean => {
    const sameDisplay = !!(a.displayclass && b.displayclass && a.displayclass === b.displayclass);
    const sameSubject = a.subjectId === b.subjectId;
    return !(sameSubject && (sameDisplay || !a.displayclass || !b.displayclass));
};

type OverlapWindow = {
    day: string;
    start: string;
    end: string;
    blocks: ScheduleBlock[];
};

/** Same overlap windows as ScheduleItem (red-outline side-by-side panes). */
const getOverlaps = (blocks: ScheduleBlock[]): OverlapWindow[] => {
    const overlaps: OverlapWindow[] = [];

    DAYS.forEach((day) => {
        const dayBlocks = blocks.filter((block) => block.start.day === day);
        const boundaries = Array.from(
            new Set(
                dayBlocks.flatMap((block) => [
                    timeToMinutes(block.start.time),
                    timeToMinutes(block.end.time),
                ])
            )
        ).sort((a, b) => a - b);

        for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex++) {
            const start = boundaries[boundaryIndex];
            const end = boundaries[boundaryIndex + 1];
            const active = dayBlocks.filter(
                (block) =>
                    timeToMinutes(block.start.time) < end && timeToMinutes(block.end.time) > start
            );
            const overlapping = active.filter((block) =>
                active.some((other) => other !== block && canShareOverlap(block, other))
            );
            if (overlapping.length < 2) continue;

            const previous = overlaps[overlaps.length - 1];
            const sameBlocks =
                previous &&
                previous.day === day &&
                previous.end === minutesToTime(start) &&
                previous.blocks.length === overlapping.length &&
                previous.blocks.every((block, index) => blockKey(block) === blockKey(overlapping[index]));

            if (sameBlocks) {
                previous.end = minutesToTime(end);
            } else {
                overlaps.push({
                    day,
                    start: minutesToTime(start),
                    end: minutesToTime(end),
                    blocks: overlapping,
                });
            }
        }
    });

    return overlaps;
};

const drawBlockLabel = (
    ctx: CanvasRenderingContext2D,
    block: ScheduleBlock,
    type: 'Student' | 'Teacher',
    hideTeacherNames: boolean,
    x: number,
    y: number,
    w: number,
    h: number,
    compact = false
) => {
    const title = cropSemesterTag(block.name);
    const sub = blockSubtitle(block, type, hideTeacherNames);
    const parts = [
        {
            text: title,
            font: compact
                ? 'bold 10px system-ui, -apple-system, sans-serif'
                : 'bold 12px system-ui, -apple-system, sans-serif',
            lineHeight: compact ? 12 : 15,
        },
        ...(sub
            ? [
                  {
                      text: sub,
                      font: compact
                          ? '9px system-ui, -apple-system, sans-serif'
                          : '10px system-ui, -apple-system, sans-serif',
                      lineHeight: compact ? 11 : 13,
                  },
              ]
            : []),
    ];
    drawCenteredStyledLines(ctx, parts, x, y, w, h, compact ? 4 : 8);
};

const drawHoursPanel = (
    ctx: CanvasRenderingContext2D,
    hours: HoursSummary,
    excludeEmpty: boolean,
    x: number,
    y: number
): number => {
    let cy = y;
    ctx.fillStyle = '#000';
    ctx.font = 'bold 14px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Hours', x, cy);
    cy += 22;

    if (excludeEmpty) {
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        ctx.fillStyle = '#4a5568';
        ctx.fillText('Empty time excluded', x, cy);
        cy += 18;
    }

    const totalShown = excludeEmpty ? hours.totalFilled : hours.totalSpan;
    fillStrokeRect(ctx, x, cy, HOURS_WIDTH, 64, '#ebf8ff', '#63b3ed', 8);
    ctx.fillStyle = '#000';
    ctx.font = 'bold 13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Week total', x + 10, cy + 8);
    ctx.font = 'bold 18px system-ui, -apple-system, sans-serif';
    ctx.fillText(formatHoursLabel(totalShown), x + 10, cy + 28);
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#4a5568';
    ctx.fillText(
        excludeEmpty
            ? 'Classes + office only'
            : `Filled ${formatHoursLabel(hours.totalFilled)} · Empty ${formatHoursLabel(hours.totalEmpty)}`,
        x + 10,
        cy + 50
    );
    cy += 74;

    hours.days.forEach((d) => {
        const cardH = d.earliest ? 58 : 42;
        fillStrokeRect(ctx, x, cy, HOURS_WIDTH, cardH, d.earliest ? '#fff' : '#f7fafc', d.earliest ? '#a0aec0' : '#cbd5e0', 8);
        ctx.fillStyle = '#000';
        ctx.font = 'bold 12px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(d.day, x + 10, cy + 8);
        if (!d.earliest) {
            ctx.font = '11px system-ui, -apple-system, sans-serif';
            ctx.fillStyle = '#718096';
            ctx.fillText('No classes', x + 10, cy + 26);
        } else {
            const shown = excludeEmpty ? d.filled : d.span;
            ctx.textAlign = 'right';
            ctx.fillText(formatHoursLabel(shown), x + HOURS_WIDTH - 10, cy + 8);
            ctx.textAlign = 'left';
            ctx.font = '11px system-ui, -apple-system, sans-serif';
            ctx.fillStyle = '#4a5568';
            ctx.fillText(`${d.earliest} – ${d.latest}`, x + 10, cy + 26);
            ctx.fillText(
                excludeEmpty
                    ? `Filled only (empty was ${formatHoursLabel(d.empty)})`
                    : `Filled ${formatHoursLabel(d.filled)} · Empty ${formatHoursLabel(d.empty)}`,
                x + 10,
                cy + 40
            );
        }
        cy += cardH + 8;
    });

    return cy - y;
};

const renderScheduleCanvas = (opts: RenderOptions): HTMLCanvasElement => {
    const sortedTimes = buildSortedTimes(opts.blocks);
    const showEndTime = !!opts.showEndTime;
    const timeColCount = showEndTime ? 2 : 1;
    const showHours = opts.type === 'Teacher' && opts.includeHours && opts.hours;

    const rowHeights = sortedTimes.map((t, i) => {
        if (i >= sortedTimes.length - 1) return Math.max(MIN_ROW_HEIGHT, 24);
        const mins = timeToMinutes(sortedTimes[i + 1]) - timeToMinutes(t);
        return Math.max(MIN_ROW_HEIGHT, mins * PX_PER_MINUTE);
    });

    const rowTops: number[] = [];
    let yCursor = HEADER_H;
    for (let i = 0; i < rowHeights.length; i++) {
        rowTops.push(yCursor);
        yCursor += rowHeights[i];
    }
    const gridH = yCursor;
    const gridW = TIME_COL_WIDTH * timeColCount + DAY_COL_WIDTH * 5;

    const titleBlockH = 32;
    const contentW = gridW + (showHours ? HOURS_GAP + HOURS_WIDTH : 0);
    const hoursH = showHours
        ? 22 + (opts.excludeEmptyHours ? 18 : 0) + 74 + opts.hours!.days.length * 66
        : 0;
    const contentH = Math.max(gridH, hoursH);
    const canvasW = PAGE_PAD * 2 + contentW;
    const canvasH = PAGE_PAD * 2 + titleBlockH + contentH;

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(canvasW * SCALE);
    canvas.height = Math.ceil(canvasH * SCALE);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(SCALE, SCALE);

    // Page background
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Title
    const titleX = PAGE_PAD;
    const titleY = PAGE_PAD;
    ctx.fillStyle = '#000';
    ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${opts.type}: ${opts.name}`, titleX, titleY);

    const gridX = PAGE_PAD;
    const gridY = PAGE_PAD + titleBlockH;

    const dayLeft = (dayIndex: number) => gridX + TIME_COL_WIDTH * timeColCount + dayIndex * DAY_COL_WIDTH;

    // Header row
    const headers = [
        { label: showEndTime ? 'Start' : 'Time', left: gridX, width: TIME_COL_WIDTH, color: '#fff' },
        ...(showEndTime
            ? [{ label: 'End', left: gridX + TIME_COL_WIDTH, width: TIME_COL_WIDTH, color: '#fff' }]
            : []),
        ...DAYS.map((d, i) => ({ label: d, left: dayLeft(i), width: DAY_COL_WIDTH, color: '#000' })),
    ];
    headers.forEach((h) => {
        fillStrokeRect(ctx, h.left, gridY, h.width, HEADER_H, BLUE);
        drawCenteredLines(ctx, [h.label], h.left, gridY, h.width, HEADER_H, {
            font: 'bold 12px system-ui, -apple-system, sans-serif',
            color: h.color,
            lineHeight: 14,
        });
    });

    // Time rows + empty day cells
    sortedTimes.forEach((t, i) => {
        const top = gridY + rowTops[i];
        const height = rowHeights[i];
        const endLabel = i < sortedTimes.length - 1 ? sortedTimes[i + 1] : '—';

        fillStrokeRect(ctx, gridX, top, TIME_COL_WIDTH, height, BLUE);
        drawCenteredLines(ctx, [t], gridX, top, TIME_COL_WIDTH, height, {
            font: 'bold 11px system-ui, -apple-system, sans-serif',
            color: '#000',
            lineHeight: 13,
        });

        if (showEndTime) {
            fillStrokeRect(ctx, gridX + TIME_COL_WIDTH, top, TIME_COL_WIDTH, height, BLUE);
            drawCenteredLines(ctx, [endLabel], gridX + TIME_COL_WIDTH, top, TIME_COL_WIDTH, height, {
                font: 'bold 11px system-ui, -apple-system, sans-serif',
                color: '#000',
                lineHeight: 13,
            });
        }

        DAYS.forEach((_d, dayIndex) => {
            fillStrokeRect(ctx, dayLeft(dayIndex), top, DAY_COL_WIDTH, height, '#fff');
        });
    });

    const timeToRowIndex = new Map(sortedTimes.map((t, i) => [t, i]));
    const resolveEndRowIndex = (endTime: string): number => {
        const exact = timeToRowIndex.get(endTime);
        if (exact !== undefined) return exact;
        const endMin = timeToMinutes(endTime);
        const idx = sortedTimes.findIndex((tm) => timeToMinutes(tm) >= endMin);
        return idx >= 0 ? idx : sortedTimes.length - 1;
    };

    const yForTime = (time: string): number => {
        const idx = timeToRowIndex.get(time);
        if (idx !== undefined) return gridY + rowTops[idx];
        const endIdx = resolveEndRowIndex(time);
        return gridY + rowTops[endIdx];
    };

    const overlaps = getOverlaps(opts.blocks);

    // Solo (non-overlap) segments of each block — full column width
    opts.blocks.forEach((block) => {
        const dayIndex = DAYS.indexOf(block.start.day as any);
        if (dayIndex < 0) return;

        const blockStartMin = timeToMinutes(block.start.time);
        const blockEndMin = timeToMinutes(block.end.time);
        const blockOverlaps = overlaps.filter((ov) =>
            ov.blocks.some((b) => blockKey(b) === blockKey(block))
        );

        const overlapIntervals = blockOverlaps
            .map((ov) => ({
                start: timeToMinutes(ov.start),
                end: timeToMinutes(ov.end),
            }))
            .sort((a, b) => a.start - b.start);

        const merged: Array<{ start: number; end: number }> = [];
        overlapIntervals.forEach((interval) => {
            if (!merged.length || interval.start > merged[merged.length - 1].end) {
                merged.push({ ...interval });
            } else {
                merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, interval.end);
            }
        });

        const soloSegments: Array<{ start: number; end: number }> = [];
        let cursor = blockStartMin;
        merged.forEach((m) => {
            if (cursor < m.start) soloSegments.push({ start: cursor, end: m.start });
            cursor = Math.max(cursor, m.end);
        });
        if (cursor < blockEndMin) soloSegments.push({ start: cursor, end: blockEndMin });

        // If no overlaps at all, draw the whole block once
        if (!merged.length) {
            soloSegments.length = 0;
            soloSegments.push({ start: blockStartMin, end: blockEndMin });
        }

        soloSegments.forEach((seg) => {
            if (seg.end <= seg.start) return;
            const top = yForTime(minutesToTime(seg.start));
            const bottom = yForTime(minutesToTime(seg.end));
            const height = Math.max(MIN_ROW_HEIGHT, bottom - top);
            const left = dayLeft(dayIndex);
            fillStrokeRect(ctx, left, top, DAY_COL_WIDTH, height, block.color || '#38b2ac', '#000', 6);
            drawBlockLabel(ctx, block, opts.type, !!opts.hideTeacherNames, left, top, DAY_COL_WIDTH, height);
        });
    });

    // Overlap windows — red outline, side-by-side panes (like ScheduleItem)
    overlaps.forEach((overlap) => {
        const dayIndex = DAYS.indexOf(overlap.day as any);
        if (dayIndex < 0) return;
        const top = yForTime(overlap.start);
        const bottom = yForTime(overlap.end);
        const height = Math.max(MIN_ROW_HEIGHT, bottom - top);
        const left = dayLeft(dayIndex);
        const n = overlap.blocks.length;
        if (n < 2) return;

        // Outer red border container
        fillStrokeRect(ctx, left, top, DAY_COL_WIDTH, height, '#fff', '#e53e3e', 6);
        // Thicker red stroke
        ctx.save();
        ctx.strokeStyle = '#e53e3e';
        ctx.lineWidth = 3;
        roundRect(ctx, left + 1.5, top + 1.5, DAY_COL_WIDTH - 3, height - 3, 5);
        ctx.stroke();
        ctx.restore();

        const paneW = (DAY_COL_WIDTH - 3) / n;
        overlap.blocks.forEach((overlapBlock, blockIdx) => {
            const paneX = left + 1.5 + blockIdx * paneW;
            const paneY = top + 1.5;
            const paneH = height - 3;
            ctx.fillStyle = overlapBlock.color || '#38b2ac';
            ctx.fillRect(paneX, paneY, paneW, paneH);
            if (blockIdx > 0) {
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(paneX, paneY);
                ctx.lineTo(paneX, paneY + paneH);
                ctx.stroke();
            }
            drawBlockLabel(
                ctx,
                overlapBlock,
                opts.type,
                !!opts.hideTeacherNames,
                paneX,
                paneY,
                paneW,
                paneH,
                true
            );
        });
    });

    if (showHours && opts.hours) {
        drawHoursPanel(
            ctx,
            opts.hours,
            !!opts.excludeEmptyHours,
            gridX + gridW + HOURS_GAP,
            gridY
        );
    }

    return canvas;
};

const addCanvasPage = (pdf: jsPDF, canvas: HTMLCanvasElement) => {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const maxW = pageWidth - margin * 2;
    const maxH = pageHeight - margin * 2;

    const imgW = canvas.width;
    const imgH = canvas.height;
    const ratio = Math.min(maxW / (imgW / SCALE), maxH / (imgH / SCALE));
    // canvas is already scaled; convert CSS-pixel size
    const cssW = imgW / SCALE;
    const cssH = imgH / SCALE;
    const drawW = cssW * ratio;
    const drawH = cssH * ratio;
    const x = (pageWidth - drawW) / 2;
    const y = (pageHeight - drawH) / 2;

    const imgData = canvas.toDataURL('image/jpeg', 0.93);
    pdf.addImage(imgData, 'JPEG', x, y, drawW, drawH);
};

export async function exportEntitiesSchedulesToPdf(params: {
    entities: any[];
    type: 'Student' | 'Teacher';
    subjects: any[];
    teachers?: any[];
    meetings?: any[];
    includeHours?: boolean;
    excludeEmptyHours?: boolean;
    hideTeacherNames?: boolean;
    showEndTime?: boolean;
    onProgress?: (p: PdfExportProgress) => void;
    filename?: string;
}): Promise<void> {
    const {
        entities,
        type,
        subjects,
        teachers = [],
        meetings = [],
        includeHours = false,
        excludeEmptyHours = false,
        hideTeacherNames = false,
        showEndTime = false,
        onProgress,
        filename,
    } = params;

    if (!entities.length) {
        throw new Error(`No ${type.toLowerCase()}s to export`);
    }

    const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
    });

    let firstPage = true;

    for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        const name = entity.displayname || entity.name || 'Untitled';
        onProgress?.({ current: i + 1, total: entities.length, name });

        const entityId = String(entity?._id?.$oid || entity?._id || '');
        const entityMeetings =
            type === 'Teacher'
                ? (meetings || []).filter((m: any) =>
                      (m.teacher_ids || []).map(String).includes(entityId)
                  )
                : [];

        const blocks =
            type === 'Student'
                ? buildStudentScheduleBlocks(entity, subjects, teachers)
                : buildTeacherScheduleBlocks(entity, subjects, entityMeetings);

        const hours =
            type === 'Teacher' && includeHours
                ? computeTeacherHours(entity, subjects, entityMeetings)
                : null;

        const canvas = renderScheduleCanvas({
            type,
            name,
            blocks,
            hours,
            includeHours,
            excludeEmptyHours,
            hideTeacherNames,
            showEndTime,
        });

        if (!firstPage) pdf.addPage();
        firstPage = false;
        addCanvasPage(pdf, canvas);

        // yield so UI can update progress
        await new Promise((r) => setTimeout(r, 0));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const defaultName =
        type === 'Student'
            ? `Student_Schedules_${stamp}.pdf`
            : `Teacher_Schedules_${stamp}.pdf`;
    pdf.save(filename || defaultName);
}
