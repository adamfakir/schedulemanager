import React, { useEffect, useState, useContext } from 'react';
import { useParams } from 'react-router-dom';
import { Box, Heading, Spinner, Center, VStack } from '@chakra-ui/react';
import axios from 'axios';
import {getDraggedSubjectData, getDraggedSubjectId, setDraggedSubjectId, setDraggedSubjectData} from '../utils/dragSubjectStore';
import { useRef } from 'react';
import { AvailabilityContext } from '../utils/AvailabilityContext';

const API_BASE = "https://schedulemanagerbackend.onrender.com";

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
    const [stableHoverTime, setStableHoverTime] = useState<string | null>(null);
    const { availability } = useContext(AvailabilityContext);
    const [draggedTeacherBusy, setDraggedTeacherBusy] = useState<TimeBlock[]>([]);
    const teacherCacheRef = useRef<any[] | null>(null);
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

        const token = localStorage.getItem("user_token");

        try {
            // Use cache if available


            const subjectTeacherNames = subject.teachers;
            let allTeachers = teacherCacheRef.current;

            if (!allTeachers) {
                const res = await axios.get(`${API_BASE}/teacher/all_org_teachers`, {
                    headers: { Authorization: token }
                });
                allTeachers = res.data;
                teacherCacheRef.current = allTeachers;
            }

// ✅ TypeScript now knows it's definitely not null
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
        } catch (err) {
            console.error("❌ Failed to fetch teacher availability:", err);
            setDraggedTeacherBusy([]);
        }
    };
    const busyRanges = item?.type === "Teacher" ? computeBusyRanges(availability) : [];
    const [editingBlock, setEditingBlock] = useState<{
        index: number;
        start: string;
        end: string;
    } | null>(null);
    // ↪️ near top of ScheduleItem()
    const stableSortedTimesRef = useRef<string[]>([]);

    useEffect(() => {
        const handle = (e: KeyboardEvent) => setShiftHeld(e.shiftKey);
        window.addEventListener("keydown", handle);
        window.addEventListener("keyup", handle);
        return () => {
            window.removeEventListener("keydown", handle);
            window.removeEventListener("keyup", handle);
        };
    }, []);    const [resizing, setResizing] = useState<{
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
            } catch (err) {
                console.error("❌ Failed to save resized block:", err);
            }

            // 5) Cleanup
            setResizing(null);
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup",   handleMouseUp);
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
        };
        window.addEventListener("clearDragPreview", handler);
        return () => window.removeEventListener("clearDragPreview", handler);
    }, []);
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token || !id) return;

        const fetchData = async () => {
            try {
                let res = await axios.get(`${API_BASE}/student/${id}`, { headers: { Authorization: token } });
                const student = res.data;
                setItem({ type: "Student", ...student });

                const teacherRes = await axios.get(`${API_BASE}/teacher/all_org_teachers`, {
                    headers: { Authorization: token }
                });
                const allTeachers = teacherRes.data;

                const blocks: any[] = [];
                for (const subjId of student.required_classes || []) {
                    const subjectRes = await axios.get(`${API_BASE}/subject/${subjId.$oid || subjId}`, {
                        headers: { Authorization: token }
                    });
                    const subj = subjectRes.data;

                    // Find all teacher names with this subject in required_teach
                    const teacherNames: string[] = allTeachers
                        .filter((t: any) =>
                            (t.required_teach || []).some((sid: any) =>
                                (sid.$oid || sid) === (subj._id?.$oid || subj._id)
                            )
                        )
                        .map((t: any) => t.displayname || t.name);

                    subj.timeblocks?.forEach((tb: any) =>
                        blocks.push({
                            subjectId: subj._id.$oid || subj._id,    // ← carry the real Subject ID
                            ...tb,
                            color: subj.color,
                            name: subj.displayname,
                            teachers: teacherNames
                        })
                    );
                }
                setTimeblocks(blocks);
            } catch {
                try {
                    let res = await axios.get(`${API_BASE}/teacher/${id}`, { headers: { Authorization: token } });
                    const teacher = res.data;
                    setItem({ type: "Teacher", ...teacher });

                    const subjectIdSet = new Set(
                        [...(teacher.required_teach || []), ...(teacher.can_teach || [])].map(sid => sid.$oid || sid)
                    );

                    const uniqueSubjectIds = Array.from(subjectIdSet);

                    const blocks: any[] = [];
                    for (const subjId of uniqueSubjectIds) {
                        const subjectRes = await axios.get(`${API_BASE}/subject/${subjId}`, { headers: { Authorization: token } });
                        const subj = subjectRes.data;

                        subj.timeblocks?.forEach((tb: any) =>
                            blocks.push({
                                subjectId: subj._id.$oid || subj._id,
                                ...tb,
                                color: subj.color,
                                name: subj.displayname,
                                displayclass: subj.displayclass,
                            })
                        );
                    }
                    setTimeblocks(blocks);
                } catch {
                    try {
                        let res = await axios.get(`${API_BASE}/subject/${id}`, { headers: { Authorization: token } });
                        const subject = res.data;
                        setItem({ type: "Subject", ...subject });
                        setTimeblocks(subject.timeblocks || []);
                        const blocks = (subject.timeblocks || []).map((tb: any) => ({
                            subjectId: subject._id.$oid || subject._id,  // ← subject’s own ID
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
    const defaultMax = "16:00";
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

    const dayToCol: { [key: string]: number } = {
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
            <Heading size="lg" mb={4}>{item.type}: {item.name}</Heading>

            <Box
                display="grid"
                gridTemplateColumns="80px repeat(5, 1fr)"
                gridTemplateRows={gridTemplateRows}
                border="2px solid black"
                borderRadius="md"
            >
                {/* Header Row */}
                <Box bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold">Time</Box>
                {Object.keys(dayToCol).map(day => (
                    <Box key={day} bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold">
                        {day}

                    </Box>
                ))}

                {/* Time Labels */}
                {sortedTimes.map((t, i) => (
                    <Box key={`time-${t}`} gridColumn="1" gridRow={i + 2} bg="blue.400" border="1px solid black" display="flex" alignItems="center" justifyContent="center" fontWeight="bold">
                        {t}
                    </Box>
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
                                                }
                                            }
                                        }}
                                        onDragEnter={(e) => e.preventDefault()} // 🟢 may help ensure hover triggers
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.dataTransfer.dropEffect = "move"; // 👈 this tells the browser it was a successful drop
                                            setDraggedTeacherBusy([]);
                                            handleDrop(e, day, t);
                                            setDragHover(null);
                                            setHoverSubject(null);
                                            setLoadedSubjectId(null);
                                            setStableHoverTime(null);
                                            setShiftHeld(false);
                                        }}
                                        onDragEnd={() => {
                                            setDragHover(null);         // ✅ clears lingering green box
                                            setHoverSubject(null);      // ✅ clears preview logic
                                            setLoadedSubjectId(null);
                                            setShiftHeld(false);
                                            setStableHoverTime(null);
                                            setDraggedTeacherBusy([]);
                                            // ✅ resets caching
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
                            }}
                            onDragEnd={() => {
                                setDragHover(null);
                                setHoverSubject(null);
                                setLoadedSubjectId(null);
                                setSelectedBlockIndex(null);
                            }}
                        >
                            {/* ⬆️ Top Resize Handle */}
                            {/*<Box*/}
                            {/*    position="absolute"*/}
                            {/*    top={0}*/}
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
                            {/*            direction: "top",*/}
                            {/*            day:   block.start.day,*/}
                            {/*            time:  block.start.time,*/}
                            {/*        });*/}
                            {/*    }}*/}
                            {/*/>*/}

                            <VStack spacing={0} pointerEvents="none">
                                <Box>{block.name}</Box>
                                {item.type === "Teacher" && block.displayclass && (
                                    <Box fontWeight="normal" fontSize="sm">{block.displayclass}</Box>
                                )}
                                {item.type === "Student" && block.teachers?.length > 0 && (
                                    <Box fontWeight="normal" fontSize="sm">
                                        {block.teachers.join(", ")}
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
                {/*{resizing && (() => {*/}
                {/*    // extract the raw cell time you grabbed in handleMouseMove*/}
                {/*      const { blockIndex, direction, day, time: rawTime } = resizing;*/}
                {/*      const block = timeblocks[blockIndex];*/}

                {/*          // decide new start/end *from* rawTime (never from dragHover)*/}
                {/*              const startTime = direction === "top"*/}
                {/*        ? rawTime        // resizing the top edge*/}
                {/*           : block.start.time;*/}
                {/*      const endTime   = direction === "bottom"*/}
                {/*        ? rawTime        // resizing the bottom edge*/}
                {/*           : block.end.time;*/}

                {/*    // lookup grid rows & columns*/}
                {/*    const startRow = timeToRowIndex[startTime];*/}
                {/*    const endRow   = timeToRowIndex[endTime];*/}
                {/*    const colIndex = dayToCol[day];*/}

                {/*    return (*/}
                {/*        <Box*/}
                {/*            gridColumnStart={colIndex}*/}
                {/*            gridColumnEnd={colIndex + 1}*/}
                {/*            gridRowStart={startRow}*/}
                {/*            gridRowEnd={endRow}*/}
                {/*            border="2px dashed green"*/}
                {/*            zIndex={10}*/}
                {/*            pointerEvents="none"*/}
                {/*        />*/}
                {/*    );*/}
                {/*})()}*/}
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

                    return (
                        <Box
                            key={`time-${t}`}
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
                {getOverlaps().map((overlap, i) => {
                    const col = dayToCol[overlap.day];
                    const startRow = timeToRowIndex[overlap.start];
                    const endRow = timeToRowIndex[overlap.end];
                    const rowSpan = endRow - startRow;
                    const label = `${overlap.blocks[0].name} & ${overlap.blocks[1].name} (OVERLAP)`;

                    return (
                        <Box
                            key={`overlap-${i}`}
                            gridColumn={col}
                            gridRow={`${startRow} / span ${rowSpan}`}
                            bg="red.100"
                            color="red.800"
                            fontWeight="bold"
                            fontSize="xs"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            zIndex={5}
                            border="2px dashed red"
                            pointerEvents="auto"
                            onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                // Could default to moving the first block, or pick based on y-position
                                const rect = (e.target as HTMLElement).getBoundingClientRect();
                                const yRel = e.clientY - rect.top;
                                const moveTop = yRel < rect.height / 2;
                                const blockToMove = moveTop ? overlap.blocks[0] : overlap.blocks[1];

                                const index = timeblocks.findIndex(tb =>
                                    tb.subjectId === blockToMove.subjectId &&
                                    tb.start.time === blockToMove.start.time &&
                                    tb.start.day === blockToMove.start.day
                                );
                                if (index !== -1) {
                                    setSelectedBlockIndex(index);
                                    setDraggedSubjectId(blockToMove.subjectId);
                                    setDraggedSubjectData(blockToMove);
                                }
                            }}
                        >
                            {label}
                        </Box>
                    );
                })}
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



