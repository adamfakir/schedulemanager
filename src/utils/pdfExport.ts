import { jsPDF } from 'jspdf';
import {
    DAYS,
    MON_THU_DAYS,
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
    shouldUseSeparateFridayTimes,
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
const MIN_ROW_HEIGHT = 22;
const TIME_COL_WIDTH = 68;
const DAY_COL_WIDTH = 142;
const HEADER_H = 28;
const PAGE_PAD = 22;
const HOURS_WIDTH = 220;
const HOURS_GAP = 16;
const SECTION_GAP = 10;

/** Soft, professional palette — muted slate instead of bright mint/blue. */
const COLORS = {
    pageBg: '#f4f6f8',
    title: '#1e293b',
    subtitle: '#64748b',
    headerBg: '#3d4f5f',
    headerText: '#ffffff',
    timeBg: '#e8eef2',
    timeText: '#334155',
    dayHeaderBg: '#4a5d6e',
    cellBg: '#ffffff',
    gridStroke: '#c5ced6',
    blockStroke: '#94a3b8',
    bodyText: '#1e293b',
    mutedText: '#64748b',
    hoursCard: '#eef3f7',
    hoursCardStroke: '#b8c5d0',
    hoursAccent: '#dbe7f0',
    hoursAccentStroke: '#8aa4b8',
    overlap: '#b85c5c',
    fridayDivider: '#cbd5e1',
};

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

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
    stroke = COLORS.gridStroke,
    radius = 0,
    lineWidth = 1
) => {
    ctx.fillStyle = fill;
    if (radius > 0) {
        roundRect(ctx, x, y, w, h, radius);
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    } else {
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
};

/** Soften harsh subject colors for print — mix toward white and lightly desaturate. */
const softenColor = (hex: string, whiteMix = 0.32): string => {
    const raw = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(raw)) return '#c5d4dc';
    let r = parseInt(raw.slice(0, 2), 16);
    let g = parseInt(raw.slice(2, 4), 16);
    let b = parseInt(raw.slice(4, 6), 16);
    // Pull toward grayscale a bit so neon colors calm down
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const satPull = 0.22;
    r = Math.round(r * (1 - satPull) + gray * satPull);
    g = Math.round(g * (1 - satPull) + gray * satPull);
    b = Math.round(b * (1 - satPull) + gray * satPull);
    const mix = (c: number) => Math.round(c * (1 - whiteMix) + 255 * whiteMix);
    const toHex = (c: number) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0');
    return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
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
    padX = 8,
    color = COLORS.bodyText
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
    ctx.fillStyle = color;

    styled.forEach((line) => {
        const mid = cursorY + line.lineHeight / 2;
        ctx.font = line.font;
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
    opts: { font: string; color?: string; lineHeight?: number }
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
        h,
        6,
        opts.color || COLORS.bodyText
    );
};

const namesMatch = (a: string, b: string): boolean =>
    cropSemesterTag(a).trim().toLowerCase() === cropSemesterTag(b).trim().toLowerCase();

const blockSubtitle = (
    block: ScheduleBlock,
    type: 'Student' | 'Teacher',
    hideTeacherNames: boolean,
    currentTeacherName?: string
): string => {
    if (type === 'Teacher' && block.isMeeting) {
        const attendees = block.teachers || [];
        // Large meetings: title only (no attendee list)
        if (attendees.length > 4) return '';
        const others = currentTeacherName
            ? attendees.filter((t) => !namesMatch(t, currentTeacherName))
            : attendees;
        return others.map(cropSemesterTag).join(', ');
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
    compact = false,
    currentTeacherName?: string
) => {
    const title = cropSemesterTag(block.name);
    const sub = blockSubtitle(block, type, hideTeacherNames, currentTeacherName);
    const parts = [
        {
            text: title,
            font: compact ? `600 10px ${FONT}` : `600 12px ${FONT}`,
            lineHeight: compact ? 12 : 15,
        },
        ...(sub
            ? [
                  {
                      text: sub,
                      font: compact ? `9px ${FONT}` : `10px ${FONT}`,
                      lineHeight: compact ? 11 : 13,
                  },
              ]
            : []),
    ];
    drawCenteredStyledLines(ctx, parts, x, y, w, h, compact ? 4 : 7);
};

const drawHoursPanel = (
    ctx: CanvasRenderingContext2D,
    hours: HoursSummary,
    excludeEmpty: boolean,
    x: number,
    y: number
): number => {
    let cy = y;
    ctx.fillStyle = COLORS.title;
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Hours summary', x, cy);
    cy += 20;

    if (excludeEmpty) {
        ctx.font = `10px ${FONT}`;
        ctx.fillStyle = COLORS.mutedText;
        ctx.fillText('Empty time excluded', x, cy);
        cy += 16;
    }

    const totalShown = excludeEmpty ? hours.totalFilled : hours.totalSpan;
    fillStrokeRect(ctx, x, cy, HOURS_WIDTH, 60, COLORS.hoursAccent, COLORS.hoursAccentStroke, 8);
    ctx.fillStyle = COLORS.title;
    ctx.font = `600 12px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Week total', x + 12, cy + 8);
    ctx.font = `600 17px ${FONT}`;
    ctx.fillText(formatHoursLabel(totalShown), x + 12, cy + 26);
    ctx.font = `10px ${FONT}`;
    ctx.fillStyle = COLORS.mutedText;
    ctx.fillText(
        excludeEmpty
            ? 'Classes + office only'
            : `Filled ${formatHoursLabel(hours.totalFilled)} · Empty ${formatHoursLabel(hours.totalEmpty)}`,
        x + 12,
        cy + 46
    );
    cy += 70;

    hours.days.forEach((d) => {
        const cardH = d.earliest ? 54 : 40;
        fillStrokeRect(
            ctx,
            x,
            cy,
            HOURS_WIDTH,
            cardH,
            d.earliest ? COLORS.cellBg : COLORS.hoursCard,
            COLORS.hoursCardStroke,
            7
        );
        ctx.fillStyle = COLORS.title;
        ctx.font = `600 11px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(d.day, x + 12, cy + 8);
        if (!d.earliest) {
            ctx.font = `10px ${FONT}`;
            ctx.fillStyle = COLORS.mutedText;
            ctx.fillText('No classes', x + 12, cy + 24);
        } else {
            const shown = excludeEmpty ? d.filled : d.span;
            ctx.textAlign = 'right';
            ctx.fillStyle = COLORS.title;
            ctx.fillText(formatHoursLabel(shown), x + HOURS_WIDTH - 12, cy + 8);
            ctx.textAlign = 'left';
            ctx.font = `10px ${FONT}`;
            ctx.fillStyle = COLORS.mutedText;
            ctx.fillText(`${d.earliest} – ${d.latest}`, x + 12, cy + 24);
            ctx.fillText(
                excludeEmpty
                    ? `Filled only (empty was ${formatHoursLabel(d.empty)})`
                    : `Filled ${formatHoursLabel(d.filled)} · Empty ${formatHoursLabel(d.empty)}`,
                x + 12,
                cy + 38
            );
        }
        cy += cardH + 7;
    });

    return cy - y;
};

