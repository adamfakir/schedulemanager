/** School section classification for teaching-load breakdowns. */

import {
    getEntityId,
    getSubjectIdRef,
    getTimeblockId,
    isTeacherAssignedForSubjectBlock,
    timeToMinutes,
} from './scheduleData';

export const SECTIONS = [
    { id: 'primary', label: 'Primary (PreK-G2)' },
    { id: 'elementary', label: 'Elementary (G3-5)' },
    { id: 'middle_girls', label: 'Middle School Girls (6-8)' },
    { id: 'middle_boys', label: 'Middle School Boys (6-8)' },
    { id: 'high_girls', label: 'High School Girls (9-12)' },
    { id: 'high_boys', label: 'High School Boys (9-12)' },
    { id: 'other', label: 'Other' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export const SECTION_IDS = SECTIONS.map((s) => s.id);

export const sectionLabel = (id: SectionId | string): string =>
    SECTIONS.find((s) => s.id === id)?.label || 'Other';

/** Normalize a stored section value; empty/unknown → other. */
export const normalizeStoredSection = (raw: unknown): SectionId => {
    const v = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '_');
    if ((SECTION_IDS as string[]).includes(v)) return v as SectionId;
    return 'other';
};

const COURSE_GRADE: Record<string, number> = { '1': 9, '2': 10, '3': 11, '4': 12 };

/** Prefer display fields only — tags are often historical/noisy copies. */
const subjectText = (subject: any): string =>
    [subject?.displayclass, subject?.name, subject?.displayname]
        .filter(Boolean)
        .join(' ');

const detectGender = (text: string): 'boys' | 'girls' | null => {
    const t = text.toLowerCase();
    const boys = /\bboys?\b/.test(t);
    const girls = /\bgirls?\b/.test(t);
    if (boys && !girls) return 'boys';
    if (girls && !boys) return 'girls';
    return null;
};

/** Ontario-style course codes: MHF4U, SBI3UB, ENG4U, AVI1O, SNC2D, ENL1W */
const findCourseCodeGrades = (text: string): number[] => {
    const grades: number[] = [];
    const re = /\b[A-Z]{3}([1-4])[A-Z]{0,3}\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        const g = COURSE_GRADE[m[1]];
        if (g) grades.push(g);
    }
    return grades;
};

const hasPrimaryKeyword = (text: string): boolean =>
    /\b(prek|pre-?k|jk|sk|kindergarten|nursery)\b/i.test(text);

/** Collect grade numbers mentioned in free text (1–12). */
const extractGrades = (text: string): number[] => {
    const grades = new Set<number>();

    if (hasPrimaryKeyword(text)) {
        // treat as grade band primary without adding a numeric grade
    }

    // Grade 5, Grade 5A, Grade 5B, G5, G 11
    const gradeRe = /\b(?:grade|gr\.?|g)\s*(\d{1,2})(?:\s*[ab])?\b/gi;
    let m: RegExpExecArray | null;
    while ((m = gradeRe.exec(text)) !== null) {
        const n = Number(m[1]);
        if (n >= 1 && n <= 12) grades.add(n);
    }

    // Compact ranges / lists: 9/10, 11/12, 1-2, 3-8, 5/6 (avoid matching times like 9:00)
    const rangeRe = /(?<![A-Za-z:])\b(\d{1,2})\s*[\/\-–]\s*(\d{1,2})\b(?!\s*:)/g;
    while ((m = rangeRe.exec(text)) !== null) {
        const a = Number(m[1]);
        const b = Number(m[2]);
        if (a >= 1 && a <= 12) grades.add(a);
        if (b >= 1 && b <= 12) grades.add(b);
        if (a >= 1 && a <= 12 && b >= 1 && b <= 12 && b >= a && b - a <= 6) {
            for (let g = a; g <= b; g++) grades.add(g);
        }
    }

    // Bare leading displayclass like "3", "11/12 Boys" already covered; lone "3" as whole token
    const lone = text.trim().match(/^(\d{1,2})(?:\s*[ab])?$/i);
    if (lone) {
        const n = Number(lone[1]);
        if (n >= 1 && n <= 12) grades.add(n);
    }

    findCourseCodeGrades(text).forEach((g) => grades.add(g));
    return Array.from(grades).sort((a, b) => a - b);
};

