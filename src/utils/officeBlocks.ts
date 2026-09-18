/** Shared constants/helpers for teacher Office blocks (prep, meetings, custom). */

export const PREP_SUBJECT_ID = '__prep__';
export const MEETING_SUBJECT_ID = '__meeting__';
export const CUSTOM_SUBJECT_ID = '__custom__';

export const PREP_DEFAULT_MINUTES = 35;
export const OFFICE_DEFAULT_MINUTES = 35;
export const PREP_RATIO = 0.2;
export const PREP_COLOR = '#9ec9db';
export const DEFAULT_MEETING_COLOR = '#7eb8a8';
export const DEFAULT_CUSTOM_COLOR = '#a8c5a0';

export const isPrepBlock = (block: any): boolean =>
    !!block?.isPrep || block?.subjectId === PREP_SUBJECT_ID;

export const isMeetingBlock = (block: any): boolean =>
    !!block?.isMeeting || String(block?.subjectId || '').startsWith(`${MEETING_SUBJECT_ID}:`) || block?.subjectId === MEETING_SUBJECT_ID;

export const isCustomBlock = (block: any): boolean =>
    !!block?.isCustom || String(block?.subjectId || '').startsWith(`${CUSTOM_SUBJECT_ID}:`) || block?.subjectId === CUSTOM_SUBJECT_ID;

export const isOfficeOwnedBlock = (block: any): boolean =>
    isPrepBlock(block) || isMeetingBlock(block) || isCustomBlock(block);

export const meetingSubjectId = (meetingId: string) => `${MEETING_SUBJECT_ID}:${meetingId}`;
export const customSubjectId = (templateId: string) => `${CUSTOM_SUBJECT_ID}:${templateId}`;

export const getMeetingIdFromBlock = (block: any): string =>
    String(block?.meetingId || block?.meeting_id || String(block?.subjectId || '').replace(`${MEETING_SUBJECT_ID}:`, '') || '');

export const getTemplateIdFromBlock = (block: any): string =>
    String(block?.templateId || block?.template_id || String(block?.subjectId || '').replace(`${CUSTOM_SUBJECT_ID}:`, '') || '');

export const normalizePrepTimeblock = (tb: any) => {
    const start = tb?.start
        ? { day: tb.start.day, time: tb.start.time }
        : { day: tb.startday, time: tb.starttime };
    const end = tb?.end
        ? { day: tb.end.day, time: tb.end.time }
        : { day: tb.endday, time: tb.endtime };
    const timeblockId = String(tb?.timeblockId || tb?.blockid || tb?.id || '');
    return {
        subjectId: PREP_SUBJECT_ID,
        isPrep: true,
        start,
        end,
        timeblockId,
        blockid: timeblockId,
        color: PREP_COLOR,
        name: 'Prep',
        displayclass: '',
    };
};

export const normalizeCustomTimeblock = (tb: any) => {
    const start = tb?.start
        ? { day: tb.start.day, time: tb.start.time }
        : { day: tb.startday, time: tb.starttime };
    const end = tb?.end
        ? { day: tb.end.day, time: tb.end.time }
        : { day: tb.endday, time: tb.endtime };
    const templateId = String(tb?.template_id || tb?.templateId || '');
    const timeblockId = String(tb?.timeblockId || tb?.blockid || tb?.id || '');
    const name = tb?.name || 'Note';
    const color = tb?.color || DEFAULT_CUSTOM_COLOR;
    return {
        subjectId: customSubjectId(templateId),
        isCustom: true,
        templateId,
        start,
        end,
        timeblockId,
        blockid: timeblockId,
        color,
        name,
        displayclass: '',
    };
};

export const normalizeMeetingTimeblock = (meeting: any, tb: any) => {
    const start = tb?.start
        ? { day: tb.start.day, time: tb.start.time }
        : { day: tb.startday, time: tb.starttime };
    const end = tb?.end
        ? { day: tb.end.day, time: tb.end.time }
        : { day: tb.endday, time: tb.endtime };
    const meetingId = String(meeting?._id?.$oid || meeting?._id || meeting?.id || '');
    const timeblockId = String(tb?.timeblockId || tb?.blockid || tb?.id || '');
    const teacherIds = (meeting?.teacher_ids || []).map((id: any) => String(id));
    const teachers = meeting?.teacher_names || [];
    return {
        subjectId: meetingSubjectId(meetingId),
        isMeeting: true,
        meetingId,
        start,
        end,
        timeblockId,
        blockid: timeblockId,
        color: meeting?.color || DEFAULT_MEETING_COLOR,
        name: meeting?.name || 'Meeting',
        teachers,
        teacherIds,
        displayclass: '',
    };
};

export const prepPayloadFromTimeblocks = (blocks: any[]) =>
    blocks.filter(isPrepBlock).map((tb) => ({
        startday: tb.start.day,
        starttime: tb.start.time,
        endday: tb.end.day,
        endtime: tb.end.time,
        blockid: tb.timeblockId || tb.blockid,
    }));

export const customPayloadFromTimeblocks = (blocks: any[]) =>
    blocks.filter(isCustomBlock).map((tb) => ({
        startday: tb.start.day,
        starttime: tb.start.time,
        endday: tb.end.day,
        endtime: tb.end.time,
        blockid: tb.timeblockId || tb.blockid,
        template_id: getTemplateIdFromBlock(tb),
        name: tb.name,
        color: tb.color || DEFAULT_CUSTOM_COLOR,
    }));

export const meetingTimeblockPayload = (blocks: any[], meetingId: string) =>
    blocks
        .filter((tb) => isMeetingBlock(tb) && getMeetingIdFromBlock(tb) === meetingId)
        .map((tb) => ({
            startday: tb.start.day,
            starttime: tb.start.time,
            endday: tb.end.day,
            endtime: tb.end.time,
            blockid: tb.timeblockId || tb.blockid,
        }));
