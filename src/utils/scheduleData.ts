import {
    PREP_COLOR,
    PREP_SUBJECT_ID,
    normalizeCustomTimeblock,
    normalizeMeetingTimeblock,
} from './officeBlocks';

/** Shared helpers for building schedule blocks used by PDF export. */

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
export const MON_THU_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday'] as const;
// Re-export for callers that imported from here historically
export { PREP_COLOR, PREP_SUBJECT_ID };

export type ScheduleBlock = {
    subjectId: string;
    start: { day: string; time: string };
    end: { day: string; time: string };
    color: string;
    name: string;
    displayclass?: string;
    teachers?: string[];
    isPrep?: boolean;
    isMeeting?: boolean;
    isCustom?: boolean;
};

export type DayHoursStat = {
    day: string;
    span: number;
    filled: number;
    empty: number;
    earliest: string | null;
    latest: string | null;
};

export type HoursSummary = {
    days: DayHoursStat[];
    totalSpan: number;
    totalFilled: number;
    totalEmpty: number;
};

export const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
};

export const minutesToTime = (min: number): string => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export const formatHoursLabel = (mins: number): string => {
    const safe = Math.max(0, Math.round(mins));
    const h = Math.floor(safe / 60);
    const m = safe % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
};

export const cropSemesterTag = (name: string): string =>
    name.replace(/\[SEM1\]|\[SEM2\]/gi, '').trim();

export const getEntityId = (entity: any): string =>
    String(entity?._id?.$oid || entity?._id || entity?.id || '');

export const getSubjectIdRef = (raw: any): string =>
    String(raw?.$oid || raw?.subject?.$oid || raw?.subject || raw?.id || raw || '');

export const getTimeblockId = (tb: any): string =>
    String(tb?.timeblockId || tb?.blockid || tb?.id || '');

const getOverrideExcludeMode = (ov: any): boolean => ov?.excludeextras !== false;

const getRequiredOverrideForSubject = (teacher: any, subjectId: string): any | null => {
    const overrides = teacher?.required_teach_overrides || [];
    return overrides.find((ov: any) => getSubjectIdRef(ov?.subject) === subjectId) || null;
};

export const isTeacherAssignedForSubjectBlock = (
    teacher: any,
    subjectId: string,
    timeblockId: string
): boolean => {
    const requiredIds = (teacher?.required_teach || []).map((sid: any) => getSubjectIdRef(sid));
    if (!requiredIds.includes(subjectId)) return false;

    const ov = getRequiredOverrideForSubject(teacher, subjectId);
    if (!ov) return true;

    const extra = new Set((ov?.extratimeblocks || []).map((id: any) => String(id)));
    const excludeMode = getOverrideExcludeMode(ov);
    if (!timeblockId) return excludeMode;
    return excludeMode ? !extra.has(String(timeblockId)) : extra.has(String(timeblockId));
};

const normalizeBlockTimes = (tb: any): { day: string; start: string; end: string } | null => {
    const start = tb?.start?.time || tb?.starttime;
    const end = tb?.end?.time || tb?.endtime;
    const startDay = tb?.start?.day || tb?.startday;
    const endDay = tb?.end?.day || tb?.endday;
    if (!start || !end || !startDay || startDay !== endDay) return null;
    if (timeToMinutes(end) <= timeToMinutes(start)) return null;
    return { day: startDay, start, end };
};

export const buildStudentScheduleBlocks = (
    student: any,
    subjects: any[],
    teachers: any[]
): ScheduleBlock[] => {
    const requiredIds = new Set<string>((student?.required_classes || []).map((rc: any) => getSubjectIdRef(rc)));
    const subjectById = new Map<string, any>(subjects.map((s) => [getEntityId(s), s]));
    const blocks: ScheduleBlock[] = [];

    requiredIds.forEach((subjId: string) => {
        const subj = subjectById.get(subjId);
        if (!subj) return;
        (subj.timeblocks || []).forEach((tb: any) => {
            const times = normalizeBlockTimes(tb);
            if (!times) return;
            const tbId = getTimeblockId(tb);
            const teacherNames = (teachers || [])
                .filter((t: any) => isTeacherAssignedForSubjectBlock(t, subjId, tbId))
                .map((t: any) => t.displayname || t.name)
                .filter(Boolean);
            blocks.push({
                subjectId: subjId,
                start: { day: times.day, time: times.start },
                end: { day: times.day, time: times.end },
                color: subj.color || '#b8b8b8',
                name: subj.displayname || subj.name || 'Subject',
                teachers: teacherNames,
            });
        });
    });

    return blocks;
};