type Band = 'primary' | 'elementary' | 'middle' | 'high';

const bandForGrade = (g: number): Band | null => {
    if (g <= 2) return 'primary';
    if (g <= 5) return 'elementary';
    if (g <= 8) return 'middle';
    if (g <= 12) return 'high';
    return null;
};

const bandsFromGrades = (grades: number[], primaryKeyword: boolean): Set<Band> => {
    const bands = new Set<Band>();
    if (primaryKeyword) bands.add('primary');
    grades.forEach((g) => {
        const b = bandForGrade(g);
        if (b) bands.add(b);
    });
    return bands;
};

const genderedSection = (band: 'middle' | 'high', gender: 'boys' | 'girls' | null): SectionId => {
    if (!gender) return 'other';
    if (band === 'middle') return gender === 'girls' ? 'middle_girls' : 'middle_boys';
    return gender === 'girls' ? 'high_girls' : 'high_boys';
};

/**
 * Infer a single section from subject naming fields.
 * Returns `other` when ambiguous or not clearly one of the six sections.
 */
export const inferSubjectSection = (subject: any): SectionId => {
    const displayclass = String(subject?.displayclass || '').trim();
    const text = subjectText(subject);
    if (!text.trim()) return 'other';

    const lower = text.toLowerCase();
    const gender = detectGender(text);

    // Explicit cohort labels win
    if (/high\s*school\s+girls|highschool\s+girls/.test(lower)) return 'high_girls';
    if (/high\s*school\s+boys|highschool\s+boys/.test(lower)) return 'high_boys';
    if (/middle\s*school\s+girls|middle\s+girls/.test(lower)) return 'middle_girls';
    if (/middle\s*school\s+boys|middle\s+boys/.test(lower)) return 'middle_boys';

    const primaryKeyword = hasPrimaryKeyword(text);
    // Parse displayclass alone so values like "3" / "3A" count as grades
    const grades = Array.from(
        new Set([...extractGrades(text), ...extractGrades(displayclass)])
    ).sort((a, b) => a - b);
    const bands = bandsFromGrades(grades, primaryKeyword);

    // Course code with no numeric grade elsewhere still implies high school
    if (bands.size === 0 && findCourseCodeGrades(text).length === 0) {
        // "High School" without gender
        if (/high\s*school|highschool/.test(lower)) return 'other';
        if (/middle\s*school|\bmiddle\b/.test(lower)) return 'other';
        return 'other';
    }

    if (bands.size === 0 && findCourseCodeGrades(text).length > 0) {
        return genderedSection('high', gender);
    }

    if (bands.size !== 1) return 'other';

    const band = Array.from(bands)[0];
    if (band === 'primary') return 'primary';
    if (band === 'elementary') return 'elementary';
    if (band === 'middle') return genderedSection('middle', gender);
    if (band === 'high') return genderedSection('high', gender);
    return 'other';
};

/** True when the subject name clearly maps to a non-Other section. */
export const hasClearSectionInName = (subject: any): boolean =>
    inferSubjectSection(subject) !== 'other';

export type SectionMinutes = Record<SectionId, number>;

export type SectionBreakdown = {
    minutes: SectionMinutes;
    total: number;
    percents: Record<SectionId, number>;
};

const emptyMinutes = (): SectionMinutes =>
    SECTIONS.reduce((acc, s) => {
        acc[s.id] = 0;
        return acc;
    }, {} as SectionMinutes);