type TimeAxis = {
    times: string[];
    rowTops: number[];
    rowHeights: number[];
    gridH: number;
    timeToRowIndex: Map<string, number>;
    resolveEndRowIndex: (endTime: string) => number;
    yForTime: (time: string, gridY: number) => number;
};

const buildTimeAxis = (blocks: ScheduleBlock[]): TimeAxis => {
    const times = buildSortedTimes(blocks);
    const rowHeights = times.map((t, i) => {
        if (i >= times.length - 1) return Math.max(MIN_ROW_HEIGHT, 22);
        const mins = timeToMinutes(times[i + 1]) - timeToMinutes(t);
        return Math.max(MIN_ROW_HEIGHT, mins * PX_PER_MINUTE);
    });
    const rowTops: number[] = [];
    let yCursor = HEADER_H;
    for (let i = 0; i < rowHeights.length; i++) {
        rowTops.push(yCursor);
        yCursor += rowHeights[i];
    }
    const timeToRowIndex = new Map(times.map((t, i) => [t, i]));
    const resolveEndRowIndex = (endTime: string): number => {
        const exact = timeToRowIndex.get(endTime);
        if (exact !== undefined) return exact;
        const endMin = timeToMinutes(endTime);
        const idx = times.findIndex((tm) => timeToMinutes(tm) >= endMin);
        return idx >= 0 ? idx : times.length - 1;
    };
    return {
        times,
        rowTops,
        rowHeights,
        gridH: yCursor,
        timeToRowIndex,
        resolveEndRowIndex,
        yForTime: (time: string, gridY: number) => {
            const idx = timeToRowIndex.get(time);
            if (idx !== undefined) return gridY + rowTops[idx];
            return gridY + rowTops[resolveEndRowIndex(time)];
        },
    };
};

