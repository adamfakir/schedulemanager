import {
    buildStudentScheduleBlocks,
    buildTeacherScheduleBlocks,
    getEntityId,
    ScheduleBlock,
} from './scheduleData';
import { API_BASE } from './apiClient';
import axios from 'axios';

/** Canonical encoding of a schedule for equality checks (final result, not edit history). */
export const canonicalizeScheduleBlocks = (blocks: ScheduleBlock[]): string => {
    const rows = (blocks || []).map((b) => ({
        d: b.start?.day || '',
        s: b.start?.time || '',
        e: b.end?.time || '',
        sid: b.subjectId || '',
        n: b.name || '',
        dc: b.displayclass || '',
        p: !!b.isPrep,
        m: !!b.isMeeting,
        c: !!b.isCustom,
        t: [...(b.teachers || [])].map(String).sort().join('|'),
    }));
    rows.sort((a, b) => {
        const ka = `${a.d}|${a.s}|${a.e}|${a.sid}|${a.n}|${a.dc}|${a.p}|${a.m}|${a.c}|${a.t}`;
        const kb = `${b.d}|${b.s}|${b.e}|${b.sid}|${b.n}|${b.dc}|${b.p}|${b.m}|${b.c}|${b.t}`;
        return ka.localeCompare(kb);
    });
    return JSON.stringify(rows);
};

/** Stable short fingerprint of schedule content. */
export const fingerprintScheduleBlocks = (blocks: ScheduleBlock[]): string => {
    const canonical = canonicalizeScheduleBlocks(blocks);
    // djb2
    let h = 5381;
    for (let i = 0; i < canonical.length; i++) {
        h = ((h << 5) + h) ^ canonical.charCodeAt(i);
    }
    // Include length so collisions are even less likely for empty vs tiny schedules
    return `${(h >>> 0).toString(16)}:${canonical.length}`;
};

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
        const blocks = buildStudentScheduleBlocks(student, subjects, teachers);
        out[id] = fingerprintScheduleBlocks(blocks);
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