const blockMinutes = (tb: any): number => {
    const start = tb?.start?.time || tb?.starttime;
    const end = tb?.end?.time || tb?.endtime;
    const startDay = tb?.start?.day || tb?.startday;
    const endDay = tb?.end?.day || tb?.endday;
    if (!start || !end || !startDay || startDay !== endDay) return 0;
    const mins = timeToMinutes(end) - timeToMinutes(start);
    return mins > 0 ? mins : 0;
};

/** Custom "Break" blocks are ignored in section % (same idea as prep). */
const isBreakName = (name: unknown): boolean =>
    String(name || '').trim().toLowerCase() === 'break';

/**
 * Teaching-load minutes by section for a teacher.
 * Prep and custom blocks named "Break" are excluded.
 * Meetings/custom without a section → Other.
 * Per-teacher per-block overrides in teacher.block_sections win over name inference.
 */
export const computeSectionBreakdown = (
    teacher: any,
    subjects: any[],
    meetings: any[] = [],
    customTemplates: any[] = []
): SectionBreakdown => {
    const minutes = emptyMinutes();
    const subjectById = new Map<string, any>((subjects || []).map((s) => [getEntityId(s), s]));
    const templateSection = new Map<string, SectionId>();
    const templateName = new Map<string, string>();
    (customTemplates || []).forEach((t) => {
        const tid = String(t?.template_id || t?.id || '');
        if (!tid) return;
        templateSection.set(tid, normalizeStoredSection(t?.section));
        templateName.set(tid, String(t?.name || ''));
    });

    const blockSectionOverrides = new Map<string, SectionId>();
    for (const ov of (teacher?.block_sections || [])) {
        const sid = getSubjectIdRef(ov?.subject);
        const bid = String(ov?.blockid || ov?.timeblockId || '');
        if (!sid || !bid) continue;
        blockSectionOverrides.set(`${sid}|${bid}`, normalizeStoredSection(ov?.section));
    }

    const teacherAllSubjectIds = new Set<string>([
        ...(teacher?.required_teach || []).map((sid: any) => getSubjectIdRef(sid)),
        ...(teacher?.can_teach || []).map((sid: any) => getSubjectIdRef(sid)),
    ]);

    teacherAllSubjectIds.forEach((subjId) => {
        const subj = subjectById.get(subjId);
        if (!subj) return;
        const inferred = inferSubjectSection(subj);
        (subj.timeblocks || []).forEach((tb: any) => {
            const tbId = getTimeblockId(tb);
            if (!isTeacherAssignedForSubjectBlock(teacher, subjId, tbId)) return;
            const key = `${subjId}|${tbId}`;
            const section = blockSectionOverrides.has(key)
                ? (blockSectionOverrides.get(key) as SectionId)
                : inferred;
            minutes[section] += blockMinutes(tb);
        });
    });

    (teacher?.custom_timeblocks || []).forEach((tb: any) => {
        const tid = String(tb?.template_id || tb?.templateId || '');
        const name = tb?.name || (tid ? templateName.get(tid) : '') || '';
        if (isBreakName(name) || (tid && isBreakName(templateName.get(tid)))) return;
        const section = tid && templateSection.has(tid)
            ? (templateSection.get(tid) as SectionId)
            : normalizeStoredSection(tb?.section);
        minutes[section] += blockMinutes(tb);
    });

    (meetings || []).forEach((meeting: any) => {
        if (isBreakName(meeting?.name)) return;
        const section = normalizeStoredSection(meeting?.section);
        (meeting.timeblocks || []).forEach((tb: any) => {
            minutes[section] += blockMinutes(tb);
        });
    });

    const total = SECTIONS.reduce((s, sec) => s + minutes[sec.id], 0);
    const percents = emptyMinutes();
    SECTIONS.forEach((sec) => {
        percents[sec.id] = total > 0 ? Math.round((minutes[sec.id] / total) * 1000) / 10 : 0;
    });

    return { minutes, total, percents };
};