/** Draw a Time / Start / End column against a given axis. */
const drawTimeColumns = (
    ctx: CanvasRenderingContext2D,
    axis: TimeAxis,
    gridX: number,
    gridY: number,
    showEndTime: boolean,
    headerLabel: string
) => {
    const cols = showEndTime ? 2 : 1;
    // Header
    for (let c = 0; c < cols; c++) {
        const label = showEndTime ? (c === 0 ? 'Start' : 'End') : headerLabel;
        fillStrokeRect(
            ctx,
            gridX + c * TIME_COL_WIDTH,
            gridY,
            TIME_COL_WIDTH,
            HEADER_H,
            COLORS.headerBg,
            COLORS.gridStroke
        );
        drawCenteredLines(ctx, [label], gridX + c * TIME_COL_WIDTH, gridY, TIME_COL_WIDTH, HEADER_H, {
            font: `600 11px ${FONT}`,
            color: COLORS.headerText,
            lineHeight: 13,
        });
    }

    axis.times.forEach((t, i) => {
        const top = gridY + axis.rowTops[i];
        const height = axis.rowHeights[i];
        const endLabel = i < axis.times.length - 1 ? axis.times[i + 1] : '—';

        fillStrokeRect(ctx, gridX, top, TIME_COL_WIDTH, height, COLORS.timeBg, COLORS.gridStroke);
        drawCenteredLines(ctx, [t], gridX, top, TIME_COL_WIDTH, height, {
            font: `600 10px ${FONT}`,
            color: COLORS.timeText,
            lineHeight: 12,
        });

        if (showEndTime) {
            fillStrokeRect(
                ctx,
                gridX + TIME_COL_WIDTH,
                top,
                TIME_COL_WIDTH,
                height,
                COLORS.timeBg,
                COLORS.gridStroke
            );
            drawCenteredLines(ctx, [endLabel], gridX + TIME_COL_WIDTH, top, TIME_COL_WIDTH, height, {
                font: `600 10px ${FONT}`,
                color: COLORS.timeText,
                lineHeight: 12,
            });
        }
    });
};

const drawDayHeadersAndCells = (
    ctx: CanvasRenderingContext2D,
    days: readonly string[],
    dayLeft: (dayIndex: number) => number,
    gridY: number,
    axis: TimeAxis
) => {
    days.forEach((d, i) => {
        fillStrokeRect(ctx, dayLeft(i), gridY, DAY_COL_WIDTH, HEADER_H, COLORS.dayHeaderBg, COLORS.gridStroke);
        drawCenteredLines(ctx, [d], dayLeft(i), gridY, DAY_COL_WIDTH, HEADER_H, {
            font: `600 11px ${FONT}`,
            color: COLORS.headerText,
            lineHeight: 13,
        });
    });

    axis.times.forEach((_t, i) => {
        const top = gridY + axis.rowTops[i];
        const height = axis.rowHeights[i];
        days.forEach((_d, dayIndex) => {
            fillStrokeRect(ctx, dayLeft(dayIndex), top, DAY_COL_WIDTH, height, COLORS.cellBg, COLORS.gridStroke);
        });
    });
};

