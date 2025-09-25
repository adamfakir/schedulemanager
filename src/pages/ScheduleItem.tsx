import React, { useEffect, useState, useContext } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Heading, Spinner, Center, VStack, Button, HStack, Checkbox } from '@chakra-ui/react';
import { DownloadIcon } from '@chakra-ui/icons';
import axios from 'axios';
import {getDraggedSubjectData, getDraggedSubjectId, setDraggedSubjectId, setDraggedSubjectData} from '../utils/dragSubjectStore';
import { useRef } from 'react';
import { AvailabilityContext } from '../utils/AvailabilityContext';
import { teacherCacheGlobal, subjectCacheGlobal } from '../utils/globalCache';
import { usePageTitle } from '../utils/usePageTitle';
import { exportScheduleToExcel } from '../utils/excelExport';

const API_BASE = "https://schedulebackendapi-3an8u.ondigitalocean.app";

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

// Helper functions for localStorage cache (TTL 1 hour)
const CACHE_TTL = 60 * 60 * 1000;
const getCache = (key: string) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts < CACHE_TTL) return data;
    } catch {}
    return null;
};
const setCache = (key: string, data: any) => {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
};
// Helper to update subject cache after a subject's timeblocks change
async function updateSubjectCacheFromBackend(subjectId: string) {
    const token = localStorage.getItem('user_token');
    let subjectCache = subjectCacheGlobal.current || getCache('subjectCacheGlobal') || [];
    try {
        // Update the single subject in the cache
        const res = await axios.get(`${API_BASE}/subject/${subjectId}`, {
            headers: { Authorization: token }
        });
        const updated = res.data;
        const idx = subjectCache.findIndex((s: any) => (s._id?.$oid || s._id) === subjectId);
        if (idx !== -1) {
            subjectCache[idx] = updated;
        } else {
            subjectCache.push(updated);
        }
        subjectCacheGlobal.current = subjectCache;
        setCache('subjectCacheGlobal', subjectCache);
        // Now force refresh the entire subject cache from backend
        const allRes = await axios.get(`${API_BASE}/subject/all_org_subjects`, {
            headers: { Authorization: token }
        });
        const allSubjects = allRes.data || [];
        subjectCacheGlobal.current = allSubjects;
        setCache('subjectCacheGlobal', allSubjects);
    } catch (err) {
        // fallback: do nothing
    }
}
async function updateTeacherCacheFromBackend(teacherId: string) {
    const token = localStorage.getItem('user_token');
    let teacherCache = teacherCacheGlobal.current || getCache('teacherCacheGlobal') || [];
    try {
        const res = await axios.get(`${API_BASE}/teacher/${teacherId}`, {
            headers: { Authorization: token }
        });
        const updated = res.data;
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

function ScheduleItem() {
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
    const computeBusyRanges = (availability: TimeBlock[]): TimeBlock[] => {
        const busyRanges: TimeBlock[] = [];
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

        for (const day of days) {
            const daySlots = availability
                .filter(r => r.start.day === day)
                .sort((a, b) => timeToMinutes(a.start.time) - timeToMinutes(b.start.time));

            if (daySlots.length === 0) {
                // Entire day is busy
                busyRanges.push({
                    start: { day, time: '00:00' },
                    end:   { day, time: '23:59' },
                });
                continue;
            }

            // Start of day → first available
            if (daySlots[0].start.time > '00:00') {
                busyRanges.push({
                    start: { day, time: '00:00' },
                    end:   { day, time: daySlots[0].start.time },
                });
            }

            // Gaps between slots
            for (let i = 0; i < daySlots.length - 1; i++) {
                const currentEnd = daySlots[i].end.time;
                const nextStart = daySlots[i + 1].start.time;

                if (currentEnd < nextStart) {
                    busyRanges.push({
                        start: { day, time: currentEnd },
                        end:   { day, time: nextStart },
                    });
                }
            }

            // Last available → end of day
            const lastEnd = daySlots[daySlots.length - 1].end.time;
            if (lastEnd < '23:59') {
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
            const subjectIdSet = new Set(
                [...(teacher.required_teach || []), ...(teacher.can_teach || [])].map(sid => sid.$oid || sid)
            );
            const uniqueSubjectIds = Array.from(subjectIdSet);
            for (const subjId of uniqueSubjectIds) {
                const subj = allSubjects.find((s: any) => (s._id?.$oid || s._id) === subjId);
                if (!subj) continue;
                (subj.timeblocks || []).forEach((tb: any) => {
                    // Use a unique key for each block: subjectId|day|start|end
                    const key = `${subj._id.$oid || subj._id}|${tb.start.day}|${tb.start.time}|${tb.end.day}|${tb.end.time}`;
                    if (!seenBlocks.has(key)) {
                        seenBlocks.add(key);
                        overlappingBlocks.push({
                            subjectId: subj._id.$oid || subj._id,
                            ...tb,
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

        setTimeblocks(newTimeblocks);

        // Update both subjects in the backend
        const token = localStorage.getItem("user_token");
        try {
            // Update dragged subject
            await axios.put(`${API_BASE}/subject/${draggedBlock.subjectId}/update`, {
                timeblocks: newTimeblocks
                    .filter(tb => tb.subjectId === draggedBlock.subjectId)
                    .map(tb => ({
                        startday: tb.start.day,
                        starttime: tb.start.time,
                        endday: tb.end.day,
                        endtime: tb.end.time,
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
                    }))
            }, { headers: { Authorization: token } });

            // Refresh cache for both subjects
            await updateSubjectCacheFromBackend(draggedBlock.subjectId);
            await updateSubjectCacheFromBackend(targetBlock.subjectId);
        } catch (err) {
            console.error("❌ Failed to swap blocks:", err);
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

        setTimeblocks(newTimeblocks);

        // Update both subjects in the backend
        const token = localStorage.getItem("user_token");
        try {
            // Update dragged subject (add the new position)
            const draggedSubjectBlocks = newTimeblocks
                .filter(tb => tb.subjectId === draggedBlock.subjectId)
                .map(tb => ({
                    startday: tb.start.day,
                    starttime: tb.start.time,
                    endday: tb.end.day,
                    endtime: tb.end.time,
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
                }));
            
            await axios.put(`${API_BASE}/subject/${targetBlock.subjectId}/update`, {
                timeblocks: targetSubjectBlocks
            }, { headers: { Authorization: token } });
        } catch (err) {
            console.error("❌ Failed to replace block:", err);
        }
    };
    // For teacher view, use cached teacher data for availability if possible
    let teacherAvailability = availability;
    if (item?.type === "Teacher" && teacherCacheGlobal.current) {
        const cached = teacherCacheGlobal.current.find((t: any) => (t._id?.$oid || t._id) === (item._id?.$oid || item._id));
        if (cached && cached.availability) {
            teacherAvailability = cached.availability;
        }
    }
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
                const newTimeblocks = timeblocks.filter((_, idx) => idx !== selectedBlockIndex);

                try {
                    // grab the real Subject ID we carried on each block
                    const block = timeblocks[selectedBlockIndex];
                    const subjectId = block.subjectId;
                    await axios.put(`${API_BASE}/subject/${subjectId}/update`, {
                        // only send *that* subject’s updated blocks
                        timeblocks: newTimeblocks
                            .filter(tb => tb.subjectId === subjectId)
                            .map(tb => ({
                                startday: tb.start.day,
                                starttime: tb.start.time,
                                endday: tb.end.day,
                                endtime: tb.end.time,
                            }))
                    }, {
                        headers: { Authorization: token }
                    });
                    await updateSubjectCacheFromBackend(subjectId);

                    setTimeblocks(newTimeblocks);
                    setSelectedBlockIndex(null);
                } catch (err) {
                    console.error("❌ Failed to delete block from backend:", err);
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
        };
        window.addEventListener("clearDragPreview", handler);
        return () => window.removeEventListener("clearDragPreview", handler);
    }, []);
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token || !id) return;

        const fetchData = async () => {
            try {
                // Try student first
                let res = await axios.get(`${API_BASE}/student/${id}`, { headers: { Authorization: token } });
                const student = res.data;
                setItem({ type: "Student", ...student });

                // Fetch all teachers (for teacher names)
                const teacherRes = await axios.get(`${API_BASE}/teacher/all_org_teachers`, {
                    headers: { Authorization: token }
                });
                const allTeachers = teacherRes.data;

                // Batch fetch all required subjects
                const subjectIds = (student.required_classes || []).map((rc: any) => rc.$oid || rc);
                let blocks: any[] = [];
                if (subjectIds.length > 0) {
                    const batchRes = await axios.post(`${API_BASE}/subject/batch`, { ids: subjectIds }, {
                        headers: { Authorization: token }
                    });
                    const subjects = batchRes.data;
                    for (const subj of subjects) {
                        // Find all teacher names with this subject in required_teach
                        const teacherNames: string[] = allTeachers
                            .filter((t: any) =>
                                (t.required_teach || []).some((sid: any) =>
                                    (sid.$oid || sid) === (subj._id?.$oid || subj._id)
                                )
                            )
                            .map((t: any) => t.displayname || t.name);
                        (subj.timeblocks || []).forEach((tb: any) =>
                            blocks.push({
                                subjectId: subj._id.$oid || subj._id,
                                ...tb,
                                color: subj.color,
                                name: subj.displayname,
                                teachers: teacherNames
                            })
                        );
                    }
                }
                setTimeblocks(blocks);
            } catch {
                try {
                    // Try teacher next
                    let res = await axios.get(`${API_BASE}/teacher/${id}`, { headers: { Authorization: token } });
                    const teacher = res.data;
                    setItem({ type: "Teacher", ...teacher });

                    // Batch fetch all subjects this teacher can/should teach
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
                        for (const subj of subjects) {
                            (subj.timeblocks || []).forEach((tb: any) =>
                                blocks.push({
                                    subjectId: subj._id.$oid || subj._id,
                                    ...tb,
                                    color: subj.color,
                                    name: subj.displayname,
                                    displayclass: subj.displayclass,
                                })
                            );
                        }
                    }
                    setTimeblocks(blocks);
                } catch {
                    try {
                        // Fallback: subject view
                        let res = await axios.get(`${API_BASE}/subject/${id}`, { headers: { Authorization: token } });
                        const subject = res.data;
                        setItem({ type: "Subject", ...subject });
                        setTimeblocks(subject.timeblocks || []);
                        const blocks = (subject.timeblocks || []).map((tb: any) => ({
                            subjectId: subject._id.$oid || subject._id,
                            ...tb,
                            color: subject.color,
                            name: subject.displayname || subject.name
                        }));
                        setTimeblocks(blocks);
                    } catch {
                        setItem(null);
                    }
                }
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [id]);

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

    // Fetch all teachers and all subjects once, cache globally
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token) return;
        if (!teacherCacheGlobal.current) {
            axios.get(`${API_BASE}/teacher/all_org_teachers`, {
                headers: { Authorization: token }
            }).then(res => {
                teacherCacheGlobal.current = res.data;
            });
        }
        if (!subjectCacheGlobal.current) {
            axios.get(`${API_BASE}/subject/all_org_subjects`, {
                headers: { Authorization: token }
            }).then(res => {
                subjectCacheGlobal.current = res.data;
            });
        }
    }, []);

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

    const defaultMin = "08:00";
    const defaultMax = "15:00";
    const allTimesSet = new Set<string>([defaultMin, defaultMax]);

// Add timeblock times
    timeblocks.forEach((tb: any) => {
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
        return timeblocks.some((tb: any) => {
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

    const dayToCol: { [key: string]: number } = showEndTime ? {
        Monday: 3,
        Tuesday: 4,
        Wednesday: 5,
        Thursday: 6,
        Friday: 7,
    } : {
        Monday: 2,
        Tuesday: 3,
        Wednesday: 4,
        Thursday: 5,
        Friday: 6,
    };

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

            try {
                const token = localStorage.getItem("user_token");
                await axios.put(`${API_BASE}/subject/${subjectId}/update`, {
                    timeblocks: newTimeblocks
                        .filter(tb => tb.subjectId === subjectId)
                        .map(tb => ({
                            startday: tb.start.day,
                            starttime: tb.start.time,
                            endday: tb.end.day,
                            endtime: tb.end.time,
                        }))
                }, {
                    headers: { Authorization: token }
                });
                await updateSubjectCacheFromBackend(subjectId);

                setTimeblocks(newTimeblocks);
            } catch (err) {
                console.error("Move failed:", err);
            }

            setDragHover(null);
            setSelectedBlockIndex(null);
            return;
        }
        if (!subjectId || item?.type !== "Student") return;

        const token = localStorage.getItem("user_token");
        try {
            const res = await axios.get(`${API_BASE}/subject/${subjectId}`, {
                headers: { Authorization: token }
            });
            const subject = res.data;

            const avgDuration = Math.floor((subject.minld + subject.maxld) / 2);
            const startMin = timeToMinutes(time);
            const endMin = startMin + avgDuration;
            const endTime = minutesToTime(endMin);

            const newBlock = {

                startday: day,
                starttime: time,
                endday: day,
                endtime: endTime,
            };

            const updatedTimeblocks = [...(subject.timeblocks || []), newBlock];

            await axios.put(`${API_BASE}/subject/${subjectId}/update`, {
                timeblocks: updatedTimeblocks
            }, {
                headers: { Authorization: token }
            });
            await updateSubjectCacheFromBackend(subjectId);

            // Add the new block to timeblocks state for immediate feedback
            // Find all teacher names with this subject in required_teach
            const teacherRes = await axios.get(`${API_BASE}/teacher/all_org_teachers`, {
                headers: { Authorization: token }
            });
            const allTeachers = teacherRes.data;

            const teacherNames: string[] = allTeachers
                .filter((t: any) =>
                    (t.required_teach || []).some((sid: any) =>
                        (sid.$oid || sid) === (subject._id?.$oid || subject._id)
                    )
                )
                .map((t: any) => t.displayname || t.name);

            setTimeblocks(prev => [
                ...prev,
                {
                    subjectId,
                    start: { day, time },
                    end: { day, time: endTime },
                    color: subject.color,
                    name: subject.displayname || subject.name,
                    teachers: teacherNames,
                }
            ]);

            setDragHover(null);
        } catch (err) {
            console.error("Drop failed:", err);
        }
    };
    // fontFamily="'Times New Roman', Times, serif"
    return (
        <Box
            mt={8}
            p={4}
            onClick={() => setSelectedBlockIndex(null)}
        >
            <HStack justify="space-between" align="center" mb={4}>
                <Heading size="lg">{item.type}: {item.displayname || item.name}</Heading>
                <HStack spacing={4}>
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
                            Hide Teacher Names in Export
                        </Checkbox>
                    )}
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
                gridTemplateColumns={showEndTime ? "80px 80px repeat(5, 1fr)" : "80px repeat(5, 1fr)"}
                gridTemplateRows={gridTemplateRows}
                border="2px solid black"
                borderRadius="md"
            >
                {/* Header Row */}
                <Box bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold" fontSize="sm">Start Time</Box>
                {showEndTime && (
                    <Box bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold" fontSize="sm">End Time</Box>
                )}
                {Object.keys(dayToCol).map(day => (
                    <Box key={day} bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold">
                        {day}
                    </Box>
                ))}

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
                        Object.keys(dayToCol).map(day => {
                            const col = dayToCol[day];
                            const hasBlock = timeblocks.some(
                                (block: any) =>
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
                    const col = dayToCol[block.start.day];
                    const startRow = timeToRowIndex[block.start.time];
                    const endRow = timeToRowIndex[block.end.time];
                    const rowSpan = endRow - startRow;
                    const isBeingDragged = selectedBlockIndex === i;

                    // Check if this block is part of an overlap
                    const overlap = getOverlaps().find(o => 
                        o.blocks.some(b => 
                            b.start.day === block.start.day && 
                            b.start.time === block.start.time && 
                            b.end.time === block.end.time &&
                            b.subjectId === block.subjectId
                        )
                    );
                    
                    // If this block is part of an overlap, we'll render it differently
                    if (overlap) {
                        const overlapBlockIndex = overlap.blocks.findIndex(b => 
                            b.start.day === block.start.day && 
                            b.start.time === block.start.time && 
                            b.end.time === block.end.time &&
                            b.subjectId === block.subjectId
                        );
                        
                        // Only render the overlap container for the first block in the overlap
                        if (overlapBlockIndex === 0) {
                            return (
                                <Box
                                    key={`overlap-container-${i}`}
                                    gridColumn={col}
                                    gridRow={`${startRow} / span ${rowSpan}`}
                                    position="relative"
                                    border="3px solid red"
                                    borderRadius="md"
                                    overflow="hidden"
                                    zIndex={2}
                                >
                                    {/* OVERLAP Label */}
                                    <Box
                                        position="absolute"
                                        top="2px"
                                        left="50%"
                                        transform="translateX(-50%)"
                                        bg="red.500"
                                        color="white"
                                        fontWeight="bold"
                                        fontSize="xs"
                                        px={2}
                                        py={1}
                                        borderRadius="sm"
                                        zIndex={5}
                                        border="1px solid red.700"
                                        boxShadow="0 1px 3px rgba(0,0,0,0.3)"
                                    >
                                        ⚠️ OVERLAP
                                    </Box>
                                    
                                    {/* Side by side blocks */}
                                    <Box
                                        display="flex"
                                        height="100%"
                                    >
                                        {overlap.blocks.map((overlapBlock, blockIdx) => {
                                            const originalBlockIndex = timeblocks.findIndex(tb => 
                                                tb.start.day === overlapBlock.start.day && 
                                                tb.start.time === overlapBlock.start.time && 
                                                tb.end.time === overlapBlock.end.time &&
                                                tb.subjectId === overlapBlock.subjectId
                                            );
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
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setSelectedBlockIndex(originalBlockIndex);
                                                    }}
                                                    onDoubleClick={(e) => {
                                                        e.stopPropagation();
                                                        setEditingBlock({
                                                            index: originalBlockIndex,
                                                            start: overlapBlock.start.time,
                                                            end: overlapBlock.end.time,
                                                        });
                                                    }}
                                                    onDragStart={(e) => {
                                                        if (resizing) { e.preventDefault(); return; }
                                                        e.dataTransfer.setData("existing_block_index", originalBlockIndex.toString());
                                                        setDraggedSubjectId(overlapBlock.subjectId);
                                                        setDraggedSubjectData(overlapBlock);
                                                        setHoverSubject(overlapBlock);
                                                        setDraggedBlockIndex(originalBlockIndex);
                                                        if (item?.type === "Student" && overlapBlock.teachers?.length) {
                                                            fetchTeacherBusyRanges(overlapBlock);
                                                        }
                                                    }}
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setShiftHeld(e.shiftKey);
                                                        setCmdHeld(e.metaKey);
                                                        setDragHover(null);
                                                        setStableHoverTime(null);
                                                        
                                                        if (draggedBlockIndex !== null && draggedBlockIndex !== originalBlockIndex) {
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            const x = e.clientX - rect.left;
                                                            const side = x < rect.width / 2 ? 'swap' : 'replace';
                                                            setSwapReplaceHover({ blockIndex: originalBlockIndex, side });
                                                        }
                                                    }}
                                                    onDragEnter={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setDragHover(null);
                                                        setStableHoverTime(null);
                                                        
                                                        if (draggedBlockIndex !== null && draggedBlockIndex !== originalBlockIndex) {
                                                            const rect = e.currentTarget.getBoundingClientRect();
                                                            const x = e.clientX - rect.left;
                                                            const side = x < rect.width / 2 ? 'swap' : 'replace';
                                                            setSwapReplaceHover({ blockIndex: originalBlockIndex, side });
                                                        }
                                                    }}
                                                    onDragLeave={(e) => {
                                                        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                                            setSwapReplaceHover(null);
                                                        }
                                                    }}
                                                    onDrop={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        
                                                        if (draggedBlockIndex !== null && draggedBlockIndex !== originalBlockIndex && swapReplaceHover) {
                                                            if (swapReplaceHover.side === 'swap') {
                                                                handleSwapBlocks(draggedBlockIndex, originalBlockIndex);
                                                            } else {
                                                                handleReplaceBlock(draggedBlockIndex, originalBlockIndex);
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
                                                    {/* SWAP/REPLACE Overlay for overlapping blocks */}
                                                    {swapReplaceHover && swapReplaceHover.blockIndex === originalBlockIndex && (
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
                                                                fontSize="xs"
                                                                borderRight="1px solid white"
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
                                                                fontSize="xs"
                                                                color="white"
                                                                textShadow="1px 1px 2px rgba(0,0,0,0.8)"
                                                            >
                                                                REPLACE
                                                            </Box>
                                                        </Box>
                                                    )}
                                                    
                                                    <VStack spacing={0} pointerEvents="none">
                                                        <Box>{cropSemesterTag(overlapBlock.name)}</Box>
                                                        {item.type === "Teacher" && overlapBlock.displayclass && (
                                                            <Box fontWeight="normal" fontSize="xs">{cropSemesterTag(overlapBlock.displayclass)}</Box>
                                                        )}
                                                        {item.type === "Student" && overlapBlock.teachers?.length > 0 && (
                                                            <Box fontWeight="normal" fontSize="xs">
                                                                {overlapBlock.teachers.map((t: string, idx: number) => cropSemesterTag(t)).join(", ")}
                                                            </Box>
                                                        )}
                                                    </VStack>
                                                </Box>
                                            );
                                        })}
                                    </Box>
                                </Box>
                            );
                        } else {
                            // Skip rendering individual blocks that are part of overlaps (except the first one)
                            return null;
                        }
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
                                setEditingBlock({
                                    index: i,
                                    start: block.start.time,
                                    end: block.end.time,
                                });
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

                            <VStack spacing={0} pointerEvents="none">
                                <Box>{cropSemesterTag(block.name)}</Box>
                                {item.type === "Teacher" && block.displayclass && (
                                    <Box fontWeight="normal" fontSize="sm">{cropSemesterTag(block.displayclass)}</Box>
                                )}
                                {item.type === "Student" && block.teachers?.length > 0 && (
                                    <Box fontWeight="normal" fontSize="sm">
                                        {block.teachers.map((t: string, idx: number) => cropSemesterTag(t)).join(", ")}
                                    </Box>
                                )}
                            </VStack>

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
                        const key = `${block.start.day}|${block.start.time}|${block.end.time}`;
                        if (!cellMap[key]) cellMap[key] = [];
                        cellMap[key].push(block);
                    });
                    return Object.entries(cellMap).map(([key, blocks], i) => {
                        const [day, start, end] = key.split('|');
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
                                gap="4px"
                                zIndex={100}
                            >
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
                                        const updatedBlock = {
                                            ...timeblocks[editingBlock.index],
                                            start: { ...block.start, time: editingBlock.start },
                                            end: { ...block.end, time: editingBlock.end },
                                        };

                                        const newTimeblocks = [...timeblocks];
                                        newTimeblocks[editingBlock.index] = updatedBlock;

                                        setTimeblocks(newTimeblocks);
                                        setEditingBlock(null);

                                        const token = localStorage.getItem("user_token");
                                        try {
                                            await axios.put(`${API_BASE}/subject/${block.subjectId}/update`, {
                                                timeblocks: newTimeblocks
                                                    .filter(tb => tb.subjectId === block.subjectId)
                                                    .map(tb => ({
                                                        startday: tb.start.day,
                                                        starttime: tb.start.time,
                                                        endday: tb.end.day,
                                                        endtime: tb.end.time,
                                                    }))
                                            }, {
                                                headers: { Authorization: token }
                                            });
                                            await updateSubjectCacheFromBackend(block.subjectId);
                                        } catch (err) {
                                            console.error("Failed to update block:", err);
                                        }
                                    }}
                                >
                                    ✅
                                </button>
                                <button onClick={() => setEditingBlock(null)}>❌</button>
                            </Box>
                        </Box>
                    );
                })()}
                {item?.type === "Teacher" && busyRanges.map((range, i) => {
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
        </Box>
    );
}

export default ScheduleItem;



