import {
    buildTeacherScheduleBlocks,
    getEntityId,
    getSubjectIdRef,
    getTimeblockId,
    isTeacherAssignedForSubjectBlock,
    ScheduleBlock,
    timeToMinutes,
} from './scheduleData';
import { API_BASE } from './apiClient';
import axios from 'axios';

type FingerprintRow = {
    d: string;
    s: string;
    e: string;
    sid: string;
    n: string;
    dc: string;
    p: boolean;
    m: boolean;
    c: boolean;
    /** Sorted teacher IDs only (never display names) — renames must not dirty fingerprints. */
    t: string;
};

/**
 * Canonical schedule encoding for change-session diffs.
 * Compares where/what blocks are, not display labels of people.
 * - Omits co-attendee names on meetings (remove X from a meeting → only X changes)
 * - Teacher rename does not change anyone's fingerprint
 * - Student rows may include sorted teacher IDs so reassignment still counts
 */
export const canonicalizeFingerprintRows = (rows: FingerprintRow[]): string => {
    const sorted = [...rows].sort((a, b) => {
        const ka = `${a.d}|${a.s}|${a.e}|${a.sid}|${a.n}|${a.dc}|${a.p}|${a.m}|${a.c}|${a.t}`;
        const kb = `${b.d}|${b.s}|${b.e}|${b.sid}|${b.n}|${b.dc}|${b.p}|${b.m}|${b.c}|${b.t}`;
        return ka.localeCompare(kb);
    });
    return JSON.stringify(sorted);
};

const hashCanonical = (canonical: string): string => {
    let h = 5381;
    for (let i = 0; i < canonical.length; i++) {
        h = ((h << 5) + h) ^ canonical.charCodeAt(i);
    }
    return `${(h >>> 0).toString(16)}:${canonical.length}`;
};

/** Rows from teacher schedule blocks — no people names; meeting sid already encodes meeting id. */
export const teacherBlocksToFingerprintRows = (blocks: ScheduleBlock[]): FingerprintRow[] =>
    (blocks || []).map((b) => ({
        d: b.start?.day || '',
        s: b.start?.time || '',
        e: b.end?.time || '',
        sid: b.subjectId || '',
        // Meeting/custom titles matter for "what is this block"; subject display names do not (sid covers it).
        n: b.isMeeting || b.isCustom ? (b.name || '') : '',
        dc: b.displayclass || '',
        p: !!b.isPrep,
        m: !!b.isMeeting,
        c: !!b.isCustom,
        t: '',
    }));

const normalizeBlockTimes = (tb: any): { day: string; start: string; end: string } | null => {
    const start = tb?.start?.time || tb?.starttime;
    const end = tb?.end?.time || tb?.endtime;
    const startDay = tb?.start?.day || tb?.startday;
    const endDay = tb?.end?.day || tb?.endday;
    if (!start || !end || !startDay || startDay !== endDay) return null;
    if (timeToMinutes(end) <= timeToMinutes(start)) return null;
    return { day: startDay, start, end };
};

/** Student schedule rows with assigned teacher IDs (stable under rename). */
export const studentToFingerprintRows = (
    student: any,
    subjects: any[],
    teachers: any[]
): FingerprintRow[] => {
    const requiredIds = new Set<string>((student?.required_classes || []).map((rc: any) => getSubjectIdRef(rc)));
    const subjectById = new Map<string, any>(subjects.map((s) => [getEntityId(s), s]));
    const rows: FingerprintRow[] = [];

    requiredIds.forEach((subjId: string) => {
        const subj = subjectById.get(subjId);
        if (!subj) return;
        (subj.timeblocks || []).forEach((tb: any) => {
            const times = normalizeBlockTimes(tb);
            if (!times) return;
            const tbId = getTimeblockId(tb);
            const teacherIds = (teachers || [])
                .filter((t: any) => isTeacherAssignedForSubjectBlock(t, subjId, tbId))
                .map((t: any) => getEntityId(t))
                .filter(Boolean)
                .sort();
            rows.push({
                d: times.day,
                s: times.start,
                e: times.end,
                sid: subjId,
                n: '',
                dc: '',
                p: false,
                m: false,
                c: false,
                t: teacherIds.join('|'),
            });
        });
    });

    return rows;
};