export const buildTeacherScheduleBlocks = (teacher: any, subjects: any[], meetings: any[] = []): ScheduleBlock[] => {
    const subjectIdSet = new Set<string>(
        [...(teacher?.required_teach || []), ...(teacher?.can_teach || [])].map((sid: any) => getSubjectIdRef(sid))
    );
    const requiredSet = new Set<string>((teacher?.required_teach || []).map((sid: any) => getSubjectIdRef(sid)));
    const subjectById = new Map<string, any>(subjects.map((s) => [getEntityId(s), s]));
    const blocks: ScheduleBlock[] = [];

    (teacher?.prep_timeblocks || []).forEach((tb: any) => {
        const times = normalizeBlockTimes(tb);
        if (!times) return;
        blocks.push({
            subjectId: PREP_SUBJECT_ID,
            isPrep: true,
            start: { day: times.day, time: times.start },
            end: { day: times.day, time: times.end },
            color: PREP_COLOR,
            name: 'Prep',
            displayclass: '',
        });
    });

    (teacher?.custom_timeblocks || []).forEach((tb: any) => {
        const n = normalizeCustomTimeblock(tb);
        const times = normalizeBlockTimes(n);
        if (!times) return;
        blocks.push({
            subjectId: n.subjectId,
            isCustom: true,
            start: { day: times.day, time: times.start },
            end: { day: times.day, time: times.end },
            color: n.color,
            name: n.name,
            displayclass: '',
        });
    });

    (meetings || []).forEach((meeting: any) => {
        (meeting.timeblocks || []).forEach((tb: any) => {
            const n = normalizeMeetingTimeblock(meeting, tb);
            const times = normalizeBlockTimes(n);
            if (!times) return;
            blocks.push({
                subjectId: n.subjectId,
                isMeeting: true,
                start: { day: times.day, time: times.start },
                end: { day: times.day, time: times.end },
                color: n.color,
                name: n.name,
                teachers: n.teachers,
                displayclass: '',
            });
        });
    });

    const fixedLabelMap = new Map<string, string>();
    for (const lb of (teacher?.fixed_block_labels || [])) {
        const sid = getSubjectIdRef(lb?.subject);
        const bid = String(lb?.blockid || lb?.timeblockId || '');
        if (!sid || !bid) continue;
        fixedLabelMap.set(`${sid}|${bid}`, String(lb?.displayclass ?? ''));
    }

    subjectIdSet.forEach((subjId: string) => {
        const subj = subjectById.get(subjId);
        if (!subj) return;
        (subj.timeblocks || []).forEach((tb: any) => {
            const tbId = getTimeblockId(tb);
            if (requiredSet.has(subjId) && !isTeacherAssignedForSubjectBlock(teacher, subjId, tbId)) {
                return;
            }
            const times = normalizeBlockTimes(tb);
            if (!times) return;
            const labelKey = `${subjId}|${tbId}`;
            const hasOverride = fixedLabelMap.has(labelKey);
            blocks.push({
                subjectId: subjId,
                start: { day: times.day, time: times.start },
                end: { day: times.day, time: times.end },
                color: subj.color || '#b8b8b8',
                name: subj.displayname || subj.name || 'Subject',
                displayclass: subj.fixed && hasOverride
                    ? (fixedLabelMap.get(labelKey) || '')
                    : (subj.displayclass || ''),
            });
        });
    });

    return blocks;
};

const mergeFilledMinutes = (intervals: Array<[number, number]>): number => {
    if (!intervals.length) return 0;
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    let filled = 0;
    let curStart = sorted[0][0];
    let curEnd = sorted[0][1];
    for (let i = 1; i < sorted.length; i++) {
        const [s, e] = sorted[i];
        if (s <= curEnd) {
            curEnd = Math.max(curEnd, e);
        } else {
            filled += curEnd - curStart;
            curStart = s;
            curEnd = e;
        }
    }
    filled += curEnd - curStart;
    return filled;
};

