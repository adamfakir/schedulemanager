import React, { useEffect, useLayoutEffect, useState, useContext, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { keyframes } from '@emotion/react';
import { Box, Heading, Spinner, Center, VStack, Button, HStack, Checkbox, Input, FormControl, FormLabel, Text, Alert, Textarea } from '@chakra-ui/react';
import { DownloadIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon } from '@chakra-ui/icons';
import axios from 'axios';
import {getDraggedSubjectData, getDraggedSubjectId, setDraggedSubjectId, setDraggedSubjectData} from '../utils/dragSubjectStore';
import { useRef } from 'react';
import { AvailabilityContext } from '../utils/AvailabilityContext';
import { teacherCacheGlobal, subjectCacheGlobal } from '../utils/globalCache';
import { usePageTitle } from '../utils/usePageTitle';
import { exportScheduleToExcel } from '../utils/excelExport';
import { API_BASE, getCache, loadAllSubjects, loadAllTeachers, loadStudentById, loadSubjectById, loadTeacherById, setCache } from '../utils/apiClient';

const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;

let currentDraggedSubjectId: string | null = null;
const timeToMinutes = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return h * 60 + m;
};
type TimeBlock = {
    start: { day: string; time: string };
    end:   { day: string; time: string };
};
const minutesToTime = (min: number) => {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
};

// Helper to update subject cache after a subject's timeblocks change
async function updateSubjectCacheFromBackend(subjectId: string) {
    const token = localStorage.getItem('user_token');
    if (!token) return;
    let subjectCache = subjectCacheGlobal.current || getCache('subjectCacheGlobal') || [];
    try {
        const updated = await loadSubjectById(token, subjectId);
        if (!updated) return;
        const idx = subjectCache.findIndex((s: any) => (s._id?.$oid || s._id) === subjectId);
        if (idx !== -1) {
            subjectCache[idx] = updated;
        } else {
            subjectCache.push(updated);
        }
        subjectCacheGlobal.current = subjectCache;
        setCache('subjectCacheGlobal', subjectCache);

        const allSubjects = await loadAllSubjects(token, { force: true, preferCache: false });
        subjectCacheGlobal.current = allSubjects;
        setCache('subjectCacheGlobal', allSubjects);
    } catch (err) {
        // fallback: do nothing
    }
}
async function updateTeacherCacheFromBackend(teacherId: string) {
    const token = localStorage.getItem('user_token');
    if (!token) return;
    let teacherCache = teacherCacheGlobal.current || getCache('teacherCacheGlobal') || [];
    try {
        const updated = await loadTeacherById(token, teacherId);
        if (!updated) return;
        const idx = teacherCache.findIndex((t: any) => (t._id?.$oid || t._id) === teacherId);
        if (idx !== -1) {
            teacherCache[idx] = updated;
        } else {
            teacherCache.push(updated);
        }
        teacherCacheGlobal.current = teacherCache;
        setCache('teacherCacheGlobal', teacherCache);
    } catch (err) {
        // fallback: do nothing
    }
}

// Helper to crop [SEM1] and [SEM2] from subject names for schedule display
const cropSemesterTag = (name: string) =>
    name.replace(/\[SEM1\]|\[SEM2\]/gi, '').trim();

const getEntityId = (entity: any): string =>
    String(entity?._id?.$oid || entity?._id || entity?.id || '');

const getSubjectIdRef = (raw: any): string =>
    String(raw?.$oid || raw?.subject?.$oid || raw?.subject || raw?.id || raw || '');

const getTimeblockId = (tb: any): string =>
    String(tb?.timeblockId || tb?.blockid || tb?.id || '');