const drawBlocksOnAxis = (
    ctx: CanvasRenderingContext2D,
    blocks: ScheduleBlock[],
    days: readonly string[],
    dayLeft: (dayIndex: number) => number,
    gridY: number,
    axis: TimeAxis,
    type: 'Student' | 'Teacher',
    hideTeacherNames: boolean,
    currentTeacherName?: string
) => {
    const overlaps = getOverlaps(blocks);
    const daySet = new Set(days as readonly string[]);

    blocks.forEach((block) => {
        if (!daySet.has(block.start.day)) return;
        const dayIndex = (days as readonly string[]).indexOf(block.start.day);
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
        if (!merged.length) {
            soloSegments.push({ start: blockStartMin, end: blockEndMin });
        } else {
            let cursor = blockStartMin;
            merged.forEach((m) => {
                if (cursor < m.start) soloSegments.push({ start: cursor, end: m.start });
                cursor = Math.max(cursor, m.end);
            });
            if (cursor < blockEndMin) soloSegments.push({ start: cursor, end: blockEndMin });
        }

        const fill = softenColor(block.color || '#9fb6c0');
        soloSegments.forEach((seg) => {
            if (seg.end <= seg.start) return;
            const top = axis.yForTime(minutesToTime(seg.start), gridY);
            const bottom = axis.yForTime(minutesToTime(seg.end), gridY);
            const height = Math.max(MIN_ROW_HEIGHT, bottom - top);
            const left = dayLeft(dayIndex);
            fillStrokeRect(ctx, left, top, DAY_COL_WIDTH, height, fill, COLORS.blockStroke, 5);
            drawBlockLabel(
                ctx,
                block,
                type,
                hideTeacherNames,
                left,
                top,
                DAY_COL_WIDTH,
                height,
                false,
                currentTeacherName
            );
        });
    });

    overlaps.forEach((overlap) => {
        if (!daySet.has(overlap.day)) return;
        const dayIndex = (days as readonly string[]).indexOf(overlap.day);
        if (dayIndex < 0) return;
        const top = axis.yForTime(overlap.start, gridY);
        const bottom = axis.yForTime(overlap.end, gridY);
        const height = Math.max(MIN_ROW_HEIGHT, bottom - top);
        const left = dayLeft(dayIndex);
        const n = overlap.blocks.length;
        if (n < 2) return;

        fillStrokeRect(ctx, left, top, DAY_COL_WIDTH, height, COLORS.cellBg, COLORS.overlap, 5, 1.5);
        ctx.save();
        ctx.strokeStyle = COLORS.overlap;
        ctx.lineWidth = 2;
        roundRect(ctx, left + 1, top + 1, DAY_COL_WIDTH - 2, height - 2, 4);
        ctx.stroke();
        ctx.restore();

        const paneW = (DAY_COL_WIDTH - 2) / n;
        overlap.blocks.forEach((overlapBlock, blockIdx) => {
            const paneX = left + 1 + blockIdx * paneW;
            const paneY = top + 1;
            const paneH = height - 2;
            ctx.fillStyle = softenColor(overlapBlock.color || '#9fb6c0');
            ctx.fillRect(paneX, paneY, paneW, paneH);
            if (blockIdx > 0) {
                ctx.strokeStyle = COLORS.blockStroke;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(paneX, paneY);
                ctx.lineTo(paneX, paneY + paneH);
                ctx.stroke();
            }
            drawBlockLabel(
                ctx,
                overlapBlock,
                type,
                hideTeacherNames,
                paneX,
                paneY,
                paneW,
                paneH,
                true,
                currentTeacherName
            );
        });
    });
};