/** Same logic as the teacher Hours tab in Navbar. */
export const computeTeacherHours = (teacher: any, subjects: any[], meetings: any[] = []): HoursSummary => {
    const teacherAllSubjectIds = new Set<string>([
        ...(teacher?.required_teach || []).map((sid: any) => getSubjectIdRef(sid)),
        ...(teacher?.can_teach || []).map((sid: any) => getSubjectIdRef(sid)),
    ]);
    const subjectById = new Map<string, any>(subjects.map((s) => [getEntityId(s), s]));
    const intervals: Array<{ day: string; start: number; end: number }> = [];

    teacherAllSubjectIds.forEach((subjId: string) => {
        const subj = subjectById.get(subjId);
        if (!subj) return;
        const requiredIds = (teacher?.required_teach || []).map((sid: any) => getSubjectIdRef(sid));
        (subj.timeblocks || []).forEach((tb: any) => {
            if (requiredIds.includes(subjId) && !isTeacherAssignedForSubjectBlock(teacher, subjId, getTimeblockId(tb))) {
                return;
            }
            const times = normalizeBlockTimes(tb);
            if (!times) return;
            intervals.push({
                day: times.day,
                start: timeToMinutes(times.start),
                end: timeToMinutes(times.end),
            });
        });
    });

    (teacher?.prep_timeblocks || []).forEach((tb: any) => {
        const times = normalizeBlockTimes(tb);
        if (!times) return;
        intervals.push({
            day: times.day,
            start: timeToMinutes(times.start),
            end: timeToMinutes(times.end),
        });
    });

    (teacher?.custom_timeblocks || []).forEach((tb: any) => {
        const times = normalizeBlockTimes(tb);
        if (!times) return;
        intervals.push({
            day: times.day,
            start: timeToMinutes(times.start),
            end: timeToMinutes(times.end),
        });
    });

    (meetings || []).forEach((meeting: any) => {
        (meeting.timeblocks || []).forEach((tb: any) => {
            const times = normalizeBlockTimes(tb);
            if (!times) return;
            intervals.push({
                day: times.day,
                start: timeToMinutes(times.start),
                end: timeToMinutes(times.end),
            });
        });
    });

    const days = DAYS.map((day) => {
        const dayIntervals = intervals.filter((iv) => iv.day === day);
        if (!dayIntervals.length) {
            return { day, span: 0, filled: 0, empty: 0, earliest: null, latest: null };
        }
        const earliest = Math.min(...dayIntervals.map((iv) => iv.start));
        const latest = Math.max(...dayIntervals.map((iv) => iv.end));
        const span = latest - earliest;
        const filled = mergeFilledMinutes(dayIntervals.map((iv) => [iv.start, iv.end] as [number, number]));
        const empty = Math.max(0, span - filled);
        return {
            day,
            span,
            filled,
            empty,
            earliest: minutesToTime(earliest),
            latest: minutesToTime(latest),
        };
    });

    return {
        days,
        totalSpan: days.reduce((s, d) => s + d.span, 0),
        totalFilled: days.reduce((s, d) => s + d.filled, 0),
        totalEmpty: days.reduce((s, d) => s + d.empty, 0),
    };
};

export const buildSortedTimes = (blocks: ScheduleBlock[]): string[] => {
    const defaultMin = '08:00';
    const defaultMax = '15:00';
    const set = new Set<string>([defaultMin, defaultMax]);
    blocks.forEach((tb) => {
        if (tb.start?.time) set.add(tb.start.time);
        if (tb.end?.time) set.add(tb.end.time);
    });

    let sorted = Array.from(set).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

    // Fill large gaps with hourly labels (matches ScheduleItem feel)
    const expanded: string[] = [];
    for (let i = 0; i < sorted.length; i++) {
        expanded.push(sorted[i]);
        if (i < sorted.length - 1) {
            const cur = timeToMinutes(sorted[i]);
            const next = timeToMinutes(sorted[i + 1]);
            for (let t = Math.ceil((cur + 1) / 60) * 60; t < next; t += 60) {
                expanded.push(minutesToTime(t));
            }
        }
    }
    sorted = Array.from(new Set(expanded)).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    return sorted;
};

/** Unique start/end times for a set of blocks (no hourly fillers). */
const uniqueBoundaryTimes = (blocks: ScheduleBlock[]): Set<string> => {
    const set = new Set<string>();
    blocks.forEach((tb) => {
        if (tb.start?.time) set.add(tb.start.time);
        if (tb.end?.time) set.add(tb.end.time);
    });
    return set;
};

/**
 * When Friday's period boundaries differ a lot from Mon–Thu, the shared time
 * axis gets noisy. Prefer a separate Friday time column in that case.
 */
export const shouldUseSeparateFridayTimes = (blocks: ScheduleBlock[]): boolean => {
    const monThu = blocks.filter((b) => (MON_THU_DAYS as readonly string[]).includes(b.start.day));
    const friday = blocks.filter((b) => b.start.day === 'Friday');
    if (!monThu.length || !friday.length) return false;

    const monThuTimes = uniqueBoundaryTimes(monThu);
    const fridayTimes = uniqueBoundaryTimes(friday);
    if (fridayTimes.size < 2) return false;

    let fridayOnly = 0;
    fridayTimes.forEach((t) => {
        if (!monThuTimes.has(t)) fridayOnly += 1;
    });

    const fridayOnlyRatio = fridayOnly / fridayTimes.size;
    const combinedLen = buildSortedTimes(blocks).length;
    const monThuLen = buildSortedTimes(monThu).length;
    const fridayLen = buildSortedTimes(friday).length;
    const rowsAddedByMerging = combinedLen - Math.max(monThuLen, fridayLen);

    // Split when Friday introduces several unique times OR merging balloons the axis
    return (fridayOnly >= 3 && fridayOnlyRatio >= 0.35) || rowsAddedByMerging >= 4;
};