const getOrCreateTimeblockId = (tb: any): string => {
    const existing = getTimeblockId(tb);
    if (existing) return existing;
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return `tb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const getRequiredOverrideForSubject = (teacher: any, subjectId: string): any | null => {
    const overrides = teacher?.required_teach_overrides || [];
    for (const ov of overrides) {
        const ovSubjectId = getSubjectIdRef(ov?.subject);
        if (ovSubjectId && ovSubjectId === subjectId) return ov;
    }
    return null;
};

// Backend may store null/undefined for excludeextras in older data; treat it as exclude mode.
const getOverrideExcludeMode = (ov: any): boolean => ov?.excludeextras !== false;

const getTeacherCheckboxColorScheme = (teacher: any, subjectId: string): 'green' | 'yellow' => {
    const ov = getRequiredOverrideForSubject(teacher, subjectId);
    return ov && !getOverrideExcludeMode(ov) ? 'yellow' : 'green';
};

const dedupeTeachersById = (teachers: any[]): any[] => {
    const byId = new Map<string, any>();
    (teachers || []).forEach((t: any) => {
        const id = getEntityId(t);
        if (!id) return;
        byId.set(id, t);
    });
    return Array.from(byId.values());
};

const resolveTeacherByName = (teachers: any[], name: string, subjectId: string, blockId: string): any | null => {
    const normalized = cropSemesterTag(name);
    const candidates = (teachers || []).filter(
        (t: any) => cropSemesterTag(t.displayname || t.name || '') === normalized
    );
    if (!candidates.length) return null;
    const assigned = candidates.find((t: any) => isTeacherAssignedForSubjectBlock(t, subjectId, blockId));
    return assigned || candidates[0];
};

const normalizeOverridesBySubject = (overrides: any[]): any[] => {
    const bySubject = new Map<string, { subject: string; excludeextras: boolean; extratimeblocks: string[] }>();
    (overrides || []).forEach((ov: any) => {
        const sid = getSubjectIdRef(ov?.subject);
        if (!sid) return;
        const current = bySubject.get(sid);
        const incomingExtras = Array.isArray(ov?.extratimeblocks)
            ? ov.extratimeblocks.map((id: any) => String(id)).filter(Boolean)
            : [];
        const incomingExclude = ov?.excludeextras === false ? false : true;

        if (!current) {
            bySubject.set(sid, {
                subject: sid,
                excludeextras: incomingExclude,
                extratimeblocks: Array.from(new Set(incomingExtras)),
            });
            return;
        }

        bySubject.set(sid, {
            subject: sid,
            excludeextras: current.excludeextras && incomingExclude,
            extratimeblocks: Array.from(new Set([...(current.extratimeblocks || []), ...incomingExtras])),
        });
    });
    return Array.from(bySubject.values());
};

const isTeacherAssignedForSubjectBlock = (teacher: any, subjectId: string, timeblockId: string): boolean => {
    const requiredIds = (teacher?.required_teach || []).map((sid: any) => getSubjectIdRef(sid));
    if (!requiredIds.includes(subjectId)) return false;

    const ov = getRequiredOverrideForSubject(teacher, subjectId);
    if (!ov) return true;

    const extra = new Set((ov?.extratimeblocks || []).map((id: any) => String(id)));
    const excludeMode = getOverrideExcludeMode(ov);
    if (!timeblockId) return excludeMode;

    // exclude mode: show every block except those listed
    // include mode: show only listed block IDs
    return excludeMode ? !extra.has(String(timeblockId)) : extra.has(String(timeblockId));
};

const getBlockKey = (block: any): string =>
    `${block.subjectId}|${getTimeblockId(block) || `${block.start.day}|${block.start.time}|${block.end.day}|${block.end.time}`}`;

const parseIdList = (raw: string): string[] =>
    Array.from(new Set(raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)));

/** When enabled, scales all cell text until it fits inside the grid cell. When disabled, children render unchanged. */
function ScaleToFitCell({
    enabled,
    contentKey,
    children,
}: {
    enabled: boolean;
    contentKey: string;
    children: React.ReactNode;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useLayoutEffect(() => {
        if (!enabled) {
            setScale(1);
            return;
        }
        const el = containerRef.current;
        const inner = contentRef.current;
        if (!el || !inner) return;

        const measure = () => {
            // Match rendered transform so layout during measure is accurate.
            inner.style.transform = 'translateY(-50%) scale(1)';
            void inner.offsetHeight;
            const cw = el.clientWidth;
            const ch = el.clientHeight;
            if (cw <= 0 || ch <= 0) return;
            const sw = inner.scrollWidth;
            const sh = inner.scrollHeight;
            if (sw <= 0 && sh <= 0) return;
            const sx = sw > 0 ? cw / sw : 1;
            const sy = sh > 0 ? ch / sh : 1;
            const s = Math.min(1, sx, sy);
            inner.style.removeProperty('transform');
            setScale(Number.isFinite(s) && s > 0 ? s : 1);
        };

        measure();
        const ro = new ResizeObserver(() => {
            requestAnimationFrame(measure);
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [enabled, contentKey]);

    if (!enabled) {
        return <>{children}</>;
    }

    return (
        <Box
            ref={containerRef}
            position="relative"
            flex={1}
            alignSelf="stretch"
            w="100%"
            minH={0}
            minW={0}
            overflow="hidden"
        >
            <Box
                ref={contentRef}
                position="absolute"
                left={0}
                right={0}
                top="50%"
                w="100%"
                maxW="100%"
                boxSizing="border-box"
                sx={{
                    // Full cell width so text wraps at the column edge, not shrink-to-fit narrow.
                    transform: `translateY(-50%) scale(${scale})`,
                    transformOrigin: 'center center',
                }}
            >
                {children}
            </Box>
        </Box>
    );
}

function ScheduleItem() {
    // Helper: do PUT first, then in background refresh cache (GET). Down arrow = PUT, up arrow = GET.
    const executePutWithSaving = async (putFn: () => Promise<void>, getSubjectIdsAfter?: string | string[]) => {
        setRequestState('put');
        try {
            await putFn();
            setRequestState('saved');

            if (getSubjectIdsAfter) {
                const ids = Array.isArray(getSubjectIdsAfter) ? getSubjectIdsAfter : [getSubjectIdsAfter];
                // Start GET immediately in background, but only show up arrow after 1s checkmark
                const getPromise = Promise.all(ids.map((sid: string) => updateSubjectCacheFromBackend(sid)));
                setTimeout(() => {
                    setRequestState('get');
                    getPromise.finally(() => setRequestState('idle'));
                }, 1000);
            } else {
                setTimeout(() => setRequestState('idle'), 1000);
            }
        } catch (err) {
            setRequestState('idle');
            throw err;
        }
    };
    const { id } = useParams();
    const [item, setItem] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [timeblocks, setTimeblocks] = useState<any[]>([]);
    const [dragHover, setDragHover] = useState<{ day: string; time: string } | null>(null);
    const [hoverSubject, setHoverSubject] = useState<any>(null);
    const [loadedSubjectId, setLoadedSubjectId] = useState<string | null>(null);
    const hoverTimeout = useRef<NodeJS.Timeout | null>(null);
    const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
    const [shiftHeld, setShiftHeld] = useState(false);
    const [cmdHeld, setCmdHeld] = useState(false);
    const [stableHoverTime, setStableHoverTime] = useState<string | null>(null);
    const { availability } = useContext(AvailabilityContext);
    const [draggedTeacherBusy, setDraggedTeacherBusy] = useState<TimeBlock[]>([]);
    const [overlappingTeacherSchedules, setOverlappingTeacherSchedules] = useState<any[]>([]);
    const [swapReplaceHover, setSwapReplaceHover] = useState<{
        blockIndex: number;
        side: 'swap' | 'replace';
    } | null>(null);
    const [draggedBlockIndex, setDraggedBlockIndex] = useState<number | null>(null);
    const teacherCacheRef = useRef<any[] | null>(null);
    const [showEndTime, setShowEndTime] = useState<boolean>(false);
    const [hideTeacherNames, setHideTeacherNames] = useState<boolean>(false);
    const [scaleTextToFitCell, setScaleTextToFitCell] = useState<boolean>(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);
    const [advancedOrigStart, setAdvancedOrigStart] = useState('');
    const [advancedOrigEnd, setAdvancedOrigEnd] = useState('');
    const [advancedNewStart, setAdvancedNewStart] = useState('');
    const [advancedNewEnd, setAdvancedNewEnd] = useState('');
    const [advancedDays, setAdvancedDays] = useState<Record<string, boolean>>({
        Monday: true, Tuesday: true, Wednesday: true, Thursday: true, Friday: true,
    });
    const [replaceInProgress, setReplaceInProgress] = useState(false);
    const [replaceMessage, setReplaceMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [advancedDropTarget, setAdvancedDropTarget] = useState<'original' | 'new' | null>(null);
    const [requestState, setRequestState] = useState<'idle' | 'put' | 'saved' | 'get'>('idle');
    const [pendingCheckboxUpdates, setPendingCheckboxUpdates] = useState<Record<string, boolean>>({}); // key: teacherId|subjectId|blockId
    const pendingCheckboxUpdatesRef = useRef<Record<string, boolean>>({});
    const optimisticTeacherByIdRef = useRef<Record<string, any>>({});
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const [hiddenDays, setHiddenDays] = useState<Record<string, boolean>>({
        Monday: false,
        Tuesday: false,
        Wednesday: false,
        Thursday: false,
        Friday: false,
    });
    const [dayMenu, setDayMenu] = useState<{ day: string; x: number; y: number } | null>(null);
    const [hiddenPeriodKeys, setHiddenPeriodKeys] = useState<Record<string, boolean>>({});
    const [teacherIdsInput, setTeacherIdsInput] = useState('');
    const [appliedTeacherIds, setAppliedTeacherIds] = useState<string[]>([]);
    const [resolvedTeachers, setResolvedTeachers] = useState<any[]>([]);
    const [teacherOverlayLoading, setTeacherOverlayLoading] = useState(false);
    const [teacherOverlayError, setTeacherOverlayError] = useState<string | null>(null);
    const [settingsBlob, setSettingsBlob] = useState('');
    const [settingsMessage, setSettingsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
    const computeBusyRanges = (availability: TimeBlock[]): TimeBlock[] => {
        const busyRanges: TimeBlock[] = [];
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

        for (const day of days) {
            const rawDaySlots = availability
                .filter(r => r.start.day === day)
                .filter(r => timeToMinutes(r.end.time) > timeToMinutes(r.start.time))
                .map(r => ({
                    start: { ...r.start },
                    end: { ...r.end },
                }))
                .sort((a, b) => timeToMinutes(a.start.time) - timeToMinutes(b.start.time));

            const daySlots: TimeBlock[] = [];
            rawDaySlots.forEach((slot) => {
                if (!daySlots.length) {
                    daySlots.push(slot);
                    return;
                }

                const last = daySlots[daySlots.length - 1];
                const lastEnd = timeToMinutes(last.end.time);
                const slotStart = timeToMinutes(slot.start.time);
                const slotEnd = timeToMinutes(slot.end.time);

                // Merge same-day overlaps/adjacent ranges so busy shading does not stack.
                if (slotStart <= lastEnd) {
                    if (slotEnd > lastEnd) {
                        last.end.time = slot.end.time;
                    }
                } else {
                    daySlots.push(slot);
                }
            });

            if (daySlots.length === 0) {
                // Entire day is busy
                busyRanges.push({
                    start: { day, time: '00:00' },
                    end:   { day, time: '23:59' },
                });
                continue;
            }

            // Start of day → first available
            if (timeToMinutes(daySlots[0].start.time) > 0) {
                busyRanges.push({
                    start: { day, time: '00:00' },
                    end:   { day, time: daySlots[0].start.time },
                });
            }

            // Gaps between slots
            for (let i = 0; i < daySlots.length - 1; i++) {
                const currentEnd = daySlots[i].end.time;
                const nextStart = daySlots[i + 1].start.time;

                if (timeToMinutes(currentEnd) < timeToMinutes(nextStart)) {
                    busyRanges.push({
                        start: { day, time: currentEnd },
                        end:   { day, time: nextStart },
                    });
                }
            }

            // Last available → end of day
            const lastEnd = daySlots[daySlots.length - 1].end.time;
            if (timeToMinutes(lastEnd) < timeToMinutes('23:59')) {
                busyRanges.push({
                    start: { day, time: lastEnd },
                    end:   { day, time: '23:59' },
                });
            }
        }

        return busyRanges;
    };
    const fetchTeacherBusyRanges = async (subject: any) => {
        if (item?.type !== "Student" || !subject.teachers?.length) {
            setDraggedTeacherBusy([]);
            return;
        }
        // Use global cache
        const allTeachers = teacherCacheGlobal.current;
        if (!allTeachers) { setDraggedTeacherBusy([]); return; }
        const subjectTeacherNames = subject.teachers;
        const matched = (allTeachers ?? []).filter((t: any) =>
            subjectTeacherNames.includes(t.displayname) ||
            subjectTeacherNames.includes(t.name)
        );
        const busy: TimeBlock[] = [];
        for (const t of matched) {
            const avail = t.availability || [];
            if (avail.length === 0) {
                ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(day => {
                    busy.push({ start: { day, time: '00:00' }, end: { day, time: '23:59' } });
                });
            } else {
                busy.push(...computeBusyRanges(avail));
            }
        }
        setDraggedTeacherBusy(busy);
    };

    const fetchOverlappingTeacherSchedules = async (subject: any) => {
        if (item?.type !== "Student" || !subject.teachers?.length) {
            setOverlappingTeacherSchedules([]);
            return;
        }
        // Use global cache
        const allTeachers = teacherCacheGlobal.current;
        const allSubjects = subjectCacheGlobal.current;
        if (!allTeachers || !allSubjects) { setOverlappingTeacherSchedules([]); return; }
        const subjectTeacherNames = subject.teachers;
        const matched = (allTeachers ?? []).filter((t: any) =>
            subjectTeacherNames.includes(t.displayname) ||
            subjectTeacherNames.includes(t.name)
        );
        const seenBlocks = new Set();
        const overlappingBlocks: any[] = [];
        for (const teacher of matched) {
            // Get teacher's schedule by filtering cached subjects
            const requiredSet = new Set((teacher.required_teach || []).map((sid: any) => sid.$oid || sid));
            const subjectIdSet = new Set(
                [...(teacher.required_teach || []), ...(teacher.can_teach || [])].map(sid => sid.$oid || sid)
            );
            const uniqueSubjectIds = Array.from(subjectIdSet);
            for (const subjId of uniqueSubjectIds) {
                const subj = allSubjects.find((s: any) => (s._id?.$oid || s._id) === subjId);
                if (!subj) continue;
                (subj.timeblocks || []).forEach((tb: any) => {
                    const tbId = getTimeblockId(tb) || getOrCreateTimeblockId(tb);
                    if (requiredSet.has(subjId) && !isTeacherAssignedForSubjectBlock(teacher, String(subjId), tbId)) {
                        return;
                    }
                    // Use a unique key for each block: subjectId|day|start|end
                    const key = `${subj._id.$oid || subj._id}|${tbId}`;
                    if (!seenBlocks.has(key)) {
                        seenBlocks.add(key);
                        overlappingBlocks.push({
                            subjectId: subj._id.$oid || subj._id,
                            ...tb,
                            timeblockId: tbId,
                            color: subj.color,
                            name: subj.displayname || subj.name,
                            displayclass: subj.displayclass, // ensure displayclass is included
                            teacherName: teacher.displayname || teacher.name,
                            opacity: 0.5
                        });
                    }
                });
            }
        }
        setOverlappingTeacherSchedules(overlappingBlocks);
    };

    const handleSwapBlocks = async (draggedBlockIndex: number, targetBlockIndex: number) => {
        const draggedBlock = timeblocks[draggedBlockIndex];
        const targetBlock = timeblocks[targetBlockIndex];

        // Swap the start and end times
        const newTimeblocks = [...timeblocks];
        newTimeblocks[draggedBlockIndex] = {
            ...draggedBlock,
            start: targetBlock.start,
            end: targetBlock.end
        };
        newTimeblocks[targetBlockIndex] = {
            ...targetBlock,
            start: draggedBlock.start,
            end: draggedBlock.end
        };

        // Update state optimistically
        setTimeblocks(newTimeblocks);

        // Update both subjects in the backend
        const token = localStorage.getItem("user_token");
        try {
            await executePutWithSaving(async () => {
                // Update dragged subject
                await axios.put(`${API_BASE}/subject/${draggedBlock.subjectId}/update`, {
                    timeblocks: newTimeblocks
                        .filter(tb => tb.subjectId === draggedBlock.subjectId)
                        .map(tb => ({
                            startday: tb.start.day,
                            starttime: tb.start.time,
                            endday: tb.end.day,
                            endtime: tb.end.time,
                            blockid: getOrCreateTimeblockId(tb),
                        }))
                }, { headers: { Authorization: token } });

                // Update target subject
                await axios.put(`${API_BASE}/subject/${targetBlock.subjectId}/update`, {
                    timeblocks: newTimeblocks
                        .filter(tb => tb.subjectId === targetBlock.subjectId)
                        .map(tb => ({
                            startday: tb.start.day,
                            starttime: tb.start.time,
                            endday: tb.end.day,
                            endtime: tb.end.time,
                            blockid: getOrCreateTimeblockId(tb),
                        }))
                }, { headers: { Authorization: token } });
            }, [draggedBlock.subjectId, targetBlock.subjectId]);
        } catch (err) {
            console.error("❌ Failed to swap blocks:", err);
            // Revert on error
            setTimeblocks(timeblocks);
        }
    };

    const handleReplaceBlock = async (draggedBlockIndex: number, targetBlockIndex: number) => {
        const draggedBlock = timeblocks[draggedBlockIndex];
        const targetBlock = timeblocks[targetBlockIndex];

        // Remove the target block and add the dragged block to target's subject
        const newTimeblocks = timeblocks.filter((_, idx) => idx !== targetBlockIndex);
        
        // Update the dragged block to have the target's position
        const updatedDraggedBlock = {
            ...draggedBlock,
            start: targetBlock.start,
            end: targetBlock.end
        };

        // Find the index of the dragged block in the new array
        const newDraggedIndex = newTimeblocks.findIndex((_, idx) => 
            idx === draggedBlockIndex || (idx > draggedBlockIndex && idx - 1 === draggedBlockIndex)
        );
        
        if (newDraggedIndex !== -1) {
            newTimeblocks[newDraggedIndex] = updatedDraggedBlock;
        }

        // Update state optimistically
        setTimeblocks(newTimeblocks);

        // Update both subjects in the backend
        const token = localStorage.getItem("user_token");
        try {
            await executePutWithSaving(async () => {
                // Update dragged subject (add the new position)
                const draggedSubjectBlocks = newTimeblocks
                    .filter(tb => tb.subjectId === draggedBlock.subjectId)
                    .map(tb => ({
                        startday: tb.start.day,
                        starttime: tb.start.time,
                        endday: tb.end.day,
                        endtime: tb.end.time,
                        blockid: getOrCreateTimeblockId(tb),
                    }));
                
                await axios.put(`${API_BASE}/subject/${draggedBlock.subjectId}/update`, {
                    timeblocks: draggedSubjectBlocks
                }, { headers: { Authorization: token } });

                // Update target subject (remove the old block)
                const targetSubjectBlocks = newTimeblocks
                    .filter(tb => tb.subjectId === targetBlock.subjectId)
                    .map(tb => ({
                        startday: tb.start.day,
                        starttime: tb.start.time,
                        endday: tb.end.day,
                        endtime: tb.end.time,
                        blockid: getOrCreateTimeblockId(tb),
                    }));
                
                await axios.put(`${API_BASE}/subject/${targetBlock.subjectId}/update`, {
                    timeblocks: targetSubjectBlocks
                }, { headers: { Authorization: token } });
            }, [draggedBlock.subjectId, targetBlock.subjectId]);
        } catch (err) {
            console.error("❌ Failed to replace block:", err);
            // Revert on error
            setTimeblocks(timeblocks);
        }
    };
    // For teacher view, prefer live availability context so edits render immediately.
    let teacherAvailability = availability;
    const busyRanges = item?.type === "Teacher" ? computeBusyRanges(teacherAvailability) : [];
    const [editingBlock, setEditingBlock] = useState<{
        index: number;
        start: string;
        end: string;
    } | null>(null);
    // ↪️ near top of ScheduleItem()
    const stableSortedTimesRef = useRef<string[]>([]);

    useEffect(() => {
        const handle = (e: KeyboardEvent) => {
            setShiftHeld(e.shiftKey);
            setCmdHeld(e.metaKey); // Cmd key on Mac, Ctrl on Windows/Linux
        };
        window.addEventListener("keydown", handle);
        window.addEventListener("keyup", handle);
        return () => {
            window.removeEventListener("keydown", handle);
            window.removeEventListener("keyup", handle);
        };
    }, []);

    // Handle Cmd key changes for overlapping teacher schedules
    useEffect(() => {
        if (cmdHeld && hoverSubject && item?.type === "Student") {
            // Use a more efficient approach - don't block the UI
            setTimeout(() => {
                if (cmdHeld && hoverSubject) { // Double check in case state changed
                    fetchOverlappingTeacherSchedules(hoverSubject);
                }
            }, 0);
        } else if (!cmdHeld) {
            setOverlappingTeacherSchedules([]);
        }
    }, [cmdHeld, hoverSubject, item?.type]);

    // Clear teacher busy state when not dragging
    useEffect(() => {
        if (!dragHover && !swapReplaceHover && !draggedBlockIndex) {
            setDraggedTeacherBusy([]);
        }
    }, [dragHover, swapReplaceHover, draggedBlockIndex]);
    const [resizing, setResizing] = useState<{
        blockIndex: number;
        direction: "top"|"bottom";
        day: string;
        time: string;
    } | null>(null);
    useEffect(() => {
        if (!resizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const hovered = document.elementFromPoint(e.clientX, e.clientY);
            const cell = hovered?.closest("[data-time][data-day]") as HTMLElement|null;
            if (!cell || !resizing) return;

            const newDay  = cell.dataset.day!;
            const newTime = cell.dataset.time!;

            setResizing({
                ...resizing,
                day:  newDay,
                time: newTime,
            });
        };
        const handleMouseUp = async () => {
            if (!resizing) return;

            const { blockIndex, direction, day, time } = resizing;

            // 1) Build the new timeblocks array with the resized block applied
            const newTimeblocks = timeblocks.map((blk, idx) => {
                if (idx !== blockIndex) return blk;
                return {
                    ...blk,
                    // if resizing top, update start; if bottom, update end
                    start: direction === "top"    ? { day, time } : blk.start,
                    end:   direction === "bottom" ? { day, time } : blk.end,
                };
            });

            // 2) Update state immediately so the UI reflects the change
            setTimeblocks(newTimeblocks);

            // 3) Prepare payload for only this subject’s blocks
            const subjectId = newTimeblocks[blockIndex].subjectId;
            const payloadBlocks = newTimeblocks
                .filter(tb => tb.subjectId === subjectId)
                .map(tb => ({
                    startday:  tb.start.day,
                    starttime: tb.start.time,
                    endday:    tb.end.day,
                    endtime:   tb.end.time,
                    blockid: getOrCreateTimeblockId(tb),
                }));

            // 4) Send update to server
            try {
                const token = localStorage.getItem("user_token");
                await axios.put(
                    `${API_BASE}/subject/${subjectId}/update`,
                    { timeblocks: payloadBlocks },
                    { headers: { Authorization: token } }
                );
                await updateSubjectCacheFromBackend(subjectId);
            } catch (err) {
                console.error("❌ Failed to save resized block:", err);
            }

            // 5) Cleanup
            setResizing(null);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);

        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [resizing, timeblocks]);
    const getOverlaps = () => {
        const overlaps: {
            day: string;
            start: string;
            end: string;
            blocks: any[];
        }[] = [];

        for (let i = 0; i < timeblocks.length; i++) {
            for (let j = i + 1; j < timeblocks.length; j++) {
                const a = timeblocks[i];
                const b = timeblocks[j];

                if (hiddenDays[a.start.day] || hiddenDays[b.start.day]) continue;
                if (hiddenPeriodKeys[getBlockKey(a)] || hiddenPeriodKeys[getBlockKey(b)]) continue;

                if (a.start.day !== b.start.day) continue;

                // ⛔ Skip if same block (same subject & displayclass)
                const sameDisplay = a.displayclass && b.displayclass && a.displayclass === b.displayclass;
                const sameSubject = a.subjectId === b.subjectId;

                if (sameSubject && (sameDisplay || !a.displayclass || !b.displayclass)) continue;

                const startA = timeToMinutes(a.start.time);
                const endA = timeToMinutes(a.end.time);
                const startB = timeToMinutes(b.start.time);
                const endB = timeToMinutes(b.end.time);

                const latestStart = Math.max(startA, startB);
                const earliestEnd = Math.min(endA, endB);

                if (latestStart < earliestEnd) {
                    overlaps.push({
                        day: a.start.day,
                        start: minutesToTime(latestStart),
                        end: minutesToTime(earliestEnd),
                        blocks: [a, b],
                    });
                }
            }
        }

        return overlaps;
    };
    const overlaps = getOverlaps();
    // useEffect(() => {
    //     const handleKeyDown = (e: KeyboardEvent) => {
    //         if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    //             setShiftHeld(true);
    //         }
    //     };
    //     const handleKeyUp = (e: KeyboardEvent) => {
    //         if (e.code === "ShiftLeft" || e.code === "ShiftRight") {
    //             setShiftHeld(false);
    //         }
    //     };
    //
    //     window.addEventListener("keydown", handleKeyDown);
    //     window.addEventListener("keyup", handleKeyUp);
    //     return () => {
    //         window.removeEventListener("keydown", handleKeyDown);
    //         window.removeEventListener("keyup", handleKeyUp);
    //     };
    // }, []);
    useEffect(() => {
        const handleKeyDown = async (e: KeyboardEvent) => {
            if ((e.key === "Backspace" || e.key === "Delete") && selectedBlockIndex !== null) {
                console.log("🔥 DELETE KEY PRESSED");

                const token = localStorage.getItem("user_token");
                const block = timeblocks[selectedBlockIndex];
                const subjectId = block.subjectId;
                const newTimeblocks = timeblocks.filter((_, idx) => idx !== selectedBlockIndex);

                // Update state optimistically
                setTimeblocks(newTimeblocks);
                setSelectedBlockIndex(null);

                try {
                    await executePutWithSaving(async () => {
                        await axios.put(`${API_BASE}/subject/${subjectId}/update`, {
                        // only send *that* subject’s updated blocks
                        timeblocks: newTimeblocks
                            .filter(tb => tb.subjectId === subjectId)
                            .map(tb => ({
                                startday: tb.start.day,
                                starttime: tb.start.time,
                                endday: tb.end.day,
                                endtime: tb.end.time,
                                blockid: getOrCreateTimeblockId(tb),
                            }))
                    }, {
                        headers: { Authorization: token }
                    });
                    }, subjectId);
                } catch (err) {
                    console.error("❌ Failed to delete block from backend:", err);
                    // Revert on error
                    setTimeblocks(timeblocks);
                }
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [selectedBlockIndex, timeblocks, item]);
    useEffect(() => {
        const handler = () => {
            setDragHover(null);
            setHoverSubject(null);
            setLoadedSubjectId(null);
            setOverlappingTeacherSchedules([]);
            setSwapReplaceHover(null);
            setDraggedBlockIndex(null);
            setDraggedTeacherBusy([]);
            setAdvancedDropTarget(null);
        };
        window.addEventListener("clearDragPreview", handler);
        return () => window.removeEventListener("clearDragPreview", handler);
    }, []);
    useEffect(() => {
        const onDragEnd = () => setAdvancedDropTarget(null);
        window.addEventListener('dragend', onDragEnd);
        return () => window.removeEventListener('dragend', onDragEnd);
    }, []);
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token || !id) return;

        const fetchData = async () => {
            try {
                const student = await loadStudentById(token, id, { allow404: true });
                if (student) {
                    setItem({ type: "Student", ...student });

                    const allTeachers = await loadAllTeachers(token, { preferCache: false });

                    const subjectIds = (student.required_classes || []).map((rc: any) => rc.$oid || rc);
                    let blocks: any[] = [];
                    if (subjectIds.length > 0) {
                        const batchRes = await axios.post(`${API_BASE}/subject/batch`, { ids: subjectIds }, {
                            headers: { Authorization: token }
                        });
                        const subjects = batchRes.data;
                        for (const subj of subjects) {
                            (subj.timeblocks || []).forEach((tb: any) => {
                                const tbId = getTimeblockId(tb) || getOrCreateTimeblockId(tb);
                                const teacherNames: string[] = allTeachers
                                    .filter((t: any) => isTeacherAssignedForSubjectBlock(t, subj._id?.$oid || subj._id, tbId))
                                    .map((t: any) => t.displayname || t.name);
                                blocks.push({
                                    subjectId: subj._id.$oid || subj._id,
                                    ...tb,
                                    timeblockId: tbId,
                                    color: subj.color,
                                    name: subj.displayname,
                                    teachers: teacherNames
                                });
                            });
                        }
                    }
                    setTimeblocks(blocks);
                    return;
                }

                const teacher = await loadTeacherById(token, id, { allow404: true });
                if (teacher) {
                    setItem({ type: "Teacher", ...teacher });

                    const subjectIdSet = new Set(
                        [...(teacher.required_teach || []), ...(teacher.can_teach || [])].map((sid: any) => sid.$oid || sid)
                    );
                    const uniqueSubjectIds = Array.from(subjectIdSet);
                    let blocks: any[] = [];
                    if (uniqueSubjectIds.length > 0) {
                        const batchRes = await axios.post(`${API_BASE}/subject/batch`, { ids: uniqueSubjectIds }, {
                            headers: { Authorization: token }
                        });
                        const subjects = batchRes.data;
                        const requiredSet = new Set((teacher.required_teach || []).map((sid: any) => sid.$oid || sid));
                        for (const subj of subjects) {
                            (subj.timeblocks || []).forEach((tb: any) => {
                                const tbId = getTimeblockId(tb) || getOrCreateTimeblockId(tb);
                                const subjId = subj._id.$oid || subj._id;
                                if (requiredSet.has(subjId) && !isTeacherAssignedForSubjectBlock(teacher, subjId, tbId)) {
                                    return;
                                }
                                blocks.push({
                                    subjectId: subjId,
                                    ...tb,
                                    timeblockId: tbId,
                                    color: subj.color,
                                    name: subj.displayname,
                                    displayclass: subj.displayclass,
                                });
                            });
                        }
                    }
                    setTimeblocks(blocks);
                    return;
                }

                const subject = await loadSubjectById(token, id, { allow404: true });
                if (!subject) {
                    setItem(null);
                    return;
                }

                setItem({ type: "Subject", ...subject });
                const blocks = (subject.timeblocks || []).map((tb: any) => ({
                    subjectId: subject._id.$oid || subject._id,
                    ...tb,
                    timeblockId: getTimeblockId(tb) || getOrCreateTimeblockId(tb),
                    color: subject.color,
                    name: subject.displayname || subject.name
                }));
                setTimeblocks(blocks);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [id, refreshTrigger]);

    // Set dynamic page title based on item type and name
    usePageTitle(item ? `${item.type}: ${item.displayname || item.name}` : 'Schedule Manager');

    // Handle Excel export
    const handleExportToExcel = async () => {
        console.log('🟢 Export button clicked');
        console.log('📊 Item data:', item);
        console.log('📅 Timeblocks:', timeblocks);
        console.log('⏰ Sorted times:', sortedTimes);

        if (!item) {
            alert('No item data available for export');
            return;
        }

        if (timeblocks.length === 0) {
            alert('No schedule blocks to export. Please add some subjects to the schedule first.');
            return;
        }

        if (!sortedTimes || sortedTimes.length === 0) {
            alert('No time data available for export. Please ensure the schedule has valid time slots.');
            return;
        }

        try {
            console.log('🚀 Starting full schedule export with formatting...');
            await exportScheduleToExcel(timeblocks, item, sortedTimes, hideTeacherNames, showEndTime);
            console.log('✅ Excel export completed successfully');
        } catch (error) {
            console.error('❌ Failed to export schedule:', error);
            console.error('Error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : 'No stack trace'
            });
            alert(`Failed to export schedule: ${error instanceof Error ? error.message : 'Unknown error'}\n\nCheck the browser console for detailed error information.`);
        }
    };

    // Advanced: replace all blocks matching original time frame with new time frame (one PUT per subject)
    const handleReplaceTimeFrame = async () => {
        if (!advancedOrigStart || !advancedOrigEnd || !advancedNewStart || !advancedNewEnd) {
            setReplaceMessage({ type: 'error', text: 'Please fill in all four time fields.' });
            return;
        }
        const origStart = advancedOrigStart;
        const origEnd = advancedOrigEnd;
        const newStart = advancedNewStart;
        const newEnd = advancedNewEnd;

        const selectedDays = (Object.keys(advancedDays) as string[]).filter((d) => advancedDays[d]);
        if (selectedDays.length === 0) {
            setReplaceMessage({ type: 'error', text: 'Select at least one day to apply the replace.' });
            return;
        }
        const matchingBlocks = timeblocks.filter(
            (tb: any) =>
                advancedDays[tb.start.day] &&
                tb.start.time === origStart &&
                tb.end.time === origEnd
        );
        if (matchingBlocks.length === 0) {
            setReplaceMessage({ type: 'error', text: 'No blocks found matching that original time frame on the selected days.' });
            return;
        }

        const bySubject = new Map<string, any[]>();
        for (const tb of timeblocks) {
            const sid = tb.subjectId;
            if (!bySubject.has(sid)) bySubject.set(sid, []);
            bySubject.get(sid)!.push(tb);
        }

        const subjectIdsToUpdate = Array.from(new Set(matchingBlocks.map((b: any) => b.subjectId)));
        setReplaceMessage(null);
        setReplaceInProgress(true);
        const token = localStorage.getItem('user_token');
        const results: { subjectId: string; ok: boolean }[] = [];

        for (const subjectId of subjectIdsToUpdate) {
            try {
                const subjectBlocks = bySubject.get(subjectId) || [];
                const updatedBlocks = subjectBlocks.map((tb: any) => {
                    if (
                        advancedDays[tb.start.day] &&
                        tb.start.time === origStart &&
                        tb.end.time === origEnd
                    ) {
                        return {
                            ...tb,
                            start: { ...tb.start, time: newStart },
                            end: { ...tb.end, time: newEnd },
                        };
                    }
                    return tb;
                });
                const payload = updatedBlocks.map((tb: any) => ({
                    startday: tb.start.day,
                    starttime: tb.start.time,
                    endday: tb.end.day,
                    endtime: tb.end.time,
                    blockid: getOrCreateTimeblockId(tb),
                }));
                await axios.put(`${API_BASE}/subject/${subjectId}/update`, { timeblocks: payload }, {
                    headers: { Authorization: token }
                });
                await updateSubjectCacheFromBackend(subjectId);
                results.push({ subjectId, ok: true });
            } catch (err) {
                console.error('Replace time frame failed for subject', subjectId, err);
                results.push({ subjectId, ok: false });
            }
        }

        setReplaceInProgress(false);
        const failed = results.filter((r) => !r.ok).length;
        if (failed === 0) {
            setReplaceMessage({ type: 'success', text: `All ${results.length} subject(s) updated. Refreshing…` });
            setRefreshTrigger((t) => t + 1);
        } else {
            setReplaceMessage({ type: 'error', text: `${failed} of ${results.length} subject(s) failed to update.` });
        }
    };

    const applySettingsPayload = (payload: any) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid settings payload');
        }
        if (payload.advancedDays && typeof payload.advancedDays === 'object') {
            setAdvancedDays((prev) => ({ ...prev, ...payload.advancedDays }));
        }
        if (typeof payload.advancedOrigStart === 'string') setAdvancedOrigStart(payload.advancedOrigStart);
        if (typeof payload.advancedOrigEnd === 'string') setAdvancedOrigEnd(payload.advancedOrigEnd);
        if (typeof payload.advancedNewStart === 'string') setAdvancedNewStart(payload.advancedNewStart);
        if (typeof payload.advancedNewEnd === 'string') setAdvancedNewEnd(payload.advancedNewEnd);
        if (typeof payload.showEndTime === 'boolean') setShowEndTime(payload.showEndTime);
        if (typeof payload.hideTeacherNames === 'boolean') setHideTeacherNames(payload.hideTeacherNames);
        if (typeof payload.scaleTextToFitCell === 'boolean') setScaleTextToFitCell(payload.scaleTextToFitCell);
        if (payload.hiddenDays && typeof payload.hiddenDays === 'object') {
            setHiddenDays((prev) => ({ ...prev, ...payload.hiddenDays }));
        }

        if (Array.isArray(payload.hiddenPeriodKeys)) {
            const map: Record<string, boolean> = {};
            payload.hiddenPeriodKeys.forEach((k: string) => {
                if (typeof k === 'string') map[k] = true;
            });
            setHiddenPeriodKeys(map);
        } else if (payload.hiddenPeriodKeys && typeof payload.hiddenPeriodKeys === 'object') {
            setHiddenPeriodKeys(payload.hiddenPeriodKeys);
        }

        if (typeof payload.teacherIdsInput === 'string') setTeacherIdsInput(payload.teacherIdsInput);
        if (Array.isArray(payload.appliedTeacherIds)) {
            setAppliedTeacherIds(payload.appliedTeacherIds.filter((id: any) => typeof id === 'string'));
        }
    };

    const buildSettingsPayload = () => ({
        version: 1,
        advancedDays,
        advancedOrigStart,
        advancedOrigEnd,
        advancedNewStart,
        advancedNewEnd,
        hiddenDays,
        hiddenPeriodKeys: Object.keys(hiddenPeriodKeys).filter((k) => hiddenPeriodKeys[k]),
        teacherIdsInput,
        appliedTeacherIds,
        showEndTime,
        hideTeacherNames,
        scaleTextToFitCell,
    });

    const handleCopySettings = async () => {
        const text = JSON.stringify(buildSettingsPayload());
        setSettingsBlob(text);
        try {
            await navigator.clipboard.writeText(text);
            setSettingsMessage({ type: 'success', text: 'Settings copied to clipboard and pasted into the box below.' });
        } catch {
            setSettingsMessage({ type: 'success', text: 'Clipboard access failed, but settings were generated in the box below.' });
        }
    };

    const handlePasteSettings = () => {
        try {
            const parsed = JSON.parse(settingsBlob);
            applySettingsPayload(parsed);
            setSettingsMessage({ type: 'success', text: 'Settings applied successfully.' });
        } catch (err) {
            setSettingsMessage({
                type: 'error',
                text: `Failed to parse settings: ${err instanceof Error ? err.message : 'Unknown error'}`,
            });
        }
    };

    const handleApplyTeacherIds = async () => {
        const ids = parseIdList(teacherIdsInput);
        setAppliedTeacherIds(ids);
        setTeacherOverlayError(null);

        if (ids.length === 0) {
            setResolvedTeachers([]);
            return;
        }

        const token = localStorage.getItem('user_token');
        if (!token) {
            setTeacherOverlayError('Missing auth token. Please sign in again.');
            return;
        }

        setTeacherOverlayLoading(true);
        try {
            const cached = teacherCacheGlobal.current || getCache('teacherCacheGlobal') || [];
            const cachedById = new Map<string, any>();
            (cached || []).forEach((t: any) => {
                cachedById.set(getEntityId(t), t);
            });

            const resolved: any[] = [];
            const missing: string[] = [];

            ids.forEach((teacherId) => {
                const hit = cachedById.get(teacherId);
                if (hit) {
                    resolved.push(hit);
                } else {
                    missing.push(teacherId);
                }
            });

            for (const teacherId of missing) {
                try {
                    const res = await axios.get(`${API_BASE}/teacher/${teacherId}`, {
                        headers: { Authorization: token }
                    });
                    resolved.push(res.data);
                } catch {
                    // Keep going so valid IDs still work.
                }
            }

            if (resolved.length < ids.length) {
                const foundIds = new Set(resolved.map((t) => getEntityId(t)));
                const notFound = ids.filter((teacherId) => !foundIds.has(teacherId));
                setTeacherOverlayError(`Some teacher IDs were not found: ${notFound.join(', ')}`);
            }

            const mergedById = new Map<string, any>();
            (cached || []).forEach((t: any) => mergedById.set(getEntityId(t), t));
            resolved.forEach((t: any) => mergedById.set(getEntityId(t), t));
            const mergedTeachers = Array.from(mergedById.values());
            teacherCacheGlobal.current = mergedTeachers;
            setCache('teacherCacheGlobal', mergedTeachers);

            setResolvedTeachers(resolved);
        } finally {
            setTeacherOverlayLoading(false);
        }
    };

    const handleCopyCurrentTeacherId = async () => {
        if (item?.type !== 'Teacher') return;
        const teacherId = String(item?._id?.$oid || item?._id || id || '');
        if (!teacherId) return;

        try {
            await navigator.clipboard.writeText(teacherId);
        } catch {
            const el = document.createElement('textarea');
            el.value = teacherId;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        }
    };

    const refreshSubjectTeacherNames = (subjectId: string) => {
        const allTeachers = dedupeTeachersById(teacherCacheGlobal.current || getCache('teacherCacheGlobal') || []);
        setTimeblocks((prev) =>
            prev.map((tb: any) => {
                if (tb.subjectId !== subjectId) return tb;
                const tbId = getTimeblockId(tb) || getOrCreateTimeblockId(tb);
                const names = Array.from(new Set((allTeachers || [])
                    .filter((t: any) => isTeacherAssignedForSubjectBlock(t, subjectId, tbId))
                    .map((t: any) => t.displayname || t.name)));
                return {
                    ...tb,
                    timeblockId: tbId,
                    teachers: names,
                };
            })
        );
    };

    const upsertTeacherInLocalCaches = (teacher: any) => {
        const teacherId = getEntityId(teacher);
        if (!teacherId) return;

        const mergedCache = dedupeTeachersById([
            ...(teacherCacheGlobal.current || getCache('teacherCacheGlobal') || []),
            teacher,
        ]).map((t: any) => (getEntityId(t) === teacherId ? teacher : t));

        teacherCacheGlobal.current = mergedCache;
        setCache('teacherCacheGlobal', mergedCache);

        setResolvedTeachers((prev) => {
            if (!prev || prev.length === 0) return prev;
            if (!prev.some((t: any) => getEntityId(t) === teacherId)) return prev;
            return prev.map((t: any) => (getEntityId(t) === teacherId ? teacher : t));
        });
    };

    const buildTeacherUpdateForBlock = (teacher: any, subjectId: string, timeblockId: string, checked: boolean) => {
        const requiredIds = new Set((teacher.required_teach || []).map((sid: any) => getSubjectIdRef(sid)));
        const canTeachIds = new Set((teacher.can_teach || []).map((sid: any) => getSubjectIdRef(sid)));
        const rawOverrides = normalizeOverridesBySubject((teacher.required_teach_overrides || []).map((ov: any) => ({
            subject: getSubjectIdRef(ov.subject),
            excludeextras: ov.excludeextras,
            extratimeblocks: Array.isArray(ov.extratimeblocks) ? ov.extratimeblocks.map((id: any) => String(id)) : [],
        })));

        let override = rawOverrides.find((ov: any) => ov.subject === subjectId);
        const ensureUnique = (ids: string[]): string[] => Array.from(new Set((ids || []).map(String).filter(Boolean)));
        const overrideIsExcludeMode = (ov: any): boolean => getOverrideExcludeMode(ov);

        if (checked) {
            requiredIds.add(subjectId);
            if (!override) {
                override = { subject: subjectId, excludeextras: false, extratimeblocks: [timeblockId] };
                rawOverrides.push(override);
            } else if (overrideIsExcludeMode(override)) {
                override.excludeextras = true;
                override.extratimeblocks = ensureUnique((override.extratimeblocks || []).filter((id: string) => id !== timeblockId));
            } else {
                const set = new Set(override.extratimeblocks || []);
                set.add(timeblockId);
                override.excludeextras = false;
                override.extratimeblocks = Array.from(set);
            }
        } else {
            if (!requiredIds.has(subjectId)) {
                return null;
            }
            if (!override) {
                // No existing override means "all blocks are visible"; unchecked should hide only this block.
                override = { subject: subjectId, excludeextras: true, extratimeblocks: [timeblockId] };
                rawOverrides.push(override);
            } else if (overrideIsExcludeMode(override)) {
                override.excludeextras = true;
                const set = new Set(override.extratimeblocks || []);
                set.add(timeblockId);
                override.extratimeblocks = Array.from(set);
            } else {
                override.excludeextras = false;
                override.extratimeblocks = ensureUnique((override.extratimeblocks || []).filter((id: string) => id !== timeblockId));
            }
        }

        const normalizedOverrides = normalizeOverridesBySubject(rawOverrides
            .filter((ov: any) => ov.subject && requiredIds.has(ov.subject))
            .map((ov: any) => ({
                subject: ov.subject,
                excludeextras: overrideIsExcludeMode(ov),
                extratimeblocks: ensureUnique(ov.extratimeblocks || []),
            })));

        const payload = {
            can_teach: Array.from(canTeachIds) as string[],
            required_teach: Array.from(requiredIds) as string[],
            required_teach_overrides: normalizedOverrides,
        };

        const updatedTeacher = {
            ...teacher,
            can_teach: payload.can_teach,
            required_teach: payload.required_teach,
            required_teach_overrides: payload.required_teach_overrides,
        };

        return { payload, updatedTeacher };
    };

    const applyLocalTeacherAssignments = (draftById: Record<string, any>, subjectIds: string[]) => {
        const uniqueSubjectIds = Array.from(new Set((subjectIds || []).filter(Boolean)));
        if (!uniqueSubjectIds.length) return;

        const mergedTeachers = dedupeTeachersById([
            ...(teacherCacheGlobal.current || getCache('teacherCacheGlobal') || []),
            ...(resolvedTeachers || []),
        ]).map((t: any) => draftById[getEntityId(t)] || t);

        setTimeblocks((prev) =>
            prev.map((tb: any) => {
                const subjectId = getSubjectIdRef(tb.subjectId);
                if (!uniqueSubjectIds.includes(subjectId)) return tb;
                const tbId = getTimeblockId(tb) || getOrCreateTimeblockId(tb);
                const names = Array.from(new Set(
                    mergedTeachers
                        .filter((t: any) => isTeacherAssignedForSubjectBlock(t, subjectId, tbId))
                        .map((t: any) => t.displayname || t.name)
                ));
                return {
                    ...tb,
                    timeblockId: tbId,
                    teachers: names,
                };
            })
        );
    };

    const updateTeacherBlockAssignment = async (teacher: any, block: any, checked: boolean) => {
        const teacherId = getEntityId(teacher);
        const subjectId = getSubjectIdRef(block.subjectId);
        let timeblockId = getTimeblockId(block);
        if (!timeblockId) {
            timeblockId = getOrCreateTimeblockId(block);
            setTimeblocks((prev) =>
                prev.map((tb: any) => {
                    if (tb !== block) return tb;
                    return {
                        ...tb,
                        timeblockId,
                        blockid: tb.blockid || timeblockId,
                    };
                })
            );
        }
        if (!teacherId || !subjectId || !timeblockId) return;

        // Create unique key for this checkbox
        const checkboxKey = `${teacherId}|${subjectId}|${timeblockId}`;
        pendingCheckboxUpdatesRef.current = { ...pendingCheckboxUpdatesRef.current, [checkboxKey]: checked };
        setPendingCheckboxUpdates(prev => ({ ...prev, [checkboxKey]: checked }));

        const mergedTeachers = dedupeTeachersById([
            ...(teacherCacheGlobal.current || getCache('teacherCacheGlobal') || []),
            ...(resolvedTeachers || []),
        ]);
        const fallbackTeacher = mergedTeachers.find((t: any) => getEntityId(t) === teacherId) || teacher;
        const baseTeacher = optimisticTeacherByIdRef.current[teacherId] || fallbackTeacher;
        const built = buildTeacherUpdateForBlock(baseTeacher, subjectId, timeblockId, checked);
        if (!built) {
            setPendingCheckboxUpdates((prev) => {
                const next = { ...prev };
                if (next[checkboxKey] === checked) {
                    delete next[checkboxKey];
                }
                return next;
            });
            if (pendingCheckboxUpdatesRef.current[checkboxKey] === checked) {
                const refNext = { ...pendingCheckboxUpdatesRef.current };
                delete refNext[checkboxKey];
                pendingCheckboxUpdatesRef.current = refNext;
            }
            return;
        }

        optimisticTeacherByIdRef.current = {
            ...optimisticTeacherByIdRef.current,
            [teacherId]: built.updatedTeacher,
        };
        applyLocalTeacherAssignments({ [teacherId]: built.updatedTeacher }, [subjectId]);
    };

    const discardDraftForBlock = (block: any) => {
        if (!block) return;
        const subjectId = getSubjectIdRef(block.subjectId);
        const blockId = getTimeblockId(block) || getOrCreateTimeblockId(block);
        if (!subjectId || !blockId) return;

        const pendingEntries = Object.entries(pendingCheckboxUpdatesRef.current)
            .filter(([key]) => key.endsWith(`|${subjectId}|${blockId}`));
        if (!pendingEntries.length) return;

        const teacherIds = Array.from(new Set(pendingEntries.map(([key]) => key.split('|')[0])));

        setPendingCheckboxUpdates((prev) => {
            const next = { ...prev };
            pendingEntries.forEach(([key]) => {
                delete next[key];
            });
            return next;
        });

        const refNext = { ...pendingCheckboxUpdatesRef.current };
        pendingEntries.forEach(([key]) => {
            delete refNext[key];
        });
        pendingCheckboxUpdatesRef.current = refNext;

        const optimisticNext = { ...optimisticTeacherByIdRef.current };
        teacherIds.forEach((tid) => {
            delete optimisticNext[tid];
        });
        optimisticTeacherByIdRef.current = optimisticNext;

        refreshSubjectTeacherNames(subjectId);
    };

    const openEditingBlock = (index: number, start: string, end: string) => {
        if (editingBlock && editingBlock.index !== index) {
            const previousBlock = timeblocks[editingBlock.index];
            discardDraftForBlock(previousBlock);
        }
        setEditingBlock({ index, start, end });
    };

    const closeEditingBlockWithoutSave = () => {
        if (editingBlock) {
            const currentBlock = timeblocks[editingBlock.index];
            discardDraftForBlock(currentBlock);
        }
        setEditingBlock(null);
    };

    // Fetch all teachers and all subjects once, cache globally
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token) return;
        loadAllTeachers(token).catch(() => undefined);
        loadAllSubjects(token).catch(() => undefined);
    }, []);

    const defaultMin = "08:00";
    const defaultMax = "15:00";
    const allTimesSet = new Set<string>([defaultMin, defaultMax]);

    // Only consider visible days when computing time axis
    const visibleTimeblocks = timeblocks.filter((tb: any) => !hiddenDays[tb.start.day] && !hiddenPeriodKeys[getBlockKey(tb)]);

    const requiredSubjectEntries = useMemo<Array<{ subjectId: string; name: string; blocks: any[] }>>(() => {
        if (item?.type !== 'Student') return [] as Array<{ subjectId: string; name: string; blocks: any[] }>;
        const subjectList = subjectCacheGlobal.current || getCache('subjectCacheGlobal') || [];
        const subjectById = new Map<string, any>();
        (subjectList || []).forEach((s: any) => {
            subjectById.set(getEntityId(s), s);
        });

        const ids = (item.required_classes || []).map((rc: any) => rc.$oid || rc);
        return ids
            .map((subjectId: string) => {
                const cachedSubject = subjectById.get(subjectId);
                const blocks = timeblocks.filter((tb: any) => tb.subjectId === subjectId);
                return {
                    subjectId,
                    name: cachedSubject?.displayname || cachedSubject?.name || blocks[0]?.name || subjectId,
                    blocks,
                };
            })
                .sort((a: { subjectId: string; name: string; blocks: any[] }, b: { subjectId: string; name: string; blocks: any[] }) => String(a.name).localeCompare(String(b.name)));
    }, [item, timeblocks]);

    const teacherNamesByBlock = useMemo(() => {
        const map: Record<string, string[]> = {};
        if (item?.type !== 'Student' || appliedTeacherIds.length === 0 || resolvedTeachers.length === 0) {
            return map;
        }

        const subjectList = subjectCacheGlobal.current || getCache('subjectCacheGlobal') || [];
        const subjectById = new Map<string, any>();
        (subjectList || []).forEach((s: any) => subjectById.set(getEntityId(s), s));

        const teacherBusyById = new Map<string, Array<{ day: string; start: string; end: string }>>();
        resolvedTeachers.forEach((teacher: any) => {
            const teacherId = getEntityId(teacher);
            const taughtSubjectIds = new Set(
                [...(teacher.required_teach || []), ...(teacher.can_teach || [])].map((sid: any) => sid.$oid || sid)
            );
            const requiredSet = new Set((teacher.required_teach || []).map((sid: any) => sid.$oid || sid));
            const busySlots: Array<{ day: string; start: string; end: string }> = [];
            taughtSubjectIds.forEach((subjectId) => {
                const subject = subjectById.get(subjectId);
                (subject?.timeblocks || []).forEach((tb: any) => {
                    const tbId = getTimeblockId(tb) || getOrCreateTimeblockId(tb);
                    if (requiredSet.has(subjectId) && !isTeacherAssignedForSubjectBlock(teacher, String(subjectId), tbId)) {
                        return;
                    }
                    if (tb.start?.day && tb.start?.time && tb.end?.time) {
                        busySlots.push({ day: tb.start.day, start: tb.start.time, end: tb.end.time });
                    }
                });
            });
            teacherBusyById.set(teacherId, busySlots);
        });

        const uniqueResolvedTeachers = dedupeTeachersById(resolvedTeachers || []);

        timeblocks.forEach((block: any) => {
            const blockStart = timeToMinutes(block.start.time);
            const blockEnd = timeToMinutes(block.end.time);
            const key = getBlockKey(block);
            const names: string[] = [];

            uniqueResolvedTeachers.forEach((teacher: any) => {
                const teacherId = getEntityId(teacher);
                const teacherName = cropSemesterTag(teacher.displayname || teacher.name || teacherId);
                const availabilitySlots = teacher.availability || [];

                const fitsAvailability = availabilitySlots.some((slot: any) => {
                    if (!slot?.start?.day || !slot?.start?.time || !slot?.end?.time) return false;
                    if (slot.start.day !== block.start.day) return false;
                    if (slot.end.day && slot.end.day !== block.start.day) return false;

                    const slotStart = timeToMinutes(slot.start.time);
                    const slotEnd = timeToMinutes(slot.end.time);
                    return blockStart >= slotStart && blockEnd <= slotEnd;
                });

                if (!fitsAvailability) return;

                const busySlots = teacherBusyById.get(teacherId) || [];
                const hasConflict = busySlots.some((busy) => {
                    if (busy.day !== block.start.day) return false;
                    const busyStart = timeToMinutes(busy.start);
                    const busyEnd = timeToMinutes(busy.end);
                    return !(busyEnd <= blockStart || busyStart >= blockEnd);
                });

                if (!hasConflict) {
                    names.push(teacherName);
                }
            });

            map[key] = Array.from(new Set(names));
        });

        return map;
    }, [item?.type, appliedTeacherIds, resolvedTeachers, timeblocks]);

    if (loading) {
        return (
            <Center h="100vh">
                <Spinner size="xl" />
            </Center>
        );
    }

    if (!item) {
        return (
            <Box p={4}>
                <Heading size="md">Not Found</Heading>
                <p>No student, teacher, or subject found for this ID.</p>
            </Box>
        );
    }

    // Add timeblock times
    visibleTimeblocks.forEach((tb: any) => {
        allTimesSet.add(tb.start.time);
        allTimesSet.add(tb.end.time);
    });

// Add hover preview times
    if (dragHover) {
        allTimesSet.add(dragHover.time);
        if (stableHoverTime) {
            allTimesSet.add(stableHoverTime);
        }
    }
    const getProjectedEndTime = (startTime: string, subject: any): string => {
        if (!subject) return startTime;
        const avgDuration = Math.floor((subject.minld + subject.maxld) / 2);
        const endMin = timeToMinutes(startTime) + avgDuration;
        return minutesToTime(endMin);
    };
    const allTimesMinutes = Array.from(allTimesSet).map(timeToMinutes);
    const earliestMinutes = Math.min(...allTimesMinutes);
    const latestMinutes = Math.max(...allTimesMinutes);
    const clampTime = (t: string): string => {
        const tMin = timeToMinutes(t);
        const clamped = Math.max(Math.min(tMin, latestMinutes), earliestMinutes);
        return minutesToTime(clamped);
    };

    if (item?.type === "Teacher") {
        availability.forEach(r => {
            allTimesSet.add(clampTime(r.start.time));
            allTimesSet.add(clampTime(r.end.time));
        });
        busyRanges.forEach(r => {
            allTimesSet.add(clampTime(r.start.time));
            allTimesSet.add(clampTime(r.end.time));
        });
    }
    if (item?.type === "Student" && draggedTeacherBusy.length > 0) {
        draggedTeacherBusy.forEach(r => {
            allTimesSet.add(clampTime(r.start.time));
            allTimesSet.add(clampTime(r.end.time));
        });
    }

    // Add overlapping teacher schedule times when Cmd is held
    if (cmdHeld && overlappingTeacherSchedules.length > 0) {
        overlappingTeacherSchedules.forEach((block: any) => {
            allTimesSet.add(clampTime(block.start.time));
            allTimesSet.add(clampTime(block.end.time));
        });
    }

    // Add times from blocks that might be involved in swap/replace operations
    if (swapReplaceHover && timeblocks[swapReplaceHover.blockIndex]) {
        const targetBlock = timeblocks[swapReplaceHover.blockIndex];
        allTimesSet.add(clampTime(targetBlock.start.time));
        allTimesSet.add(clampTime(targetBlock.end.time));
    }
// Convert to sorted array
    let tempSet = new Set(allTimesSet);

    const computeEndTime = (start: string, s: any): string => {
        if (s.minld && s.maxld) {
            return getProjectedEndTime(start, s);
        }
        const duration = timeToMinutes(s.end.time) - timeToMinutes(s.start.time);
        return minutesToTime(timeToMinutes(start) + duration);
    };

    if (dragHover && hoverSubject) {
        const anchor = stableHoverTime || dragHover.time;
        if (anchor) {
            const baseMin = timeToMinutes(anchor);
            const projectedEndMin = timeToMinutes(computeEndTime(anchor, hoverSubject));

            // always include the projected end
            tempSet.add(minutesToTime(projectedEndMin));

            if (shiftHeld) {
                const offsets = [-10, -5, +5, +10];
                offsets.forEach(offset => {
                    const m = baseMin + offset;
                    if (m > 0 && m < 24 * 60) {
                        tempSet.add(minutesToTime(m));
                    }
                });
            }
        }
    }
    let baseTimes = Array.from(tempSet).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));

// Only expand if interacting (dragging/resizing) and snapInterval is 5


    let sortedTimes = baseTimes;
// Insert intermediate time labels only in empty regions
    const isOccupied = (start: string, end: string) => {
        const startMin = timeToMinutes(start);
        const endMin = timeToMinutes(end);
        return visibleTimeblocks.some((tb: any) => {
            const tbStart = timeToMinutes(tb.start.time);
            const tbEnd = timeToMinutes(tb.end.time);
            return !(tbEnd <= startMin || tbStart >= endMin); // overlap check
        });
    };

    let expandedTimes: string[] = [sortedTimes[0]];
    for (let i = 0; i < sortedTimes.length - 1; i++) {
        const start = sortedTimes[i];
        const end = sortedTimes[i + 1];
        const startMin = timeToMinutes(start);
        const endMin = timeToMinutes(end);

        if (!isOccupied(start, end)) {
            let current = startMin;
            while (current + 60 < endMin) {
                current += 60;
                expandedTimes.push(minutesToTime(current));
            }
        }
        expandedTimes.push(end);
    }

    sortedTimes = Array.from(new Set(expandedTimes)).sort((a, b) => timeToMinutes(a) - timeToMinutes(b));
    // persist a stable copy to avoid mid-render mutations
    stableSortedTimesRef.current = sortedTimes;
    const timeToRowIndex: { [key: string]: number } = {};
    sortedTimes.forEach((t, i) => { timeToRowIndex[t] = i + 2; }); // start from row 2 (1 = headers)

    // Visible / hidden day helpers
    const visibleDays = allDays.filter(day => !hiddenDays[day]);

    type HiddenSegment = {
        days: string[];
        leftNeighbor?: string;
        rightNeighbor?: string;
    };

    const hiddenSegments: HiddenSegment[] = [];
    let idx = 0;
    while (idx < allDays.length) {
        const day = allDays[idx];
        if (!hiddenDays[day]) {
            idx++;
            continue;
        }
        const start = idx;
        while (idx < allDays.length && hiddenDays[allDays[idx]]) {
            idx++;
        }
        const end = idx - 1;
        const days = allDays.slice(start, idx);
        const leftNeighbor = start > 0 && !hiddenDays[allDays[start - 1]] ? allDays[start - 1] : undefined;
        const rightNeighbor = idx < allDays.length && !hiddenDays[allDays[idx]] ? allDays[idx] : undefined;
        hiddenSegments.push({ days, leftNeighbor, rightNeighbor });
    }

    const segmentByLeftNeighbor: { [key: string]: HiddenSegment } = {};
    const segmentByRightNeighbor: { [key: string]: HiddenSegment } = {};
    hiddenSegments.forEach(seg => {
        if (seg.leftNeighbor) segmentByLeftNeighbor[seg.leftNeighbor] = seg;
        if (seg.rightNeighbor) segmentByRightNeighbor[seg.rightNeighbor] = seg;
    });

    const dayToCol: { [key: string]: number } = {};
    visibleDays.forEach((day, i) => {
        dayToCol[day] = showEndTime ? 3 + i : 2 + i;
    });

    const timeIntervals = sortedTimes.map((t, i, arr) => {
        if (i === arr.length - 1) return 0;
        return timeToMinutes(arr[i + 1]) - timeToMinutes(t);
    });

    const MIN_HEIGHT = 20; // px
    const PX_PER_MINUTE = 1;

    const rowHeights = timeIntervals.map(min =>
        `${Math.max(MIN_HEIGHT, min * PX_PER_MINUTE)}px`
    );
    const gridTemplateRows = `30px ${rowHeights.join(" ")}`;

    // Make each day column keep the same width it has when all 5 are visible.
    // When you hide days, the total table width shrinks by exactly that column width.
    const dayWidthExpr = showEndTime
        ? "calc((100% - 160px) / 5)" // 2 time columns (80px each)
        : "calc((100% - 80px) / 5)"; // 1 time column (80px)

    const gridTemplateColumns = showEndTime
        ? `80px 80px repeat(${visibleDays.length}, ${dayWidthExpr})`
        : `80px repeat(${visibleDays.length}, ${dayWidthExpr})`;
    const handleDrop = async (e: React.DragEvent, day: string, time: string) => {
        const subjectId = e.dataTransfer.getData("subject_id");
        const existingIndexStr = e.dataTransfer.getData("existing_block_index");

        if (existingIndexStr) {
            const index = parseInt(existingIndexStr);
            const block = timeblocks[index];
            const subjectId = block.subjectId;
            const duration = timeToMinutes(block.end.time) - timeToMinutes(block.start.time);
            const newEndMin = timeToMinutes(time) + duration;
            const newEnd = minutesToTime(newEndMin);

            const updatedBlock = {
                ...block,
                start: { day, time },
                end: { day, time: newEnd }
            };

            const newTimeblocks = [...timeblocks];
            newTimeblocks[index] = updatedBlock;

            // Update state optimistically
            setTimeblocks(newTimeblocks);

            try {
                const token = localStorage.getItem("user_token");
                await executePutWithSaving(async () => {
                    await axios.put(`${API_BASE}/subject/${subjectId}/update`, {
                        timeblocks: newTimeblocks
                            .filter(tb => tb.subjectId === subjectId)
                            .map(tb => ({
                                startday: tb.start.day,
                                starttime: tb.start.time,
                                endday: tb.end.day,
                                endtime: tb.end.time,
                                blockid: getOrCreateTimeblockId(tb),
                            }))
                    }, {
                        headers: { Authorization: token }
                    });
                }, subjectId);
            } catch (err) {
                console.error("Move failed:", err);
                // Revert on error
                setTimeblocks(timeblocks);
            }

            setDragHover(null);
            setSelectedBlockIndex(null);
            return;
        }
        if (!subjectId || item?.type !== "Student") return;

        const token = localStorage.getItem("user_token");
        try {
            // Use cached subject data instead of fetching
            const allSubjects = subjectCacheGlobal.current || getCache('subjectCacheGlobal') || [];
            const subject = allSubjects.find((s: any) => (s._id?.$oid || s._id) === subjectId);
            
            if (!subject) {
                console.error("Subject not found in cache");
                return;
            }

            const avgDuration = Math.floor((subject.minld + subject.maxld) / 2);
            const startMin = timeToMinutes(time);
            const endMin = startMin + avgDuration;
            const endTime = minutesToTime(endMin);

            // Use cached teacher data instead of fetching
            const allTeachers = teacherCacheGlobal.current || getCache('teacherCacheGlobal') || [];
            const newTimeblockId = getOrCreateTimeblockId({});
            const teacherNames: string[] = allTeachers
                .filter((t: any) => isTeacherAssignedForSubjectBlock(t, (subject._id?.$oid || subject._id), newTimeblockId))
                .map((t: any) => t.displayname || t.name);

            const newBlock = {
                subjectId,
                start: { day, time },
                end: { day, time: endTime },
                timeblockId: newTimeblockId,
                color: subject.color,
                name: subject.displayname || subject.name,
                teachers: teacherNames,
            };

            // Update state optimistically
            setTimeblocks(prev => [...prev, newBlock]);

            const updatedTimeblocks = [...(subject.timeblocks || []), {
                startday: day,
                starttime: time,
                endday: day,
                endtime: endTime,
                blockid: newTimeblockId,
            }];

            await executePutWithSaving(async () => {
                await axios.put(`${API_BASE}/subject/${subjectId}/update`, {
                    timeblocks: updatedTimeblocks
                }, {
                    headers: { Authorization: token }
                });
            }, subjectId);

            setDragHover(null);
        } catch (err) {
            console.error("Drop failed:", err);
            // Revert on error - remove the block we just added
            setTimeblocks(prev => prev.slice(0, -1));
        }
    };
    // fontFamily="'Times New Roman', Times, serif"
    return (
        <>
            {dayMenu && (
                <Box
                    position="fixed"
                    left={dayMenu.x}
                    top={dayMenu.y}
                    bg="white"
                    border="1px solid"
                    borderColor="gray.300"
                    borderRadius="md"
                    boxShadow="md"
                    zIndex={2000}
                    onClick={(e) => e.stopPropagation()}
                >
                    <VStack spacing={0} align="stretch">
                        <Box
                            px={3}
                            py={2}
                            _hover={{ bg: "gray.100" }}
                            cursor="pointer"
                            onClick={() => {
                                if (!dayMenu) return;
                                const day = dayMenu.day;
                                const currentlyHidden = hiddenDays[day];
                                setHiddenDays(prev => ({ ...prev, [day]: !currentlyHidden }));
                                setDayMenu(null);
                            }}
                        >
                            {hiddenDays[dayMenu.day] ? `Unhide ${dayMenu.day}` : `Hide ${dayMenu.day}`}
                        </Box>
                    </VStack>
                </Box>
            )}
            <Box
                mt={8}
                p={4}
                onClick={() => {
                    setSelectedBlockIndex(null);
                    setDayMenu(null);
                }}
                position="relative"
            >
            <HStack justify="space-between" align="center" mb={4}>
                <HStack align="center" spacing={3}>
                    <Heading size="lg">{item.type}: {item.displayname || item.name}</Heading>
                    <Box minW="28px" minH="28px" display="flex" alignItems="center" justifyContent="center" position="relative">
                        {requestState === 'put' && (
                            <>
                                <Box
                                    position="absolute"
                                    w="28px"
                                    h="28px"
                                    borderRadius="full"
                                    border="2px solid"
                                    borderColor="gray.200"
                                    borderTopColor="blue.500"
                                    sx={{ animation: `${spin} 0.8s linear infinite` }}
                                />
                                <ChevronDownIcon boxSize={4} color="blue.500" position="relative" zIndex={1} />
                            </>
                        )}
                        {requestState === 'saved' && <CheckIcon color="green.500" boxSize={5} />}
                        {requestState === 'get' && (
                            <>
                                <Box
                                    position="absolute"
                                    w="28px"
                                    h="28px"
                                    borderRadius="full"
                                    border="2px solid"
                                    borderColor="gray.200"
                                    borderTopColor="gray.500"
                                    sx={{ animation: `${spin} 0.8s linear infinite` }}
                                />
                                <ChevronUpIcon boxSize={4} color="gray.500" position="relative" zIndex={1} />
                            </>
                        )}
                    </Box>
                </HStack>
                <HStack spacing={4}>
                    {item?.type === "Teacher" && (
                        <Button
                            leftIcon={<CopyIcon />}
                            colorScheme="blue"
                            variant="outline"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCopyCurrentTeacherId();
                            }}
                        >
                            Copy Teacher ID
                        </Button>
                    )}
                    <Checkbox
                        isChecked={showEndTime}
                        onChange={(e) => setShowEndTime(e.target.checked)}
                        colorScheme="blue"
                    >
                        Show End Time
                    </Checkbox>
                    {item?.type === "Student" && (
                        <Checkbox
                            isChecked={hideTeacherNames}
                            onChange={(e) => setHideTeacherNames(e.target.checked)}
                            colorScheme="blue"
                        >
                            Hide Teacher Names
                        </Checkbox>
                    )}
                    <Checkbox
                        isChecked={scaleTextToFitCell}
                        onChange={(e) => setScaleTextToFitCell(e.target.checked)}
                        colorScheme="blue"
                    >
                        Scale-to-fit in cell
                    </Checkbox>
                    <Button
                        leftIcon={<DownloadIcon />}
                        colorScheme="green"
                        variant="outline"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleExportToExcel();
                        }}
                    >
                        Export to Excel
                    </Button>
                </HStack>
            </HStack>

            <Box
                display="grid"
                gridTemplateColumns={gridTemplateColumns}
                gridTemplateRows={gridTemplateRows}
                border="2px solid black"
                borderRadius="md"
            >
                {/* Header Row */}
                <Box bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold" fontSize="sm">Start Time</Box>
                {showEndTime && (
                    <Box bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold" fontSize="sm">End Time</Box>
                )}
                {visibleDays.map(day => {
                    const leftSeg = segmentByRightNeighbor[day];
                    const rightSeg = segmentByLeftNeighbor[day];
                    const showLeftArrow = !!leftSeg;
                    const showRightArrow = !!rightSeg;
                    return (
                        <Box
                            key={day}
                            bg="blue.400"
                            border="1px solid black"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            fontWeight="bold"
                            position="relative"
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setDayMenu({ day, x: e.clientX, y: e.clientY });
                            }}
                        >
                            {showLeftArrow && (
                                <Box
                                    position="absolute"
                                    left="4px"
                                    display="flex"
                                    alignItems="center"
                                    cursor="pointer"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const seg = leftSeg!;
                                        setHiddenDays(prev => {
                                            const next = { ...prev };
                                            seg.days.forEach(d => {
                                                next[d] = false;
                                            });
                                            return next;
                                        });
                                    }}
                                >
                                    <ChevronLeftIcon boxSize={3} />
                                </Box>
                            )}
                            <Text fontSize="sm" px={showLeftArrow || showRightArrow ? 4 : 0}>
                                {day}
                            </Text>
                            {showRightArrow && (
                                <Box
                                    position="absolute"
                                    right="4px"
                                    display="flex"
                                    alignItems="center"
                                    cursor="pointer"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const seg = rightSeg!;
                                        setHiddenDays(prev => {
                                            const next = { ...prev };
                                            seg.days.forEach(d => {
                                                next[d] = false;
                                            });
                                            return next;
                                        });
                                    }}
                                >
                                    <ChevronRightIcon boxSize={3} />
                                </Box>
                            )}
                        </Box>
                    );
                })}

                {/* Time Labels */}
                {sortedTimes.map((t, i) => (
                    <React.Fragment key={`time-fragment-${t}`}>
                        <Box gridColumn="1" gridRow={i + 2} bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold">
                            {t}
                        </Box>
                        {showEndTime && (
                            <Box gridColumn="2" gridRow={i + 2} bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold">
                                {i < sortedTimes.length - 1 ? sortedTimes[i + 1] : "—"}
                            </Box>
                        )}
                    </React.Fragment>
                ))}

                {/* Empty Cells */}
                {sortedTimes.map((t, rowIndex) =>
                        visibleDays.map(day => {
                            const col = dayToCol[day];
                            const hasBlock = timeblocks.some(
                                (block: any) =>
                                    !hiddenPeriodKeys[getBlockKey(block)] &&
                                    block.start.day === day &&
                                    block.start.time === t
                            );
                            if (!hasBlock) {
                                return (
                                    <Box
                                        key={`cell-${day}-${t}`}
                                        gridColumn={col}
                                        gridRow={rowIndex + 2}
                                        data-day={day}
                                        data-time={t}
                                        border="1px solid black"
                                        bg={dragHover?.day === day && dragHover?.time === t ? "green.200" : "white"}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setShiftHeld(e.shiftKey);
                                            setCmdHeld(e.metaKey);
                                            const subjectId = getDraggedSubjectId();
                                            if (!subjectId) return;

                                            const baseMin = timeToMinutes(t);
                                            let snappedTime = t;

// ⏱ 5-min snap logic
                                            if (shiftHeld) {
                                                const snapList = shiftHeld
                                                    ? Array.from({ length: (24 * 60) / 5 }, (_, i) => minutesToTime(i * 5))
                                                    : sortedTimes;

                                                const closest = snapList.find(time => timeToMinutes(time) >= baseMin);
                                                snappedTime = closest || t;
                                            } else {
                                                // Non-shift: snap to nearest known slot in sortedTimes (already working fine)
                                                const closest = sortedTimes.find(st => timeToMinutes(st) >= baseMin);
                                                snappedTime = closest || t;
                                            }
                                            if (!dragHover || dragHover.day !== day || dragHover.time !== t) {
                                                setStableHoverTime(snappedTime); // ✅ lock actual hover target
                                                setDragHover({ day, time: t }); // 🔁 track where mouse is, not the anchor
                                            }

                                            if (subjectId !== loadedSubjectId) {
                                                const subject = getDraggedSubjectData();
                                                if (subject) {
                                                    setHoverSubject(subject);
                                                    setLoadedSubjectId(subjectId);
                                                    fetchTeacherBusyRanges(subject);
                                                    if (cmdHeld) {
                                                        fetchOverlappingTeacherSchedules(subject);
                                                    }
                                                }
                                            }
                                        }}
                                        onDragEnter={(e) => e.preventDefault()} // 🟢 may help ensure hover triggers
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.dataTransfer.dropEffect = "move"; // 👈 this tells the browser it was a successful drop
                                            setDraggedTeacherBusy([]);
                                            setOverlappingTeacherSchedules([]);
                                            setDraggedBlockIndex(null);
                                            handleDrop(e, day, t);
                                            setDragHover(null);
                                            setHoverSubject(null);
                                            setLoadedSubjectId(null);
                                            setStableHoverTime(null);
                                            setShiftHeld(false);
                                            setCmdHeld(false);
                                        }}
                                        onDragEnd={() => {
                                            setDragHover(null);
                                            setHoverSubject(null);
                                            setLoadedSubjectId(null);
                                            setSelectedBlockIndex(null);
                                            setOverlappingTeacherSchedules([]);
                                            setSwapReplaceHover(null);
                                            setDraggedBlockIndex(null);
                                            setDraggedTeacherBusy([]);
                                        }}

                                    />
                                );
                            }
                            return null;
                        })
                )}

                {/* Period Blocks */}
                {timeblocks.map((block: any, i: number) => {
                    if (hiddenDays[block.start.day]) return null;
                    if (hiddenPeriodKeys[getBlockKey(block)]) return null;
                    const col = dayToCol[block.start.day];
                    const startRow = timeToRowIndex[block.start.time];
                    const endRow = timeToRowIndex[block.end.time];
                    const rowSpan = endRow - startRow;
                    const isBeingDragged = selectedBlockIndex === i;

                    // Check if this block is part of any overlaps
                    const blockOverlaps = overlaps.filter(o =>
                        o.day === block.start.day &&
                        o.blocks.some(b =>
                            b.start.day === block.start.day &&
                            b.start.time === block.start.time &&
                            b.end.time === block.end.time &&
                            b.subjectId === block.subjectId
                        )
                    );
                    
                    // If this block participates in overlaps, render solo segments (non-overlapping parts)
                    // and render a separate overlap container for each overlapping window.
                    if (blockOverlaps.length > 0) {
                        const blockStartMin = timeToMinutes(block.start.time);
                        const blockEndMin = timeToMinutes(block.end.time);

                        // Merge this block's overlap ranges to find solo (non-overlapping) segments
                        const merged: { start: number; end: number }[] = [];
                        blockOverlaps
                            .map(o => ({
                                start: timeToMinutes(o.start),
                                end: timeToMinutes(o.end),
                            }))
                            .sort((a, b) => a.start - b.start)
                            .forEach(interval => {
                                if (!merged.length || interval.start > merged[merged.length - 1].end) {
                                    merged.push({ ...interval });
                                } else {
                                    merged[merged.length - 1].end = Math.max(
                                        merged[merged.length - 1].end,
                                        interval.end
                                    );
                                }
                            });

                        const soloSegments: { start: number; end: number }[] = [];
                        let cursor = blockStartMin;
                        merged.forEach(m => {
                            if (cursor < m.start) {
                                soloSegments.push({ start: cursor, end: m.start });
                            }
                            cursor = Math.max(cursor, m.end);
                        });
                        if (cursor < blockEndMin) {
                            soloSegments.push({ start: cursor, end: blockEndMin });
                        }

                        const renderSoloSegment = (segStartMin: number, segEndMin: number, key: string) => {
                            const segStart = minutesToTime(segStartMin);
                            const segEnd = minutesToTime(segEndMin);
                            return (
                                <Box
                                    key={key}
                                    gridColumn={col}
                                    gridRow={`${timeToRowIndex[segStart]} / span ${timeToRowIndex[segEnd] - timeToRowIndex[segStart]}`}
                                    bg={block.color || "teal.400"}
                                    color="black"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    textAlign="center"
                                    px={2}
                                    fontWeight="bold"
                                    border={selectedBlockIndex === i ? "3px solid blue" : "1px solid black"}
                                    zIndex={1}
                                    onClick={(e) => { e.stopPropagation(); setSelectedBlockIndex(i); }}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        openEditingBlock(i, block.start.time, block.end.time);
                                    }}
                                    draggable={!resizing}
                                    position="relative"
                                    onDragStart={(e) => {
                                        if (resizing) { e.preventDefault(); return; }
                                        e.dataTransfer.setData("existing_block_index", i.toString());
                                        setDraggedSubjectId(block.subjectId);
                                        setDraggedSubjectData(block);
                                        setHoverSubject(block);
                                        setDraggedBlockIndex(i);
                                        if (item?.type === "Student" && block.teachers?.length) fetchTeacherBusyRanges(block);
                                    }}
                                    onDragOver={(e) => {
                                        e.preventDefault(); e.stopPropagation();
                                        setShiftHeld(e.shiftKey); setCmdHeld(e.metaKey);
                                        setDragHover(null); setStableHoverTime(null);
                                        if (draggedBlockIndex !== null && !isBeingDragged && draggedBlockIndex !== i) {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const side = (e.clientX - rect.left) < rect.width / 2 ? 'swap' : 'replace';
                                            setSwapReplaceHover({ blockIndex: i, side });
                                        }
                                    }}
                                    onDragEnter={(e) => {
                                        e.preventDefault(); e.stopPropagation();
                                        setDragHover(null); setStableHoverTime(null);
                                        if (draggedBlockIndex !== null && !isBeingDragged && draggedBlockIndex !== i) {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const side = (e.clientX - rect.left) < rect.width / 2 ? 'swap' : 'replace';
                                            setSwapReplaceHover({ blockIndex: i, side });
                                        }
                                    }}
                                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSwapReplaceHover(null); }}
                                    onDrop={(e) => {
                                        e.preventDefault(); e.stopPropagation();
                                        if (draggedBlockIndex !== null && !isBeingDragged && draggedBlockIndex !== i && swapReplaceHover) {
                                            if (swapReplaceHover.side === 'swap') handleSwapBlocks(draggedBlockIndex, i);
                                            else handleReplaceBlock(draggedBlockIndex, i);
                                        }
                                        setSwapReplaceHover(null); setDraggedBlockIndex(null); setDragHover(null);
                                        setHoverSubject(null); setLoadedSubjectId(null); setStableHoverTime(null);
                                        setShiftHeld(false); setCmdHeld(false); setOverlappingTeacherSchedules([]);
                                    }}
                                    onDragEnd={() => {
                                        setDragHover(null); setHoverSubject(null); setLoadedSubjectId(null);
                                        setSelectedBlockIndex(null); setOverlappingTeacherSchedules([]);
                                        setSwapReplaceHover(null); setDraggedBlockIndex(null); setDraggedTeacherBusy([]);
                                    }}
                                >
                                    {swapReplaceHover && swapReplaceHover.blockIndex === i && (
                                        <Box position="absolute" top={0} left={0} right={0} bottom={0} display="flex" zIndex={10} borderRadius="md" overflow="hidden">
                                            <Box flex={1} bg={swapReplaceHover.side === 'swap' ? 'blue.300' : 'blue.100'} display="flex" alignItems="center" justifyContent="center" fontWeight="bold" fontSize="sm" borderRight="2px solid white" color="white" textShadow="1px 1px 2px rgba(0,0,0,0.8)">SWAP</Box>
                                            <Box flex={1} bg={swapReplaceHover.side === 'replace' ? 'red.300' : 'red.100'} display="flex" alignItems="center" justifyContent="center" fontWeight="bold" fontSize="sm" color="white" textShadow="1px 1px 2px rgba(0,0,0,0.8)">REPLACE</Box>
                                        </Box>
                                    )}
                                    <ScaleToFitCell
                                        enabled={scaleTextToFitCell}
                                        contentKey={`${getBlockKey(block)}|${hideTeacherNames}|solo`}
                                    >
                                        <VStack spacing={0} pointerEvents="none" w="100%" maxW="100%" maxH="100%" overflow="hidden" align="stretch">
                                            <Box>{cropSemesterTag(block.name)}</Box>
                                            {item.type === "Teacher" && block.displayclass && <Box fontWeight="normal" fontSize="sm">{cropSemesterTag(block.displayclass)}</Box>}
                                            {item.type === "Student" && !hideTeacherNames && block.teachers?.length > 0 && <Box fontWeight="normal" fontSize="sm">{block.teachers.map((t: string, idx: number) => cropSemesterTag(t)).join(", ")}</Box>}
                                        </VStack>
                                    </ScaleToFitCell>
                                </Box>
                            );
                        };

                        const segments: React.ReactNode[] = [];
                        soloSegments.forEach((seg, idx) => {
                            segments.push(
                                renderSoloSegment(seg.start, seg.end, `block-${i}-solo-${idx}`)
                            );
                        });

                        // For each overlap this block participates in, render an overlap container
                        // only once (when this block is the first in the overlap's blocks array).
                        blockOverlaps.forEach(overlap => {
                            const overlapBlockIndex = overlap.blocks.findIndex(b =>
                                b.start.day === block.start.day &&
                                b.start.time === block.start.time &&
                                b.end.time === block.end.time &&
                                b.subjectId === block.subjectId
                            );
                            if (overlapBlockIndex !== 0) return;

                            const overlapStartRow = timeToRowIndex[overlap.start];
                            const overlapEndRow = timeToRowIndex[overlap.end];
                            const overlapRowSpan = overlapEndRow - overlapStartRow;

                            segments.push(
                                <Box
                                    key={`overlap-${overlap.day}-${overlap.start}-${overlap.end}`}
                                    gridColumn={col}
                                    gridRow={`${overlapStartRow} / span ${overlapRowSpan}`}
                                    position="relative"
                                    border="3px solid red"
                                    borderRadius="md"
                                    overflow="hidden"
                                    zIndex={2}
                                >
                                    <Box display="flex" height="100%">
                                        {overlap.blocks.map((overlapBlock: any, blockIdx: number) => {
                                            const originalBlockIndex = timeblocks.findIndex(tb => tb.start.day === overlapBlock.start.day && tb.start.time === overlapBlock.start.time && tb.end.time === overlapBlock.end.time && tb.subjectId === overlapBlock.subjectId);
                                            const isSelected = selectedBlockIndex === originalBlockIndex;
                                            return (
                                                <Box
                                                    key={`overlap-block-${blockIdx}`}
                                                    flex={1}
                                                    bg={overlapBlock.color || "teal.400"}
                                                    color="black"
                                                    display="flex"
                                                    alignItems="center"
                                                    justifyContent="center"
                                                    textAlign="center"
                                                    px={1}
                                                    fontWeight="bold"
                                                    fontSize="sm"
                                                    border={isSelected ? "3px solid blue" : blockIdx > 0 ? "1px solid white" : "none"}
                                                    borderLeft={blockIdx > 0 ? "2px solid white" : "none"}
                                                    position="relative"
                                                    cursor="pointer"
                                                    draggable={!resizing}
                                                    onClick={(e) => { e.stopPropagation(); setSelectedBlockIndex(originalBlockIndex); }}
                                                    onDoubleClick={(e) => { e.stopPropagation(); openEditingBlock(originalBlockIndex, overlapBlock.start.time, overlapBlock.end.time); }}
                                                    onDragStart={(e) => {
                                                        if (resizing) { e.preventDefault(); return; }
                                                        e.dataTransfer.setData("existing_block_index", originalBlockIndex.toString());
                                                        setDraggedSubjectId(overlapBlock.subjectId);
                                                        setDraggedSubjectData(overlapBlock);
                                                        setHoverSubject(overlapBlock);
                                                        setDraggedBlockIndex(originalBlockIndex);
                                                        if (item?.type === "Student" && overlapBlock.teachers?.length) fetchTeacherBusyRanges(overlapBlock);
                                                    }}
                                                    onDragOver={(e) => {
                                                        e.preventDefault(); e.stopPropagation();
                                                        setShiftHeld(e.shiftKey); setCmdHeld(e.metaKey);
                                                        setDragHover(null); setStableHoverTime(null);
                                                        if (draggedBlockIndex !== null && draggedBlockIndex !== originalBlockIndex) {
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            const side = (e.clientX - rect.left) < rect.width / 2 ? 'swap' : 'replace';
                                                            setSwapReplaceHover({ blockIndex: originalBlockIndex, side });
                                                        }
                                                    }}
                                                    onDragEnter={(e) => {
                                                        e.preventDefault(); e.stopPropagation();
                                                        setDragHover(null); setStableHoverTime(null);
                                                        if (draggedBlockIndex !== null && draggedBlockIndex !== originalBlockIndex) {
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            const side = (e.clientX - rect.left) < rect.width / 2 ? 'swap' : 'replace';
                                                            setSwapReplaceHover({ blockIndex: originalBlockIndex, side });
                                                        }
                                                    }}
                                                    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setSwapReplaceHover(null); }}
                                                    onDrop={(e) => {
                                                        e.preventDefault(); e.stopPropagation();
                                                        if (draggedBlockIndex !== null && draggedBlockIndex !== originalBlockIndex && swapReplaceHover) {
                                                            if (swapReplaceHover.side === 'swap') handleSwapBlocks(draggedBlockIndex, originalBlockIndex);
                                                            else handleReplaceBlock(draggedBlockIndex, originalBlockIndex);
                                                        }
                                                        setSwapReplaceHover(null); setDraggedBlockIndex(null); setDragHover(null); setHoverSubject(null); setLoadedSubjectId(null); setStableHoverTime(null); setShiftHeld(false); setCmdHeld(false); setOverlappingTeacherSchedules([]);
                                                    }}
                                                    onDragEnd={() => {
                                                        setDragHover(null); setHoverSubject(null); setLoadedSubjectId(null); setSelectedBlockIndex(null); setOverlappingTeacherSchedules([]); setSwapReplaceHover(null); setDraggedBlockIndex(null); setDraggedTeacherBusy([]);
                                                    }}
                                                >
                                                    {swapReplaceHover && swapReplaceHover.blockIndex === originalBlockIndex && (
                                                        <Box position="absolute" top={0} left={0} right={0} bottom={0} display="flex" zIndex={10} borderRadius="md" overflow="hidden">
                                                            <Box flex={1} bg={swapReplaceHover.side === 'swap' ? 'blue.300' : 'blue.100'} display="flex" alignItems="center" justifyContent="center" fontWeight="bold" fontSize="xs" borderRight="1px solid white" color="white" textShadow="1px 1px 2px rgba(0,0,0,0.8)">SWAP</Box>
                                                            <Box flex={1} bg={swapReplaceHover.side === 'replace' ? 'red.300' : 'red.100'} display="flex" alignItems="center" justifyContent="center" fontWeight="bold" fontSize="xs" color="white" textShadow="1px 1px 2px rgba(0,0,0,0.8)">REPLACE</Box>
                                                        </Box>
                                                    )}
                                                    <ScaleToFitCell
                                                        enabled={scaleTextToFitCell}
                                                        contentKey={`${getBlockKey(overlapBlock)}|${hideTeacherNames}|overlap|${blockIdx}`}
                                                    >
                                                        <VStack spacing={0} pointerEvents="none" w="100%" maxW="100%" maxH="100%" overflow="hidden" align="stretch">
                                                            <Box>{cropSemesterTag(overlapBlock.name)}</Box>
                                                            {item.type === "Teacher" && overlapBlock.displayclass && <Box fontWeight="normal" fontSize="xs">{cropSemesterTag(overlapBlock.displayclass)}</Box>}
                                                            {item.type === "Student" && !hideTeacherNames && overlapBlock.teachers?.length > 0 && <Box fontWeight="normal" fontSize="xs">{overlapBlock.teachers.map((t: string, idx: number) => cropSemesterTag(t)).join(", ")}</Box>}
                                                        </VStack>
                                                    </ScaleToFitCell>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                </Box>
                            );
                        });

                        return <>{segments}</>;
                    }

                    // Regular non-overlapping block rendering
                    return (
                        <Box
                            key={`block-${i}`}
                            gridColumn={col}
                            gridRow={`${startRow} / span ${rowSpan}`}
                            bg={block.color || "teal.400"}
                            color="black"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            textAlign="center"
                            px={2}
                            fontWeight="bold"
                            border={selectedBlockIndex === i ? "3px solid blue" : "1px solid black"}
                            zIndex={1}
                            onClick={(e) => {
                                e.stopPropagation();
                                setSelectedBlockIndex(i);
                            }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                openEditingBlock(i, block.start.time, block.end.time);
                            }}
                            draggable={!resizing}
                            position="relative" // ✅ needed for the handles to position correctly
                            onDragStart={(e) => {
                                if (resizing) { e.preventDefault(); return; }
                                e.dataTransfer.setData("existing_block_index", i.toString());
                                setDraggedSubjectId(block.subjectId);
                                setDraggedSubjectData(block);
                                setHoverSubject(block);
                                setDraggedBlockIndex(i);
                                // Show teacher busy preview immediately if dragging a subject as a student
                                if (item?.type === "Student" && block.teachers?.length) {
                                    fetchTeacherBusyRanges(block);
                                }
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setShiftHeld(e.shiftKey);
                                setCmdHeld(e.metaKey);
                                
                                // Clear drag hover when over a block (since we're not over an empty cell)
                                setDragHover(null);
                                setStableHoverTime(null);
                                
                                // Check if we're dragging over this block and it's not the same block being dragged
                                if (draggedBlockIndex !== null && !isBeingDragged && draggedBlockIndex !== i) {
                                    // Determine which half of the block the mouse is over
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const x = e.clientX - rect.left;
                                    const side = x < rect.width / 2 ? 'swap' : 'replace';
                                    setSwapReplaceHover({ blockIndex: i, side });
                                }
                            }}
                            onDragEnter={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                
                                // Clear drag hover when entering a block
                                setDragHover(null);
                                setStableHoverTime(null);
                                
                                // Check if we're dragging over this block and it's not the same block being dragged
                                if (draggedBlockIndex !== null && !isBeingDragged && draggedBlockIndex !== i) {
                                    // Determine which half of the block the mouse is over
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    const x = e.clientX - rect.left;
                                    const side = x < rect.width / 2 ? 'swap' : 'replace';
                                    setSwapReplaceHover({ blockIndex: i, side });
                                }
                            }}
                            onDragLeave={(e) => {
                                // Only clear if we're leaving the block entirely
                                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                    setSwapReplaceHover(null);
                                }
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                
                                if (draggedBlockIndex !== null && !isBeingDragged && draggedBlockIndex !== i && swapReplaceHover) {
                                    if (swapReplaceHover.side === 'swap') {
                                        handleSwapBlocks(draggedBlockIndex, i);
                                    } else {
                                        handleReplaceBlock(draggedBlockIndex, i);
                                    }
                                }
                                
                                setSwapReplaceHover(null);
                                setDraggedBlockIndex(null);
                                setDragHover(null);
                                setHoverSubject(null);
                                setLoadedSubjectId(null);
                                setStableHoverTime(null);
                                setShiftHeld(false);
                                setCmdHeld(false);
                                setOverlappingTeacherSchedules([]);
                            }}
                            onDragEnd={() => {
                                setDragHover(null);
                                setHoverSubject(null);
                                setLoadedSubjectId(null);
                                setSelectedBlockIndex(null);
                                setOverlappingTeacherSchedules([]);
                                setSwapReplaceHover(null);
                                setDraggedBlockIndex(null);
                                setDraggedTeacherBusy([]);
                            }}
                        >
                            {/* SWAP/REPLACE Overlay */}
                            {swapReplaceHover && swapReplaceHover.blockIndex === i && (
                                <Box
                                    position="absolute"
                                    top={0}
                                    left={0}
                                    right={0}
                                    bottom={0}
                                    display="flex"
                                    zIndex={10}
                                    borderRadius="md"
                                    overflow="hidden"
                                >
                                    <Box
                                        flex={1}
                                        bg={swapReplaceHover.side === 'swap' ? 'blue.300' : 'blue.100'}
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        fontWeight="bold"
                                        fontSize="sm"
                                        borderRight="2px solid white"
                                        color="white"
                                        textShadow="1px 1px 2px rgba(0,0,0,0.8)"
                                    >
                                        SWAP
                                    </Box>
                                    <Box
                                        flex={1}
                                        bg={swapReplaceHover.side === 'replace' ? 'red.300' : 'red.100'}
                                        display="flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        fontWeight="bold"
                                        fontSize="sm"
                                        color="white"
                                        textShadow="1px 1px 2px rgba(0,0,0,0.8)"
                                    >
                                        REPLACE
                                    </Box>
                                </Box>
                            )}

                            <ScaleToFitCell
                                enabled={scaleTextToFitCell}
                                contentKey={`${getBlockKey(block)}|${hideTeacherNames}|main`}
                            >
                                <VStack spacing={0} pointerEvents="none" w="100%" maxW="100%" maxH="100%" overflow="hidden" align="stretch">
                                    <Box>{cropSemesterTag(block.name)}</Box>
                                    {item.type === "Teacher" && block.displayclass && (
                                        <Box fontWeight="normal" fontSize="sm">{cropSemesterTag(block.displayclass)}</Box>
                                    )}
                                    {item.type === "Student" && !hideTeacherNames && block.teachers?.length > 0 && (
                                        <Box fontWeight="normal" fontSize="sm">
                                            {block.teachers.map((t: string, idx: number) => cropSemesterTag(t)).join(", ")}
                                        </Box>
                                    )}
                                </VStack>
                            </ScaleToFitCell>

                            {/* ⬇️ Bottom Resize Handle */}
                            {/*<Box*/}
                            {/*    position="absolute"*/}
                            {/*    bottom={0}*/}
                            {/*    left={0}*/}
                            {/*    right={0}*/}
                            {/*    height="6px"*/}
                            {/*    bg="transparent"*/}
                            {/*    cursor="ns-resize"*/}
                            {/*    draggable={false}*/}
                            {/*    onDragStart={e => e.preventDefault()}*/}
                            {/*    onMouseDown={(e) => {*/}
                            {/*        e.stopPropagation();*/}
                            {/*        e.preventDefault();*/}
                            {/*        setResizing({*/}
                            {/*            blockIndex: i,*/}
                            {/*            direction: "bottom",*/}
                            {/*            day:   block.end.day,*/}
                            {/*            time:  block.end.time,*/}
                            {/*        });*/}
                            {/*    }}*/}
                            {/*/>*/}
                            {/* preview overlay if this is the one being resized */}
                            {/* — after your timeblocks.map(…) here — */}

                        </Box>
                    );
                })}

                {/* Overlapping Teacher Schedule Blocks (when Cmd is held) */}
                {cmdHeld && (() => {
                    // Group blocks by day and time range
                    const cellMap: { [key: string]: any[] } = {};
                    overlappingTeacherSchedules.forEach((block: any) => {
                        if (hiddenDays[block.start.day]) return;
                        const key = `${block.start.day}|${block.start.time}|${block.end.time}`;
                        if (!cellMap[key]) cellMap[key] = [];
                        cellMap[key].push(block);
                    });
                    return Object.entries(cellMap).map(([key, blocks], i) => {
                        const [day, start, end] = key.split('|');
                        if (hiddenDays[day]) return null;
                        const col = dayToCol[day];
                        const startRow = timeToRowIndex[start];
                        const endRow = timeToRowIndex[end];
                        const rowSpan = endRow - startRow;
                        if (blocks.length === 1) {
                            const block = blocks[0];
                            return (
                                <Box
                                    key={`overlapping-${i}`}
                                    gridColumn={col}
                                    gridRow={`${startRow} / span ${rowSpan}`}
                                    bg={block.color || "purple.400"}
                                    color="black"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    textAlign="center"
                                    px={2}
                                    fontWeight="bold"
                                    border="1px dashed purple"
                                    zIndex={2}
                                    opacity={0.8}
                                    pointerEvents="none"
                                >
                                    <VStack spacing={0} pointerEvents="none">
                                        <Box fontSize="xs">{block.name}</Box>
                                        <Box fontSize="xs" fontWeight="normal">
                                            {block.displayclass || '-'}
                                        </Box>
                                    </VStack>
                                </Box>
                            );
                        } else {
                            // Show overlapping blocks side by side
                            return (
                                <Box
                                    key={`overlapping-multi-${i}`}
                                    gridColumn={col}
                                    gridRow={`${startRow} / span ${rowSpan}`}
                                    display="flex"
                                    flexDirection="row"
                                    justifyContent="center"
                                    alignItems="stretch"
                                    border="2px dashed purple"
                                    zIndex={2}
                                    pointerEvents="none"
                                    bg="purple.100"
                                    px={1}
                                >
                                    {blocks.map((block: any, j: number) => (
                                        <Box
                                            key={j}
                                            bg={block.color || "purple.200"}
                                            color="black"
                                            borderRight={j < blocks.length - 1 ? "1px solid purple" : undefined}
                                            py={1}
                                            px={2}
                                            display="flex"
                                            flexDirection="column"
                                            alignItems="center"
                                            fontWeight="bold"
                                            fontSize="xs"
                                            opacity={0.9}
                                            minWidth={0}
                                            flex={1}
                                            overflow="hidden"
                                        >
                                            <Box whiteSpace="nowrap" textOverflow="ellipsis" overflow="hidden">{block.name}</Box>
                                            <Box fontWeight="normal" whiteSpace="nowrap" textOverflow="ellipsis" overflow="hidden">{block.displayclass || '-'}</Box>
                                        </Box>
                                    ))}
                                </Box>
                            );
                        }
                    });
                })()}
                {dragHover && hoverSubject && (() => {
                    const day = dragHover.day;
                    if (hiddenDays[day]) return null;
                    const startTime = stableHoverTime || dragHover.time;
                    const col = dayToCol[day];
                    const computeEndTime = (start: string, s: any): string => {
                        if (s.minld && s.maxld) {
                            return getProjectedEndTime(start, s);
                        }
                        const duration = timeToMinutes(s.end.time) - timeToMinutes(s.start.time);
                        return minutesToTime(timeToMinutes(start) + duration);
                    };

                    const endTime = computeEndTime(startTime, hoverSubject);
                    let startRow = timeToRowIndex[startTime]; // ✅ correct now
                    if (!startRow) {
                        const closest = stableSortedTimesRef.current.find(t =>
                            timeToMinutes(t) >= timeToMinutes(startTime)
                        );
                        startRow = closest ? timeToRowIndex[closest] : 2;
                    }
                    let endRow = timeToRowIndex[endTime];
                    if (!endRow) {
                        const after = stableSortedTimesRef.current.find(t =>
                            timeToMinutes(t) > timeToMinutes(startTime)
                        );
                        endRow = after ? timeToRowIndex[after] : stableSortedTimesRef.current.length + 2;
                    }


                    const rowSpan = Math.max(1, endRow - startRow);
                    console.log("🧩 PREVIEW BOX:", { startTime, endTime, startRow, endRow, rowSpan });

                    return (
                        <Box
                            gridColumn={col}
                            gridRow={`${startRow} / span ${rowSpan}`}
                            bg="green.100"
                            border="2px dashed green"
                            zIndex={10}
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            pointerEvents="none"
                        >
                            <Box fontSize="xs" fontWeight="bold">
                                {startTime} - {endTime}
                            </Box>
                        </Box>
                    );
                })()}
                {sortedTimes.map((t, i) => {
                    let projectedEndTime: string | null = null;
                    if (dragHover && hoverSubject) {
                        const anchor = stableHoverTime || dragHover.time;
                        projectedEndTime = getProjectedEndTime(anchor, hoverSubject);
                        // Clamp to closest time in sortedTimes
                        const closest = sortedTimes.find(st => timeToMinutes(st) >= timeToMinutes(projectedEndTime!));
                        projectedEndTime = closest || projectedEndTime;
                    }

                    const isEnd = t === projectedEndTime;
                    const endTime = i < sortedTimes.length - 1 ? sortedTimes[i + 1] : "—";

                    return (
                        <React.Fragment key={`time-highlight-${t}`}>
                            <Box
                                gridColumn="1"
                                gridRow={i + 2}
                                bg={isEnd ? "blue.400" : "blue.400"}
                                border="1px solid black"
                                display="flex"
                                alignItems="center"
                                justifyContent="center"
                                fontWeight={isEnd ? "extrabold" : "bold"}
                            >
                                {t}
                            </Box>
                            {showEndTime && (
                                <Box
                                    gridColumn="2"
                                    gridRow={i + 2}
                                    bg={isEnd ? "blue.400" : "blue.400"}
                                    border="1px solid black"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    fontWeight={isEnd ? "extrabold" : "bold"}
                                >
                                    {endTime}
                                </Box>
                            )}
                        </React.Fragment>
                    );
                })}
                {editingBlock && (() => {
                    const block = timeblocks[editingBlock.index];
                    if (hiddenDays[block.start.day]) return null;
                    const col = dayToCol[block.start.day];
                    const row = timeToRowIndex[block.start.time];

                    return (
                        <Box
                            gridColumn={col}
                            gridRow={row}
                            position="relative"
                            zIndex={20}
                        >
                            <Box
                                position="absolute"
                                top="0"
                                left="0"
                                p={2}
                                bg="white"
                                border="1px solid black"
                                boxShadow="md"
                                borderRadius="md"
                                display="flex"
                                flexDirection="column"
                                gap="6px"
                                zIndex={100}
                            >
                                <Box fontWeight="bold" fontSize="sm" borderBottom="1px solid" borderColor="gray.200" pb={1}>
                                    {block.name && cropSemesterTag(block.name)}
                                </Box>
                                {item?.type === "Student" && (() => {
                                    const allTeachers = dedupeTeachersById([
                                        ...(teacherCacheGlobal.current || getCache('teacherCacheGlobal') || []),
                                        ...(resolvedTeachers || []),
                                    ]);
                                    const subjectId = getSubjectIdRef(block.subjectId);
                                    const blockId = getTimeblockId(block) || getOrCreateTimeblockId(block);
                                    const excludeModeTopNames = allTeachers
                                        .filter((t: any) => {
                                            const requiredIds = new Set((t.required_teach || []).map((sid: any) => getSubjectIdRef(sid)));
                                            if (!requiredIds.has(subjectId)) return false;
                                            const ov = getRequiredOverrideForSubject(t, subjectId);
                                            return !!ov && getOverrideExcludeMode(ov);
                                        })
                                        .map((t: any) => cropSemesterTag(t.displayname || t.name))
                                        .filter(Boolean);
                                    const mainNames = Array.from(new Set(excludeModeTopNames)).filter(Boolean);

                                    if (!mainNames.length) return null;

                                    return (
                                        <Box fontSize="xs" color="gray.700" maxW="300px" borderTop="1px solid" borderColor="gray.200" pt={1.5}>
                                            <Text fontWeight="semibold" mb={1} fontSize="xs">Teachers</Text>
                                            <VStack align="stretch" spacing={0.5} maxH="96px" overflowY="auto">
                                                {mainNames.map((name: string) => {
                                                    const rawTeacher = resolveTeacherByName(allTeachers, name, subjectId, blockId);
                                                    const teacher = rawTeacher || null;
                                                    const tid = teacher ? getEntityId(teacher) : undefined;
                                                    const checkboxKey = tid ? `${tid}|${subjectId}|${blockId}` : undefined;
                                                    const pendingState = checkboxKey ? pendingCheckboxUpdates[checkboxKey] : undefined;
                                                    const assignedFromModel = teacher ? isTeacherAssignedForSubjectBlock(teacher, subjectId, blockId) : false;
                                                    const checked = typeof pendingState === 'boolean' ? pendingState : assignedFromModel;
                                                    const baseColorScheme = getTeacherCheckboxColorScheme(teacher, subjectId);
                                                    const draftColorScheme = typeof pendingState === 'boolean' && baseColorScheme === 'yellow' ? 'yellow' : baseColorScheme;

                                                    if (!teacher || !tid || !blockId) {
                                                        return (
                                                            <Text key={`top-name-${name}`} fontSize="xs" lineHeight="1.2" color="gray.600" whiteSpace="normal" wordBreak="break-word">
                                                                {name}
                                                            </Text>
                                                        );
                                                    }

                                                    return (
                                                        <HStack key={`top-teacher-${tid}`} spacing={1} align="center">
                                                            <Checkbox
                                                                size="sm"
                                                                isChecked={checked}
                                                                colorScheme={draftColorScheme}
                                                                onChange={async (e) => {
                                                                    await updateTeacherBlockAssignment(teacher, block, e.target.checked);
                                                                }}
                                                                sx={{
                                                                    '.chakra-checkbox__control': {
                                                                        borderColor: 'gray.500',
                                                                        borderWidth: '1px',
                                                                        bg: 'white',
                                                                    },
                                                                }}
                                                            />
                                                            <Text fontSize="xs" flex={1} lineHeight="1.2" whiteSpace="normal" wordBreak="break-word">
                                                                {name}
                                                            </Text>
                                                        </HStack>
                                                    );
                                                })}
                                            </VStack>
                                        </Box>
                                    );
                                })()}
                                {item?.type === "Teacher" && block.displayclass && (
                                    <Box fontSize="xs" color="gray.600">{cropSemesterTag(block.displayclass)}</Box>
                                )}
                                {item?.type === "Student" && (() => {
                                    const subjectId = getSubjectIdRef(block.subjectId);
                                    const blockId = getTimeblockId(block) || getOrCreateTimeblockId(block);
                                    const mergedTeachers = dedupeTeachersById([...(teacherCacheGlobal.current || getCache('teacherCacheGlobal') || []), ...(resolvedTeachers || [])]);
                                    const availableNames = Array.from(new Set((teacherNamesByBlock[getBlockKey(block)] || []).map((n: string) => cropSemesterTag(n)).filter(Boolean)));
                                    const yellowAssignedNames = mergedTeachers
                                        .filter((t: any) => isTeacherAssignedForSubjectBlock(t, subjectId, blockId) && getTeacherCheckboxColorScheme(t, subjectId) === 'yellow')
                                        .map((t: any) => cropSemesterTag(t.displayname || t.name));
                                    const namesToShow = Array.from(new Set([...availableNames, ...yellowAssignedNames])).filter(Boolean);

                                    if (!namesToShow.length) return null;

                                    return (
                                    <Box fontSize="xs" color="gray.700" maxW="280px" borderTop="1px solid" borderColor="gray.200" pt={1.5}>
                                        <Text fontWeight="semibold" mb={1} fontSize="xs">Available</Text>
                                        <VStack align="stretch" spacing={0.5} maxH="110px" overflowY="auto">
                                            {namesToShow.map((name: string) => {
                                                const rawTeacher = resolveTeacherByName(mergedTeachers, name, subjectId, blockId);
                                                const teacher = rawTeacher || null;
                                                const tid = teacher ? getEntityId(teacher) : undefined;
                                                const checkboxKey = tid ? `${tid}|${subjectId}|${blockId}` : undefined;
                                                const pendingState = checkboxKey ? pendingCheckboxUpdates[checkboxKey] : undefined;
                                                const checked = typeof pendingState === 'boolean' ? pendingState : (teacher ? isTeacherAssignedForSubjectBlock(teacher, subjectId, blockId) : false);
                                                const baseColorScheme = teacher ? getTeacherCheckboxColorScheme(teacher, subjectId) : 'green';
                                                const draftColorScheme = typeof pendingState === 'boolean' && baseColorScheme === 'yellow' ? 'yellow' : baseColorScheme;

                                                if (!teacher || !tid || !blockId) {
                                                    return (
                                                        <Text key={`available-name-${name}`} fontSize="xs" lineHeight="1.2" color="gray.600" whiteSpace="normal" wordBreak="break-word">
                                                            {name}
                                                        </Text>
                                                    );
                                                }

                                                return (
                                                    <HStack key={`available-teacher-${tid}`} spacing={1} align="center">
                                                        <Checkbox
                                                            size="sm"
                                                            isChecked={checked}
                                                            colorScheme={draftColorScheme}
                                                            onChange={async (e) => {
                                                                await updateTeacherBlockAssignment(teacher, block, e.target.checked);
                                                            }}
                                                            sx={{
                                                                '.chakra-checkbox__control': {
                                                                    borderColor: 'gray.500',
                                                                    borderWidth: '1px',
                                                                    bg: 'white',
                                                                },
                                                            }}
                                                        />
                                                        <Text fontSize="xs" flex={1} lineHeight="1.2" whiteSpace="normal" wordBreak="break-word">
                                                            {name}
                                                        </Text>
                                                    </HStack>
                                                );
                                            })}
                                        </VStack>
                                    </Box>
                                    );
                                })()}
                                <Box display="flex" gap="4px" alignItems="center">
                                <input
                                    type="time"
                                    value={editingBlock.start}
                                    onChange={e =>
                                        setEditingBlock({ ...editingBlock, start: e.target.value })
                                    }
                                />
                                <input
                                    type="time"
                                    value={editingBlock.end}
                                    onChange={e =>
                                        setEditingBlock({ ...editingBlock, end: e.target.value })
                                    }
                                />
                                <button
                                    onClick={async () => {
                                        const token = localStorage.getItem("user_token");
                                        const hasTimeChanged = editingBlock.start !== block.start.time || editingBlock.end !== block.end.time;
                                        const subjectIdForBlock = getSubjectIdRef(block.subjectId);
                                        const blockIdForEdit = getTimeblockId(block) || getOrCreateTimeblockId(block);
                                        const pendingEntriesForBlock = Object.entries(pendingCheckboxUpdatesRef.current)
                                            .filter(([key]) => key.endsWith(`|${subjectIdForBlock}|${blockIdForEdit}`));
                                        const hasTeacherChanges = pendingEntriesForBlock.length > 0;

                                        if (!token) return;

                                        if (!hasTimeChanged && !hasTeacherChanges) {
                                            setEditingBlock(null);
                                            return;
                                        }

                                        const updatedBlock = {
                                            ...timeblocks[editingBlock.index],
                                            start: { ...block.start, time: editingBlock.start },
                                            end: { ...block.end, time: editingBlock.end },
                                        };

                                        const newTimeblocks = [...timeblocks];
                                        newTimeblocks[editingBlock.index] = updatedBlock;
                                        const touchedSubjectIds = [subjectIdForBlock];

                                        // Immediate local feedback on save click.
                                        if (hasTimeChanged) {
                                            setTimeblocks(newTimeblocks);
                                        }
                                        if (hasTeacherChanges) {
                                            const teacherMap = new Map<string, any>();
                                            dedupeTeachersById([...(teacherCacheGlobal.current || getCache('teacherCacheGlobal') || []), ...(resolvedTeachers || [])]).forEach((t: any) => {
                                                teacherMap.set(getEntityId(t), t);
                                            });
                                            const names = new Set((block.teachers || []).map((n: string) => cropSemesterTag(n)).filter(Boolean));
                                            pendingEntriesForBlock.forEach(([pendingKey, checked]) => {
                                                const [teacherId] = pendingKey.split('|');
                                                const t = teacherMap.get(teacherId);
                                                const tname = cropSemesterTag(t?.displayname || t?.name || '');
                                                if (!tname) return;
                                                if (checked) names.add(tname);
                                                else names.delete(tname);
                                            });
                                            setTimeblocks((prev) => prev.map((tb: any, idx: number) => {
                                                if (idx !== editingBlock.index) return tb;
                                                return { ...tb, teachers: Array.from(names) };
                                            }));
                                        }
                                        setEditingBlock(null);

                                        saveQueueRef.current = saveQueueRef.current.then(async () => {
                                            try {
                                                await executePutWithSaving(async () => {
                                                    if (hasTimeChanged) {
                                                        await axios.put(`${API_BASE}/subject/${block.subjectId}/update`, {
                                                            timeblocks: newTimeblocks
                                                                .filter(tb => tb.subjectId === block.subjectId)
                                                                .map(tb => ({
                                                                    startday: tb.start.day,
                                                                    starttime: tb.start.time,
                                                                    endday: tb.end.day,
                                                                    endtime: tb.end.time,
                                                                    blockid: getOrCreateTimeblockId(tb),
                                                                }))
                                                        }, {
                                                            headers: { Authorization: token }
                                                        });
                                                    }

                                                    if (hasTeacherChanges) {
                                                        const uniqueTeacherIds = Array.from(new Set(pendingEntriesForBlock.map(([key]) => key.split('|')[0])));
                                                        const latestTeachersById = new Map<string, any>();
                                                        dedupeTeachersById([...(teacherCacheGlobal.current || getCache('teacherCacheGlobal') || []), ...(resolvedTeachers || [])]).forEach((t: any) => {
                                                            latestTeachersById.set(getEntityId(t), t);
                                                        });

                                                        const draftByTeacherId = new Map<string, any>();
                                                        const payloadByTeacherId = new Map<string, { can_teach: string[]; required_teach: string[]; required_teach_overrides: any[] }>();
                                                        for (const [pendingKey, checked] of pendingEntriesForBlock) {
                                                            const [teacherId, pendingSubjectId, pendingBlockId] = pendingKey.split('|');
                                                            const baseTeacher = draftByTeacherId.get(teacherId) || optimisticTeacherByIdRef.current[teacherId] || latestTeachersById.get(teacherId);
                                                            if (!baseTeacher) continue;
                                                            const built = buildTeacherUpdateForBlock(baseTeacher, pendingSubjectId, pendingBlockId, checked);
                                                            if (!built) continue;
                                                            draftByTeacherId.set(teacherId, built.updatedTeacher);
                                                            payloadByTeacherId.set(teacherId, built.payload);
                                                        }

                                                        const draftTeacherObj: Record<string, any> = {};
                                                        draftByTeacherId.forEach((updatedTeacher, teacherId) => {
                                                            draftTeacherObj[teacherId] = updatedTeacher;
                                                            optimisticTeacherByIdRef.current = {
                                                                ...optimisticTeacherByIdRef.current,
                                                                [teacherId]: updatedTeacher,
                                                            };
                                                            upsertTeacherInLocalCaches(updatedTeacher);
                                                        });
                                                        applyLocalTeacherAssignments(draftTeacherObj, touchedSubjectIds);

                                                        const teacherPayloads: Array<{ teacherId: string; payload: { can_teach: string[]; required_teach: string[]; required_teach_overrides: any[] } }> = [];
                                                        payloadByTeacherId.forEach((payload, teacherId: string) => {
                                                            teacherPayloads.push({
                                                                teacherId,
                                                                payload,
                                                            });
                                                        });

                                                        for (const queued of teacherPayloads) {
                                                            await axios.put(
                                                                `${API_BASE}/teacher/${queued.teacherId}/update`,
                                                                queued.payload,
                                                                { headers: { Authorization: token } }
                                                            );
                                                        }

                                                        // Keep UI aligned with the committed local draft immediately after save.
                                                        uniqueTeacherIds.forEach((teacherId) => {
                                                            const committed = draftTeacherObj[teacherId];
                                                            if (!committed) return;
                                                            optimisticTeacherByIdRef.current = {
                                                                ...optimisticTeacherByIdRef.current,
                                                                [teacherId]: committed,
                                                            };
                                                            upsertTeacherInLocalCaches(committed);
                                                        });
                                                        touchedSubjectIds.forEach((sid) => refreshSubjectTeacherNames(sid));
                                                    }
                                                }, touchedSubjectIds);

                                                setPendingCheckboxUpdates((prev) => {
                                                    const next = { ...prev };
                                                    pendingEntriesForBlock.forEach(([key, processedChecked]) => {
                                                        if (next[key] === processedChecked) {
                                                            delete next[key];
                                                        }
                                                    });
                                                    const refNext = { ...pendingCheckboxUpdatesRef.current };
                                                    pendingEntriesForBlock.forEach(([key, processedChecked]) => {
                                                        if (refNext[key] === processedChecked) {
                                                            delete refNext[key];
                                                        }
                                                    });
                                                    pendingCheckboxUpdatesRef.current = refNext;
                                                    return next;
                                                });
                                            } catch (err) {
                                                console.error("Failed to update block:", err);
                                                if (hasTimeChanged) {
                                                    setTimeblocks(timeblocks);
                                                }
                                            }
                                        });

                                        // Do not block UI on save; queued writes run in the background.
                                    }}
                                >
                                    ✅
                                </button>
                                <button
                                    onClick={() => {
                                        setHiddenPeriodKeys((prev) => ({
                                            ...prev,
                                            [getBlockKey(block)]: true,
                                        }));
                                        closeEditingBlockWithoutSave();
                                        setSelectedBlockIndex(null);
                                    }}
                                >
                                    Hide
                                </button>
                                <button onClick={() => {
                                    closeEditingBlockWithoutSave();
                                }}>❌</button>
                                </Box>
                            </Box>
                        </Box>
                    );
                })()}
                {item?.type === "Teacher" && busyRanges.map((range, i) => {
                    if (hiddenDays[range.start.day]) return null;
                    const col = dayToCol[range.start.day];

                    const clampToClosest = (time: string, fallback: number): number => {
                        const closest = sortedTimes.find(t => timeToMinutes(t) >= timeToMinutes(time));
                        if (closest) return timeToRowIndex[closest];
                        return fallback;
                    };

                    const startRow = clampToClosest(range.start.time, 2); // Top of grid
                    const endRow = clampToClosest(range.end.time, sortedTimes.length + 2); // Bottom of grid

                    // If clamped startRow is after or equal to endRow, skip rendering
                    if (startRow >= endRow) return null;

                    return (
                        <Box
                            key={`busy-${i}`}
                            gridColumn={col}
                            gridRow={`${startRow} / span ${endRow - startRow}`}
                            bg="red.200"
                            opacity={0.4}
                            zIndex={0}
                            pointerEvents="none"
                        />
                    );
                })}
                {item?.type === "Student" && draggedTeacherBusy.map((range, i) => {
                    if (hiddenDays[range.start.day]) return null;
                    const col = dayToCol[range.start.day];

                    const clampToClosest = (time: string, fallback: number): number => {
                        const closest = sortedTimes.find(t => timeToMinutes(t) >= timeToMinutes(time));
                        return closest ? timeToRowIndex[closest] : fallback;
                    };

                    const startRow = clampToClosest(range.start.time, 2);
                    const endRow = clampToClosest(range.end.time, sortedTimes.length + 2);
                    if (startRow >= endRow) return null;

                    return (
                        <Box
                            key={`dragged-busy-${i}`}
                            gridColumn={col}
                            gridRow={`${startRow} / span ${endRow - startRow}`}
                            bg="red.400"
                            opacity={0.3}
                            zIndex={1}
                            pointerEvents="none"
                        />
                    );
                })}

            </Box>

            {/* Advanced controls: replace time frame */}
            <Box mt={8} p={4} borderWidth="1px" borderRadius="md" borderColor="gray.200" bg="gray.50">
                <Heading size="sm" mb={3}>Advanced controls</Heading>
                <Text fontSize="sm" color="gray.600" mb={4}>
                    Find all blocks with a given time range and replace them with a new time range. One update per subject; schedule refreshes when done.
                </Text>
                <VStack align="stretch" spacing={4} maxW="md">
                    {item?.type === 'Student' && (
                        <Box p={3} borderWidth="1px" borderRadius="md" bg="white">
                            <FormLabel fontSize="sm" mb={2}>Required subjects and visible periods</FormLabel>
                            <Text fontSize="xs" color="gray.500" mb={2}>
                                Uncheck a period to hide it from the schedule without deleting data.
                            </Text>
                            <VStack align="stretch" spacing={3} maxH="220px" overflowY="auto">
                                {requiredSubjectEntries.map((entry: { subjectId: string; name: string; blocks: any[] }) => (
                                    <Box key={`required-${entry.subjectId}`} borderWidth="1px" borderRadius="md" p={2}>
                                        <Text fontWeight="bold" fontSize="sm" mb={1}>{cropSemesterTag(entry.name)}</Text>
                                        {entry.blocks.length === 0 ? (
                                            <Text fontSize="xs" color="gray.500">No scheduled periods yet.</Text>
                                        ) : (
                                            <VStack align="stretch" spacing={1}>
                                                {entry.blocks.map((block: any, idx: number) => {
                                                    const key = getBlockKey(block);
                                                    return (
                                                        <Checkbox
                                                            key={`${key}-${idx}`}
                                                            size="sm"
                                                            isChecked={!hiddenPeriodKeys[key]}
                                                            onChange={(e) => {
                                                                const shouldShow = e.target.checked;
                                                                setHiddenPeriodKeys((prev) => ({
                                                                    ...prev,
                                                                    [key]: !shouldShow,
                                                                }));
                                                            }}
                                                        >
                                                            {block.start.day.slice(0, 3)} {block.start.time} - {block.end.time}
                                                        </Checkbox>
                                                    );
                                                })}
                                            </VStack>
                                        )}
                                    </Box>
                                ))}
                            </VStack>
                        </Box>
                    )}

                    {item?.type === 'Student' && (
                        <Box p={3} borderWidth="1px" borderRadius="md" bg="white">
                            <FormControl>
                                <FormLabel fontSize="sm">Teacher availability overlay by IDs</FormLabel>
                                <Text fontSize="xs" color="gray.500" mb={2}>
                                    Enter teacher IDs (comma, space, or new line separated), then apply. Matching available teachers will appear in the double-click menu.
                                </Text>
                                <Textarea
                                    size="sm"
                                    value={teacherIdsInput}
                                    onChange={(e) => setTeacherIdsInput(e.target.value)}
                                    placeholder="66f...a1, 66f...b2"
                                    mb={2}
                                />
                                <HStack spacing={2}>
                                    <Button size="sm" onClick={handleApplyTeacherIds} isLoading={teacherOverlayLoading}>
                                        Apply teacher IDs
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setTeacherIdsInput('');
                                            setAppliedTeacherIds([]);
                                            setResolvedTeachers([]);
                                            setTeacherOverlayError(null);
                                        }}
                                    >
                                        Clear
                                    </Button>
                                </HStack>
                                {teacherOverlayError && (
                                    <Alert status="error" variant="subtle" borderRadius="md" mt={2} fontSize="sm">
                                        {teacherOverlayError}
                                    </Alert>
                                )}
                                {appliedTeacherIds.length > 0 && (
                                    <Text fontSize="xs" color="gray.600" mt={2}>
                                        Active IDs: {appliedTeacherIds.join(', ')}
                                    </Text>
                                )}
                            </FormControl>
                        </Box>
                    )}

                    <FormControl>
                        <FormLabel fontSize="sm">Apply to these days (uncheck to ignore)</FormLabel>
                        <HStack spacing={4} mt={1} wrap="wrap">
                            {(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const).map((day) => (
                                <Checkbox
                                    key={day}
                                    size="sm"
                                    isChecked={!!advancedDays[day]}
                                    onChange={(e) =>
                                        setAdvancedDays((prev) => ({ ...prev, [day]: e.target.checked }))
                                    }
                                >
                                    {day.slice(0, 3)}
                                </Checkbox>
                            ))}
                        </HStack>
                    </FormControl>
                    <Box
                        p={2}
                        borderRadius="md"
                        borderWidth="2px"
                        borderStyle="dashed"
                        borderColor={advancedDropTarget === 'original' ? 'blue.400' : 'gray.300'}
                        bg={advancedDropTarget === 'original' ? 'blue.50' : 'transparent'}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
                            if (e.dataTransfer.types.includes('existing_block_index')) {
                                setAdvancedDropTarget('original');
                            }
                        }}
                        onDragEnter={(e) => {
                            e.preventDefault();
                            if (e.dataTransfer.types.includes('existing_block_index')) {
                                setAdvancedDropTarget('original');
                            }
                        }}
                        onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setAdvancedDropTarget(null);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const idx = e.dataTransfer.getData('existing_block_index');
                            if (idx !== '') {
                                const i = parseInt(idx, 10);
                                const b = timeblocks[i];
                                if (b) {
                                    setAdvancedOrigStart(b.start.time);
                                    setAdvancedOrigEnd(b.end.time);
                                }
                            }
                            setAdvancedDropTarget(null);
                        }}
                    >
                        <FormLabel fontSize="xs" color="gray.500" display="block" mb={1}>Original time (drag a period here to fill)</FormLabel>
                        <HStack wrap="wrap" spacing={4}>
                            <FormControl>
                                <FormLabel fontSize="sm">Original start</FormLabel>
                                <Input type="time" value={advancedOrigStart} onChange={(e) => setAdvancedOrigStart(e.target.value)} size="sm" />
                            </FormControl>
                            <FormControl>
                                <FormLabel fontSize="sm">Original end</FormLabel>
                                <Input type="time" value={advancedOrigEnd} onChange={(e) => setAdvancedOrigEnd(e.target.value)} size="sm" />
                            </FormControl>
                        </HStack>
                    </Box>
                    <Box
                        p={2}
                        borderRadius="md"
                        borderWidth="2px"
                        borderStyle="dashed"
                        borderColor={advancedDropTarget === 'new' ? 'green.400' : 'gray.300'}
                        bg={advancedDropTarget === 'new' ? 'green.50' : 'transparent'}
                        onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.dataTransfer.dropEffect = 'copy';
                            if (e.dataTransfer.types.includes('existing_block_index')) {
                                setAdvancedDropTarget('new');
                            }
                        }}
                        onDragEnter={(e) => {
                            e.preventDefault();
                            if (e.dataTransfer.types.includes('existing_block_index')) {
                                setAdvancedDropTarget('new');
                            }
                        }}
                        onDragLeave={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setAdvancedDropTarget(null);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const idx = e.dataTransfer.getData('existing_block_index');
                            if (idx !== '') {
                                const i = parseInt(idx, 10);
                                const b = timeblocks[i];
                                if (b) {
                                    setAdvancedNewStart(b.start.time);
                                    setAdvancedNewEnd(b.end.time);
                                }
                            }
                            setAdvancedDropTarget(null);
                        }}
                    >
                        <FormLabel fontSize="xs" color="gray.500" display="block" mb={1}>New time (drag a period here to fill)</FormLabel>
                        <HStack wrap="wrap" spacing={4}>
                            <FormControl>
                                <FormLabel fontSize="sm">New start</FormLabel>
                                <Input type="time" value={advancedNewStart} onChange={(e) => setAdvancedNewStart(e.target.value)} size="sm" />
                            </FormControl>
                            <FormControl>
                                <FormLabel fontSize="sm">New end</FormLabel>
                                <Input type="time" value={advancedNewEnd} onChange={(e) => setAdvancedNewEnd(e.target.value)} size="sm" />
                            </FormControl>
                        </HStack>
                    </Box>
                    {replaceMessage && (
                        <Alert status={replaceMessage.type} variant="subtle" borderRadius="md" fontSize="sm">
                            {replaceMessage.text}
                        </Alert>
                    )}
                    <Button
                        colorScheme="blue"
                        size="sm"
                        onClick={handleReplaceTimeFrame}
                        isDisabled={replaceInProgress}
                        isLoading={replaceInProgress}
                    >
                        {replaceInProgress ? 'Updating…' : 'Replace time frame'}
                    </Button>

                    <Box p={3} borderWidth="1px" borderRadius="md" bg="white">
                        <FormLabel fontSize="sm">Copy / paste settings</FormLabel>
                        <Text fontSize="xs" color="gray.500" mb={2}>
                            Save this JSON anywhere, then paste it later to restore advanced settings.
                        </Text>
                        <HStack spacing={2} mb={2}>
                            <Button size="sm" onClick={handleCopySettings}>Copy settings</Button>
                            <Button size="sm" variant="outline" onClick={handlePasteSettings}>Paste settings</Button>
                        </HStack>
                        <Textarea
                            size="sm"
                            minH="90px"
                            value={settingsBlob}
                            onChange={(e) => setSettingsBlob(e.target.value)}
                            placeholder='{"version":1,...}'
                        />
                        {settingsMessage && (
                            <Alert status={settingsMessage.type} variant="subtle" borderRadius="md" mt={2} fontSize="sm">
                                {settingsMessage.text}
                            </Alert>
                        )}
                    </Box>
                </VStack>
            </Box>
        </Box>
        </>
    );
}

export default ScheduleItem;