const renderScheduleCanvas = (opts: RenderOptions): HTMLCanvasElement => {
    const showEndTime = !!opts.showEndTime;
    const showHours = opts.type === 'Teacher' && opts.includeHours && opts.hours;
    const splitFriday = shouldUseSeparateFridayTimes(opts.blocks);
    const timeCols = showEndTime ? 2 : 1;

    const monThuBlocks = opts.blocks.filter((b) =>
        (MON_THU_DAYS as readonly string[]).includes(b.start.day)
    );
    const fridayBlocks = opts.blocks.filter((b) => b.start.day === 'Friday');

    const mainAxis = splitFriday
        ? buildTimeAxis(monThuBlocks.length ? monThuBlocks : opts.blocks)
        : buildTimeAxis(opts.blocks);
    const fridayAxis = splitFriday ? buildTimeAxis(fridayBlocks.length ? fridayBlocks : opts.blocks) : null;

    const mainDays = splitFriday ? MON_THU_DAYS : DAYS;
    const mainGridW = TIME_COL_WIDTH * timeCols + DAY_COL_WIDTH * mainDays.length;
    const fridayGridW = splitFriday && fridayAxis
        ? TIME_COL_WIDTH * timeCols + DAY_COL_WIDTH
        : 0;
    const gridW = mainGridW + (splitFriday ? SECTION_GAP + fridayGridW : 0);
    const gridH = Math.max(mainAxis.gridH, fridayAxis?.gridH || 0);

    const titleBlockH = 34;
    const contentW = gridW + (showHours ? HOURS_GAP + HOURS_WIDTH : 0);
    const hoursH = showHours
        ? 20 + (opts.excludeEmptyHours ? 16 : 0) + 70 + opts.hours!.days.length * 61
        : 0;
    const contentH = Math.max(gridH, hoursH);
    const canvasW = PAGE_PAD * 2 + contentW;
    const canvasH = PAGE_PAD * 2 + titleBlockH + contentH;

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(canvasW * SCALE);
    canvas.height = Math.ceil(canvasH * SCALE);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(SCALE, SCALE);

    // Soft page background
    ctx.fillStyle = COLORS.pageBg;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // Subtle top accent bar
    ctx.fillStyle = COLORS.headerBg;
    ctx.fillRect(0, 0, canvasW, 4);

    // Title
    const titleX = PAGE_PAD;
    const titleY = PAGE_PAD + 4;
    ctx.fillStyle = COLORS.title;
    ctx.font = `700 20px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${opts.type}: ${opts.name}`, titleX, titleY);

    const gridX = PAGE_PAD;
    const gridY = PAGE_PAD + titleBlockH;
    const currentTeacherName = opts.type === 'Teacher' ? opts.name : undefined;

    const mainDayLeft = (dayIndex: number) => gridX + TIME_COL_WIDTH * timeCols + dayIndex * DAY_COL_WIDTH;
    const fridayTimeX = gridX + mainGridW + SECTION_GAP;
    const fridayDayLeft = (_dayIndex: number) => fridayTimeX + TIME_COL_WIDTH * timeCols;

    // —— Mon–Thu (or full week) panel ——
    drawTimeColumns(
        ctx,
        mainAxis,
        gridX,
        gridY,
        showEndTime,
        splitFriday ? 'Mon–Thu' : 'Time'
    );
    drawDayHeadersAndCells(ctx, mainDays, mainDayLeft, gridY, mainAxis);
    drawBlocksOnAxis(
        ctx,
        splitFriday ? monThuBlocks : opts.blocks,
        mainDays,
        mainDayLeft,
        gridY,
        mainAxis,
        opts.type,
        !!opts.hideTeacherNames,
        currentTeacherName
    );

    // —— Friday panel with its own Time column ——
    if (splitFriday && fridayAxis) {
        // Soft vertical separator
        ctx.fillStyle = COLORS.fridayDivider;
        ctx.fillRect(gridX + mainGridW + SECTION_GAP / 2 - 0.5, gridY, 1, Math.min(gridH, fridayAxis.gridH));

        drawTimeColumns(ctx, fridayAxis, fridayTimeX, gridY, showEndTime, 'Friday');
        drawDayHeadersAndCells(ctx, ['Friday'], fridayDayLeft, gridY, fridayAxis);
        drawBlocksOnAxis(
            ctx,
            fridayBlocks,
            ['Friday'],
            fridayDayLeft,
            gridY,
            fridayAxis,
            opts.type,
            !!opts.hideTeacherNames,
            currentTeacherName
        );
    }

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
    const cssW = imgW / SCALE;
    const cssH = imgH / SCALE;
    const ratio = Math.min(maxW / cssW, maxH / cssH);
    const drawW = cssW * ratio;
    const drawH = cssH * ratio;
    const x = (pageWidth - drawW) / 2;
    const y = (pageHeight - drawH) / 2;

    const imgData = canvas.toDataURL('image/jpeg', 0.94);
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

        await new Promise((r) => setTimeout(r, 0));
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const defaultName =
        type === 'Student'
            ? `Student_Schedules_${stamp}.pdf`
            : `Teacher_Schedules_${stamp}.pdf`;
    pdf.save(filename || defaultName);
}