/** Stable short fingerprint of schedule content. */
export const fingerprintRows = (rows: FingerprintRow[]): string =>
    hashCanonical(canonicalizeFingerprintRows(rows));

export const fingerprintScheduleBlocks = (blocks: ScheduleBlock[]): string =>
    fingerprintRows(teacherBlocksToFingerprintRows(blocks));

export const meetingsForTeacher = (meetings: any[], teacherId: string): any[] => {
    const tid = String(teacherId);
    return (meetings || []).filter((m: any) =>
        (m.teacher_ids || []).map(String).includes(tid)
    );
};

export const computeTeacherFingerprints = (
    teachers: any[],
    subjects: any[],
    meetings: any[]
): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const teacher of teachers || []) {
        const id = getEntityId(teacher);
        if (!id) continue;
        const entityMeetings = meetingsForTeacher(meetings, id);
        const blocks = buildTeacherScheduleBlocks(teacher, subjects, entityMeetings);
        out[id] = fingerprintScheduleBlocks(blocks);
    }
    return out;
};

export const computeStudentFingerprints = (
    students: any[],
    subjects: any[],
    teachers: any[]
): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const student of students || []) {
        const id = getEntityId(student);
        if (!id) continue;
        out[id] = fingerprintRows(studentToFingerprintRows(student, subjects, teachers));
    }
    return out;
};

export type ChangedEntity = {
    id: string;
    name: string;
    entity: any;
    reason: 'changed' | 'new';
};

/** Compare baseline fingerprints to current. Only final schedule inequality counts. */
export const diffEntityFingerprints = (
    baseline: Record<string, string> | undefined | null,
    currentEntities: any[],
    currentFingerprints: Record<string, string>
): ChangedEntity[] => {
    const base = baseline || {};
    const changed: ChangedEntity[] = [];
    for (const entity of currentEntities || []) {
        const id = getEntityId(entity);
        if (!id) continue;
        const currentFp = currentFingerprints[id];
        const baselineFp = base[id];
        if (baselineFp === undefined) {
            changed.push({
                id,
                name: entity.displayname || entity.name || 'Untitled',
                entity,
                reason: 'new',
            });
        } else if (baselineFp !== currentFp) {
            changed.push({
                id,
                name: entity.displayname || entity.name || 'Untitled',
                entity,
                reason: 'changed',
            });
        }
    }
    changed.sort((a, b) => a.name.localeCompare(b.name));
    return changed;
};

export type ChangeSessionPayload = {
    active: boolean;
    session: {
        id: string;
        orgid: string;
        started_at: string | null;
        started_by: string | null;
        teacher_fingerprints: Record<string, string>;
        student_fingerprints: Record<string, string>;
        teacher_count: number;
        student_count: number;
    } | null;
};

export const fetchChangeSession = async (token: string): Promise<ChangeSessionPayload> => {
    const res = await axios.get(`${API_BASE}/organization/change_session`, {
        headers: { Authorization: token },
    });
    return res.data;
};

export const startChangeSession = async (
    token: string,
    teacherFingerprints: Record<string, string>,
    studentFingerprints: Record<string, string>
): Promise<ChangeSessionPayload> => {
    const res = await axios.post(
        `${API_BASE}/organization/change_session/start`,
        {
            teacher_fingerprints: teacherFingerprints,
            student_fingerprints: studentFingerprints,
        },
        { headers: { Authorization: token } }
    );
    return { active: true, session: res.data.session };
};

export const endChangeSession = async (token: string): Promise<void> => {
    await axios.delete(`${API_BASE}/organization/change_session/end`, {
        headers: { Authorization: token },
    });
};
