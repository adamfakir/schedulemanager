import React from 'react';
import { useEffect, useState, useContext } from 'react';
import {Box, Flex, Button, Spacer, Heading, HStack, VStack, Center, Icon, Divider, Menu,
    MenuButton,
    MenuList,
    MenuItem,
    IconButton,  Tabs, TabList, TabPanels, Tab, TabPanel, Input, Text, Checkbox } from '@chakra-ui/react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ArrowDownIcon, HamburgerIcon} from '@chakra-ui/icons'
import { AvailabilityContext } from '../utils/AvailabilityContext';
import { teacherCacheGlobal, subjectCacheGlobal, studentCacheGlobal } from '../utils/globalCache';
import { API_BASE, getStudentsFromCache, getSubjectsFromCache, getTeachersFromCache, loadAllStudents, loadAllSubjects, loadAllTeachers, loadStudentById, loadSubjectById, loadTeacherById } from '../utils/apiClient';

import axios from 'axios';
import {
    getDraggedSubjectData,
    getDraggedSubjectId,
    setDraggedSubjectId,
    getDragHover,
    setDragHover,
    getHoverSubject,
    setHoverSubject,
    getLoadedSubjectId,
    setLoadedSubjectId, setDraggedSubjectData
} from '../utils/dragSubjectStore';
import {
    PREP_SUBJECT_ID,
    PREP_DEFAULT_MINUTES,
    PREP_COLOR,
    DEFAULT_MEETING_COLOR,
    DEFAULT_CUSTOM_COLOR,
    OFFICE_DEFAULT_MINUTES,
    meetingSubjectId,
    customSubjectId,
} from '../utils/officeBlocks';

const Navbar = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const isSchedulePage = location.pathname.startsWith("/schedule/");
    const [scheduleType, setScheduleType] = useState<null | 'Student' | 'Teacher' | 'Subject'>(null);
    const [scheduleId, setScheduleId] = useState<string | null>(null);
    const [subjects, setSubjects] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [pinnedSubjectIds, setPinnedSubjectIds] = useState<string[]>([]);
    const [showAllSubjects, setShowAllSubjects] = useState(false);
    const [item, setItem] = useState<any>(null);
    const [allStudents, setAllStudents] = useState<any[]>([]);
    const [addAvailabilityDay, setAddAvailabilityDay] = useState('Monday');
    const [addAvailabilityStart, setAddAvailabilityStart] = useState('');
    const [addAvailabilityEnd, setAddAvailabilityEnd] = useState('');
    const [excludeEmptyHours, setExcludeEmptyHours] = useState(false);
    const [allTeachers, setAllTeachers] = useState<any[]>([]);
    const [meetingName, setMeetingName] = useState('');
    const [meetingColor, setMeetingColor] = useState(DEFAULT_MEETING_COLOR);
    const [meetingTeacherIds, setMeetingTeacherIds] = useState<string[]>([]);
    const [meetingTeacherSearch, setMeetingTeacherSearch] = useState('');
    const [customDraftName, setCustomDraftName] = useState('');
    const [customDraftColor, setCustomDraftColor] = useState(DEFAULT_CUSTOM_COLOR);
    const [creatingMeeting, setCreatingMeeting] = useState(false);
    const [savingCustomTemplate, setSavingCustomTemplate] = useState(false);
    const formatTime = (time: string): string => {
        const [h, m] = time.split(":").map(Number);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    const toMinutes = (time: string): number => {
        const [h, m] = time.split(':').map(Number);
        return h * 60 + m;
    };
    const toSubjectId = (raw: any): string => String(raw?.$oid || raw?.subject?.$oid || raw?.subject || raw?.id || raw || '');
    const getTimeblockId = (tb: any): string => String(tb?.blockid || tb?.id || tb?.timeblockId || '');
    const isTeacherAssignedForSubject = (teacher: any, subject: any): boolean => {
        const subjectId = String(subject?._id?.$oid || subject?._id || '');
        const requiredIds = (teacher?.required_teach || []).map((sid: any) => toSubjectId(sid));
        if (!requiredIds.includes(subjectId)) return false;

        const override = (teacher?.required_teach_overrides || []).find((ov: any) => toSubjectId(ov?.subject) === subjectId);
        if (!override) return true;

        const extras = new Set((override?.extratimeblocks || []).map((id: any) => String(id)));
        if (extras.size === 0) return true;

        const excludeMode = !!override?.excludeextras;
        return (subject?.timeblocks || []).some((tb: any) => {
            const tbId = getTimeblockId(tb);
            if (!tbId) return !excludeMode;
            return excludeMode ? !extras.has(tbId) : extras.has(tbId);
        });
    };
    const {
        availability, setAvailability,
        prepTimeblocks, setPrepTimeblocks,
        customBlockTemplates, setCustomBlockTemplates,
        customTimeblocks, setCustomTimeblocks,
        meetings, setMeetings,
        editing, setEditing,
        mode, setMode
    } = useContext(AvailabilityContext);
     type TimeBlock = {
        start: { day: string; time: string };
        end:   { day: string; time: string };
    };
    const computeBusyRanges = (availability: TimeBlock[]): TimeBlock[] => {
        const busyRanges: TimeBlock[] = [];

        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

        for (const day of days) {
            const rawSlots = availability
                .filter(r => r.start.day === day)
                .filter(r => toMinutes(r.end.time) > toMinutes(r.start.time))
                .map(r => ({
                    start: { ...r.start },
                    end: { ...r.end },
                }))
                .sort((a, b) => toMinutes(a.start.time) - toMinutes(b.start.time));

            const slots: TimeBlock[] = [];
            rawSlots.forEach((slot) => {
                if (!slots.length) {
                    slots.push(slot);
                    return;
                }

                const last = slots[slots.length - 1];
                if (toMinutes(slot.start.time) <= toMinutes(last.end.time)) {
                    if (toMinutes(slot.end.time) > toMinutes(last.end.time)) {
                        last.end.time = slot.end.time;
                    }
                } else {
                    slots.push(slot);
                }
            });

            let current = '00:00';
            for (const slot of slots) {
                if (toMinutes(slot.start.time) > toMinutes(current)) {
                    busyRanges.push({
                        start: { day, time: current },
                        end:   { day, time: slot.start.time },
                    });
                }
                current = slot.end.time;
            }

            if (toMinutes(current) < toMinutes('23:59')) {
                busyRanges.push({
                    start: { day, time: current },
                    end:   { day, time: '23:59' },
                });
            }
        }

        return busyRanges;
    };
    const normalizeAvailability = (ranges: TimeBlock[]): TimeBlock[] => {
        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const merged: TimeBlock[] = [];

        days.forEach((day) => {
            const dayRanges = ranges
                .filter((r) => r.start.day === day && r.end.day === day)
                .sort((a, b) => toMinutes(a.start.time) - toMinutes(b.start.time));

            dayRanges.forEach((r) => {
                if (!merged.length || merged[merged.length - 1].start.day !== day) {
                    merged.push({
                        start: { day, time: r.start.time },
                        end: { day, time: r.end.time }
                    });
                    return;
                }

                const last = merged[merged.length - 1];
                if (toMinutes(r.start.time) <= toMinutes(last.end.time)) {
                    if (toMinutes(r.end.time) > toMinutes(last.end.time)) {
                        last.end.time = r.end.time;
                    }
                } else {
                    merged.push({
                        start: { day, time: r.start.time },
                        end: { day, time: r.end.time }
                    });
                }
            });
        });

        return merged;
    };
    const fullWeek = (): TimeBlock[] =>
        ['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d=>({
            start:{day:d,time:'00:00'}, end:{day:d,time:'23:59'}
        }));
    const saveAvailability = async (newAvailability: TimeBlock[]) => {
        console.log("hiiiii saveing")
        const token = localStorage.getItem("user_token");
        if (!token || item?.type !== "Teacher" || !item._id) return;
        console.log(newAvailability);
        try {
            await axios.put(
                `https://schedulebackendapi-3an8u.ondigitalocean.app/teacher/${item._id.$oid || item._id}/update`,
                { availability: newAvailability },
                { headers: { Authorization: token } }
            );
            console.log("✅ Availability saved.");
            const allTeachers = await loadAllTeachers(token, { force: true, preferCache: false });
            teacherCacheGlobal.current = allTeachers;
            localStorage.setItem('teacherCacheGlobal', JSON.stringify({ data: allTeachers, ts: Date.now() }));
        } catch (err) {
            console.error("❌ Failed to save availability:", err);
        }
    };
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!isSchedulePage || !location.pathname.startsWith('/schedule/')) return;
        if (!token) return;

        const id = location.pathname.split('/schedule/')[1];
        setScheduleId(id);

        let active = true;

        const fetchTypeAndSubjects = async () => {
            const cachedSubjects = getSubjectsFromCache() || [];
            const cachedTeachers = getTeachersFromCache() || [];
            const cachedStudents = getStudentsFromCache() || [];

            subjectCacheGlobal.current = cachedSubjects;
            teacherCacheGlobal.current = cachedTeachers;
            studentCacheGlobal.current = cachedStudents;

            if (active && cachedStudents.length) setAllStudents(cachedStudents);

            const subjectsPromise = loadAllSubjects(token, { preferCache: false });
            const teachersPromise = loadAllTeachers(token, { preferCache: false });
            const studentsPromise = loadAllStudents(token, { preferCache: false });

            const studentData = await loadStudentById(token, id, { allow404: true });
            if (studentData) {
                if (!active) return;
                setScheduleType("Student");
                setItem(studentData);

                const [subjectsList, teachersList, studentsList] = await Promise.all([
                    subjectsPromise,
                    teachersPromise,
                    studentsPromise,
                ]);
                if (!active) return;

                setAllStudents(studentsList || []);
                const enrichedSubjects = (subjectsList || []).map((subject: any) => {
                    const requiredTeacherNames = (teachersList || [])
                        .filter((t: any) => isTeacherAssignedForSubject(t, subject))
                        .map((t: any) => ({
                            name: t.displayname || t.name,
                            id: t._id?.$oid || t._id
                        }));
                    return { ...subject, teachers: requiredTeacherNames };
                });
                setSubjects(enrichedSubjects);
                return;
            }

            const teacherDataRaw = await loadTeacherById(token, id, { allow404: true });
            if (teacherDataRaw) {
                if (!active) return;
                const teacherData = { ...teacherDataRaw, type: "Teacher" };
                setItem(teacherData);
                setScheduleType("Teacher");
                setAvailability(teacherData.availability || []);
                setPrepTimeblocks(teacherData.prep_timeblocks || []);
                const templates = (teacherData.custom_block_templates || []).map((t: any) => ({
                    template_id: String(t.template_id || t.id || ''),
                    name: t.name || 'Note',
                    color: t.color || DEFAULT_CUSTOM_COLOR,
                }));
                setCustomBlockTemplates(templates.filter((t: any) => t.template_id));
                setCustomTimeblocks(teacherData.custom_timeblocks || []);
                const teacherId = String(teacherData._id?.$oid || teacherData._id || id);
                setMeetingTeacherIds([teacherId]);

                const [subjectsList, studentsList, teachersList, meetingsRes] = await Promise.all([
                    subjectsPromise,
                    studentsPromise,
                    loadAllTeachers(token, { preferCache: false }),
                    axios.get(`${API_BASE}/meeting/for_teacher/${teacherId}`, {
                        headers: { Authorization: token },
                    }).catch(() => ({ data: [] })),
                ]);
                if (!active) return;
                setAllStudents(studentsList || []);
                setSubjects(subjectsList || []);
                setAllTeachers(teachersList || []);
                setMeetings(meetingsRes.data || []);
                return;
            }

            const subjectData = await loadSubjectById(token, id, { allow404: true });
            if (!active) return;
            setScheduleType(subjectData ? "Subject" : null);
        };

        fetchTypeAndSubjects();

        const pinned = localStorage.getItem('pinned_subject_ids');
        if (pinned) {
            setPinnedSubjectIds(JSON.parse(pinned));
        }

        return () => {
            active = false;
        };
    }, [location]);
    const handleLogout = () => {
        localStorage.removeItem('user_token');
        navigate('/login');
    };

    if (isSchedulePage) {
        // Matches subject if search matches name, displayname, or tags
        const matchesSearch = (s: any) => {
            const term = search.toLowerCase();
            return (
                s.name?.toLowerCase().includes(term) ||
                s.displayname?.toLowerCase().includes(term) ||
                s.tags?.some((tag: string) => tag.toLowerCase().includes(term))
            );
        };

// First filter based on required_classes
        const requiredSubjects = subjects
            .filter(s => item?.required_classes?.some((rc: any) => (rc.$oid || rc) === (s._id?.$oid || s._id)))
            .filter(matchesSearch);

// Then filter remaining subjects as optional
        const optionalSubjects = subjects
            .filter(s => !item?.required_classes?.some((rc: any) => (rc.$oid || rc) === (s._id?.$oid || s._id)))
            .filter(matchesSearch);

        const sortSubjects = (arr: any[]) =>
            [...arr].sort((a, b) => {
                const ap = pinnedSubjectIds.includes(a._id?.$oid);
                const bp = pinnedSubjectIds.includes(b._id?.$oid);
                return Number(bp) - Number(ap); // pinned first
            });

        const sortedRequired = sortSubjects(requiredSubjects);
        const sortedOptional = sortSubjects(optionalSubjects);
        // Helper to get minutes from HH:MM
        const timeToMinutes = (time: string) => {
            const [h, m] = time.split(":").map(Number);
            return h * 60 + m;
        };
        // Categorize required subjects by completion
        const categorizedRequired = (() => {
            const notCompleted: any[] = [];
            const completed: any[] = [];
            for (const s of sortedRequired) {
                const minwd = s.minwd || 0;
                const maxwd = s.maxwd || 0;
                const minld = s.minld || 1;
                const maxld = s.maxld || 1;
                const avgWeekly = (minwd + maxwd) / 2;
                const avgPeriod = (minld + maxld) / 2 || 1;
                const X = avgWeekly / avgPeriod;
                let totalMinutes = 0;
                if (s.timeblocks && Array.isArray(s.timeblocks)) {
                    for (const tb of s.timeblocks) {
                        if (tb.start && tb.end && tb.start.time && tb.end.time && tb.start.day && tb.end.day) {
                            if (tb.start.day === tb.end.day) {
                                totalMinutes += timeToMinutes(tb.end.time) - timeToMinutes(tb.start.time);
                            }
                        }
                    }
                }
                const Y = totalMinutes / avgPeriod;
                if (Y / X < 1) {
                    notCompleted.push({ s, X, Y });
                } else {
                    completed.push({ s, X, Y });
                }
            }
            return [...notCompleted, ...completed];
        })();
        return (
            <Flex
                direction="column"
                bg="#e6fcef"
                w="100%"
                h="100vh"
                p={5}
                shadow="md"
                position="relative"
                align="start"
            >
                <Menu>
                    <MenuButton
                        as={IconButton}
                        icon={<HamburgerIcon />}
                        variant="outline"
                        colorScheme="blackAlpha"
                        aria-label="Options"
                    />
                    <MenuList>
                        <MenuItem as={Link} to="/subjects">Subjects</MenuItem>
                        <MenuItem as={Link} to="/teachers">Teachers</MenuItem>
                        <MenuItem as={Link} to="/students">Students</MenuItem>
                        <MenuItem onClick={handleLogout} color="red">Logout</MenuItem>
                    </MenuList>
                </Menu>

                {/* Student-only tab: "Subjects" */}
                {scheduleType === "Student" && (
                    <Tabs mt={4} variant="enclosed" w="100%">
                        <TabList overflowX="auto" whiteSpace="nowrap">
                            <Tab flex="none">Subjects</Tab>
                            <Tab flex="none">Classmates</Tab>
                        </TabList>
                        <TabPanels>
                            <TabPanel px={1}>
                                <Input
                                    placeholder="Search subjects..."
                                    size="sm"
                                    mb={2}
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                                <VStack align="center" spacing={2} maxH="60vh" overflowY="auto">
                                    {/* Required Subjects */}
                                    {categorizedRequired.map(({ s, X, Y }) => (
                                        <Box
                                            key={s._id?.$oid}
                                            as={Link}
                                            to={`/schedule/${s._id?.$oid}`}
                                            draggable
                                            onDragStart={(e: React.DragEvent) => {
                                                e.dataTransfer.setData("subject_id", s._id?.$oid);
                                                setDraggedSubjectId(s._id?.$oid);
                                                setDraggedSubjectData(s);
                                                e.dataTransfer.effectAllowed = "move";
                                            }}
                                            onDragEnd={() => {
                                                window.dispatchEvent(new CustomEvent("clearDragPreview"));
                                            }}
                                            w="100%"
                                            bg={s.color || "teal.400"}
                                            color="black"
                                            display="flex"
                                            alignItems="center"
                                            justifyContent="center"
                                            textAlign="center"
                                            px={2}
                                            py={3}
                                            fontWeight="bold"
                                            border="1px solid black"
                                            borderRadius="md"
                                            cursor="pointer"
                                            _hover={{ opacity: 0.9 }}
                                            textDecoration="none"
                                        >
                                            <VStack spacing={0} w="100%">
                                                <Text fontWeight="bold" fontSize="md">{s.displayname || s.name}</Text>
                                                {/* Show Y/X periods info */}
                                                <Text fontSize="sm" color="gray.700" fontWeight="normal">
                                                    {`${Y.toFixed(1)} / ${X.toFixed(1)} periods`}
                                                </Text>
                                                { s.teachers && s.teachers.length > 0 && (
                                                    <HStack wrap="wrap" justify="center">
                                                        {s.teachers.map((t: any, idx: number) => (
                                                            <Text
                                                                key={t.id || idx}
                                                                as={Link}
                                                                to={`/schedule/${t.id}`}
                                                                fontSize="sm"
                                                                fontWeight="normal"
                                                                color="blackAlpha"
                                                                cursor="pointer"
                                                                _hover={{ textDecoration: "underline", color: "blue.800" }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                }}
                                                            >
                                                                {t.name}
                                                            </Text>
                                                        ))}
                                                    </HStack>
                                                )}
                                            </VStack>
                                        </Box>
                                    ))}
                                    {/* Toggle Button */}
                                    <Button
                                        size="sm"
                                        w={"90%"}
                                        variant={"ghost"}
                                        colorScheme="blackAlpha"
                                        onClick={() => setShowAllSubjects(prev => !prev)}
                                    >
                                        {showAllSubjects ? "Hide Non-Required Subjects" : "Show Non-Required Subjects"}
                                    </Button>
                                    {/* Toggleable Optional Subjects */}
                                    {showAllSubjects && sortedOptional.map(s => (
                                        <Box
                                            key={s._id?.$oid}
                                            as={Link}
                                            to={`/schedule/${s._id?.$oid}`}
                                            w="100%"
                                            bg={s.color || "gray.300"}
                                            color="black"
                                            display="flex"
                                            alignItems="center"
                                            justifyContent="center"
                                            textAlign="center"
                                            px={2}
                                            py={3}
                                            fontWeight="bold"
                                            border="1px solid black"
                                            borderRadius="md"
                                            cursor="pointer"
                                            _hover={{ opacity: 0.9 }}
                                            textDecoration="none"
                                        >
                                            <VStack spacing={0} w="100%">
                                                <Text fontWeight="bold" fontSize="md">{s.displayname || s.name}</Text>
                                                { s.teachers && s.teachers.length > 0 && (
                                                    <HStack wrap="wrap" justify="center">
                                                        {s.teachers.map((t: any, idx: number) => (
                                                            <Text
                                                                key={t.id || idx}
                                                                as={Link}
                                                                to={`/schedule/${t.id}`}
                                                                fontSize="sm"
                                                                fontWeight="normal"
                                                                // textDecoration="underline"
                                                                color="blackAlpha"
                                                                cursor="pointer"
                                                                _hover={{ textDecoration: "underline", color: "blue.800" }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation(); // 👈 prevent subject box click
                                                                }}
                                                            >
                                                                {t.name}
                                                            </Text>
                                                        ))}
                                                    </HStack>
                                                )}
                                            </VStack>
                                        </Box>
                                    ))}


                                </VStack>
                            </TabPanel>
                            <TabPanel px={1}>
                                <VStack align="center" spacing={2} maxH="60vh" overflowY="auto">
                                    {allStudents
                                        .filter((s) => (s._id?.$oid || s._id)?.toString() !== (item?._id?.$oid || item?._id)?.toString()) // Exclude self reliably
                                        .map((s) => {
                                            const myReq = item?.required_classes?.map((rc: any) => rc?.$oid || rc) || [];
                                            const theirReq = s.required_classes?.map((rc: any) => rc?.$oid || rc) || [];
                                            const mutualIds = myReq.filter((id: string) => theirReq.includes(id));

                                            if (mutualIds.length === 0) return null;

                                            const mutualSubjects = mutualIds
                                                .map((id: string) =>
                                                    subjects.find((sub: any) => (sub._id?.$oid || sub._id) === id)
                                                )
                                                .filter(Boolean)
                                                .map((sub: any) => sub.displayname || sub.name);

                                            return (
                                                <Box
                                                    key={s._id?.$oid || s._id}
                                                    as={Link}
                                                    to={`/schedule/${s._id?.$oid || s._id}`}
                                                    w="100%"
                                                    bg="green.100"
                                                    color="black"
                                                    textAlign="center"
                                                    px={2}
                                                    py={3}
                                                    fontWeight="bold"
                                                    border="1px solid black"
                                                    borderRadius="md"
                                                    cursor="pointer"
                                                    _hover={{ opacity: 0.9 }}
                                                    textDecoration="none"
                                                    display="block"
                                                >
                                                    <VStack spacing={0}>
                                                        <Text fontWeight="bold">{s.displayname || s.name}</Text>
                                                        <Text fontSize="sm" fontWeight="normal" color="gray.700">
                                                            Mutual classes: {mutualSubjects.join(", ")}
                                                        </Text>
                                                    </VStack>
                                                </Box>
                                            );
                                        })}
                                </VStack>
                            </TabPanel>
                        </TabPanels>
                    </Tabs>
                )}
                {scheduleType === "Teacher" && (() => {
                    // extract teacher’s required-teach IDs once
                    const teacherSubjectIds: string[] =
                        (item.required_teach || []).map((rc: any) => rc.$oid || rc);

                    return (
                        <Tabs mt={4} variant="enclosed" w="100%" flex="1" minH={0} display="flex" flexDirection="column" overflow="hidden"
                            sx={{
                                '.chakra-tabs__tab-panels': { flex: 1, minHeight: 0, overflow: 'hidden' },
                                '.chakra-tabs__tab-panel[hidden]': { display: 'none' },
                                '.chakra-tabs__tab-panel:not([hidden])': { height: '100%', overflowY: 'auto' },
                            }}
                        >
                            <TabList overflowX="auto" whiteSpace="nowrap" flexShrink={0}>
                                <Tab flex="none">Availability</Tab>
                                    <Tab flex="none">Students</Tab>
                                    <Tab flex="none">Subjects</Tab>
                                    <Tab flex="none">Office</Tab>
                                    <Tab flex="none">Hours</Tab>
                            </TabList>

                            <TabPanels flex="1" minH={0} overflow="hidden">
                                {/* 1) Availability (blank for now) */}
                                <TabPanel px={1} h="100%" overflowY="auto">
                                    <VStack align="stretch" spacing={2}>

                                            <Button size="lg" py={"2"}colorScheme="red" onClick={() => {
                                                const allBusy: TimeBlock[] = [];
                                                setAvailability(allBusy);
                                                saveAvailability(allBusy);
                                            }}>
                                                Set All Busy
                                            </Button>
                                            <Button size="lg"py={"2"} colorScheme="green" onClick={() => {
                                                const allAvail = fullWeek();
                                                setAvailability(allAvail);
                                                saveAvailability(allAvail);
                                            }}>
                                                Set All Available
                                            </Button>

                                        <Divider my={3} />

                                            <Button
                                                size="lg"py={"2"}
                                                colorScheme={mode === "available" ? "blue" : "gray"}
                                                onClick={() => setMode("available")}
                                            >
                                                Available Mode
                                            </Button>
                                            <Button

                                                size="lg"py={"2"}
                                                colorScheme={mode === "busy" ? "blue" : "gray"}
                                                onClick={() => setMode("busy")}
                                            >
                                                Busy Mode
                                            </Button>
                                        <Divider my={3} />


                                        <Box>
                                            <Heading size="sm" mb={2}>Current Time Ranges</Heading>
                                            <VStack align="start" spacing={2}>
                                                {(mode === "available" ? availability : computeBusyRanges(availability)).map((range, i) => (
                                                    <HStack
                                                        key={i}
                                                        w="100%"
                                                        border="1px solid black"
                                                        borderRadius="md"
                                                        p={2}
                                                        bg={mode === "available" ? "green.100" : "red.100"}
                                                        justify="space-between"
                                                    >
                                                        <Text fontSize="sm" fontWeight="bold">
                                                            {range.start.day}: {formatTime(range.start.time)} to {formatTime(range.end.time)}
                                                        </Text>
                                                        <Button
                                                            size="xs"
                                                            colorScheme="red"
                                                            onClick={() => {
                                                                if (mode === "available") {
                                                                    const updated = availability.filter((_, idx) => idx !== i);
                                                                    setAvailability(updated);
                                                                    saveAvailability(updated);
                                                                } else if (mode === "busy") {
                                                                    const busyToRemove = computeBusyRanges(availability)[i];
                                                                    const newAvail = [...availability, busyToRemove];
                                                                    setAvailability(newAvail);
                                                                    saveAvailability(newAvail);
                                                                }
                                                            }}
                                                        >
                                                            ❌
                                                        </Button>
                                                    </HStack>
                                                ))}
                                            </VStack>
                                        </Box>

                                        {(mode === "available" || mode === "busy") && (
                                            <Box>
                                                <Divider my={3} />
                                                <Heading size="sm" mb={2}>
                                                    Add New {mode === "available" ? "Available" : "Busy"} Time
                                                </Heading>
                                                <VStack align="start" spacing={3}>
                                                    <Box w="100%">
                                                        <Text fontSize="sm" fontWeight="bold" mb={1}>Day</Text>
                                                        <select
                                                            value={addAvailabilityDay}
                                                            onChange={(e) => setAddAvailabilityDay(e.target.value)}
                                                            style={{ width: "100%", padding: "6px", borderRadius: "4px" }}
                                                        >
                                                            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => (
                                                                <option key={d}>{d}</option>
                                                            ))}
                                                        </select>
                                                    </Box>

                                                    <Box w="100%">
                                                        <Text fontSize="sm" fontWeight="bold" mb={1}>Start Time</Text>
                                                        <Input
                                                            type="time"
                                                            size="sm"
                                                            width="100%"
                                                            value={addAvailabilityStart}
                                                            onChange={(e) => setAddAvailabilityStart(e.target.value)}
                                                        />
                                                    </Box>

                                                    <Box w="100%">
                                                        <Text fontSize="sm" fontWeight="bold" mb={1}>End Time</Text>
                                                        <Input
                                                            type="time"
                                                            size="sm"
                                                            width="100%"
                                                            value={addAvailabilityEnd}
                                                            onChange={(e) => setAddAvailabilityEnd(e.target.value)}
                                                        />
                                                    </Box>

                                                    <Button
                                                        size="sm"
                                                        colorScheme="blue"
                                                        alignSelf="start"
                                                        onClick={() => {
                                                            const day = addAvailabilityDay;
                                                            const start = addAvailabilityStart;
                                                            const end = addAvailabilityEnd;
                                                            if (!start || !end || !day) return;
                                                            if (toMinutes(end) <= toMinutes(start)) return;

                                                            const newRange = { start: { day, time: start }, end: { day, time: end } };

                                                            if (mode === "available") {
                                                                const updated = normalizeAvailability([...availability, newRange]);
                                                                setAvailability(updated);
                                                                saveAvailability(updated);
                                                            } else if (mode === "busy") {
                                                                const updated = availability.flatMap((block) => {
                                                                    if (block.start.day !== day) return [block];
                                                                    const sA = block.start.time;
                                                                    const eA = block.end.time;
                                                                    const sB = start;
                                                                    const eB = end;

                                                                    if (eB <= sA || sB >= eA) return [block];

                                                                    const parts: TimeBlock[] = [];
                                                                    if (sA < sB) parts.push({ start: { day, time: sA }, end: { day, time: sB } });
                                                                    if (eB < eA) parts.push({ start: { day, time: eB }, end: { day, time: eA } });
                                                                    return parts;
                                                                });

                                                                const normalized = normalizeAvailability(updated);
                                                                setAvailability(normalized);
                                                                saveAvailability(normalized);
                                                            }
                                                        }}
                                                    >
                                                        ➕ Add Time Range
                                                    </Button>
                                                </VStack>
                                            </Box>
                                        )}
                                    </VStack>
                                </TabPanel>

                                {/* 2) Students who take classes this teacher teaches */}
                                <TabPanel px={1} h="100%" overflowY="auto">
                                    <VStack align="center" spacing={2}>
                                        {allStudents
                                            .filter((student: any) => {
                                                const stuReq: string[] = (student.required_classes || [])
                                                    .map((rc: any) => rc.$oid || rc);
                                                return stuReq.some(id => teacherSubjectIds.includes(id));
                                            })
                                            .map((student: any) => {
                                                const stuReq: string[] = (student.required_classes || [])
                                                    .map((rc: any) => rc.$oid || rc);
                                                const mutualIds = stuReq.filter(id => teacherSubjectIds.includes(id));
                                                const mutualSubjects: string[] = mutualIds
                                                    .map(id => {
                                                        const subj = subjects.find(s => (s._id.$oid || s._id) === id);
                                                        return subj?.displayname || subj?.name || "";
                                                    })
                                                    .filter(Boolean);

                                                return (
                                                    <Box
                                                        key={student._id.$oid || student._id}
                                                        as={Link}
                                                        to={`/schedule/${student._id.$oid || student._id}`}
                                                        w="100%"
                                                        bg="green.100"
                                                        color="black"
                                                        px={2}
                                                        py={3}
                                                        border="1px solid black"
                                                        borderRadius="md"
                                                        cursor="pointer"
                                                        _hover={{ opacity: 0.9 }}
                                                        textDecoration="none"
                                                        display="block"
                                                    >
                                                        <VStack spacing={0}>
                                                            <Text fontWeight="bold">
                                                                {student.displayname || student.name}
                                                            </Text>
                                                            <Text fontSize="sm" color="gray.700">
                                                                Classes: {mutualSubjects.join(", ")}
                                                            </Text>
                                                        </VStack>
                                                    </Box>
                                                );
                                            })}
                                    </VStack>
                                </TabPanel>

                                {/* 3) Subjects this teacher is required to teach */}
                                <TabPanel px={1} h="100%" overflowY="auto">
                                    <VStack align="center" spacing={2}>
                                        {subjects
                                            .filter((subj: any) =>
                                                teacherSubjectIds.includes(subj._id.$oid || subj._id)
                                            )
                                            .map((subj: any) => (
                                                <Box
                                                    key={subj._id.$oid || subj._id}
                                                    as={Link}
                                                    to={`/schedule/${subj._id.$oid || subj._id}`}
                                                    w="100%"
                                                    bg={subj.color || "gray.300"}
                                                    color="black"
                                                    px={2}
                                                    py={3}
                                                    border="1px solid black"
                                                    borderRadius="md"
                                                    cursor="pointer"
                                                    _hover={{ opacity: 0.9 }}
                                                    textDecoration="none"
                                                    display="block"
                                                >
                                                    <VStack spacing={0}>
                                                        <Text fontWeight="bold" fontSize="md">
                                                            {subj.displayname || subj.name}
                                                        </Text>
                                                        <Text fontSize="sm">
                                                            {subj.displayclass}
                                                        </Text>
                                                    </VStack>
                                                </Box>
                                            ))}
                                    </VStack>
                                </TabPanel>

                                {/* 3b) Office: prep, meetings, custom */}
                                <TabPanel px={1} h="100%" overflowY="auto">
                                    <VStack align="stretch" spacing={4}>
                                        {(() => {
                                            const teacherId = String(item?._id?.$oid || item?._id || scheduleId || '');
                                            const token = localStorage.getItem('user_token') || '';
                                            const newTemplateId = () =>
                                                (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                                                    ? crypto.randomUUID().replace(/-/g, '')
                                                    : `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

                                            const blockMinutes = (tb: any) => {
                                                const start = tb?.start?.time || tb?.starttime;
                                                const end = tb?.end?.time || tb?.endtime;
                                                const startDay = tb?.start?.day || tb?.startday;
                                                const endDay = tb?.end?.day || tb?.endday;
                                                if (!start || !end || !startDay || startDay !== endDay) return 0;
                                                return Math.max(0, timeToMinutes(end) - timeToMinutes(start));
                                            };
                                            const isTeacherBlockAssigned = (subj: any, tb: any) => {
                                                const subjId = String(subj?._id?.$oid || subj?._id || '');
                                                const requiredIds = (item?.required_teach || []).map((sid: any) => toSubjectId(sid));
                                                if (!requiredIds.includes(subjId)) return true;
                                                const override = (item?.required_teach_overrides || []).find(
                                                    (ov: any) => toSubjectId(ov?.subject) === subjId
                                                );
                                                if (!override) return true;
                                                const extras = new Set((override?.extratimeblocks || []).map((id: any) => String(id)));
                                                if (extras.size === 0) return true;
                                                const tbId = getTimeblockId(tb);
                                                if (!tbId) return !override?.excludeextras;
                                                return override?.excludeextras ? !extras.has(tbId) : extras.has(tbId);
                                            };
                                            const teacherAllSubjectIds = new Set([
                                                ...(item?.required_teach || []).map((sid: any) => toSubjectId(sid)),
                                                ...(item?.can_teach || []).map((sid: any) => toSubjectId(sid)),
                                            ]);
                                            let teachingMinutes = 0;
                                            for (const subj of subjects) {
                                                const subjId = String(subj?._id?.$oid || subj?._id || '');
                                                if (!teacherAllSubjectIds.has(subjId)) continue;
                                                if (subj.fixed) continue;
                                                for (const tb of (subj.timeblocks || [])) {
                                                    if (!isTeacherBlockAssigned(subj, tb)) continue;
                                                    teachingMinutes += blockMinutes(tb);
                                                }
                                            }
                                            const targetPrep = Math.round(teachingMinutes * 0.2);
                                            const scheduledPrep = (prepTimeblocks || []).reduce(
                                                (sum: number, tb: any) => sum + blockMinutes(tb),
                                                0
                                            );
                                            const pctOfTeaching = teachingMinutes > 0
                                                ? Math.round((scheduledPrep / teachingMinutes) * 1000) / 10
                                                : 0;
                                            let statusLabel = 'No teaching time yet';
                                            let statusColor = 'gray.100';
                                            let borderColor = 'gray.400';
                                            if (teachingMinutes > 0) {
                                                if (targetPrep === 0) {
                                                    statusLabel = 'No prep needed';
                                                    statusColor = 'gray.100';
                                                } else if (scheduledPrep < targetPrep * 0.9) {
                                                    statusLabel = `Under target (${pctOfTeaching}% of teaching)`;
                                                    statusColor = 'orange.100';
                                                    borderColor = 'orange.400';
                                                } else if (scheduledPrep > targetPrep * 1.1) {
                                                    statusLabel = `Over target (${pctOfTeaching}% of teaching)`;
                                                    statusColor = 'red.100';
                                                    borderColor = 'red.400';
                                                } else {
                                                    statusLabel = `On target (~20% of teaching)`;
                                                    statusColor = 'green.100';
                                                    borderColor = 'green.500';
                                                }
                                            }

                                            const saveTemplates = async (next: any[]) => {
                                                setCustomBlockTemplates(next);
                                                await axios.put(
                                                    `${API_BASE}/teacher/${teacherId}/update`,
                                                    { custom_block_templates: next },
                                                    { headers: { Authorization: token } }
                                                );
                                            };

                                            const createMeeting = async () => {
                                                const name = meetingName.trim() || 'Meeting';
                                                const ids = meetingTeacherIds.length ? meetingTeacherIds : [teacherId];
                                                setCreatingMeeting(true);
                                                try {
                                                    const res = await axios.post(
                                                        `${API_BASE}/meeting/create`,
                                                        { name, color: meetingColor, teacher_ids: ids, timeblocks: [] },
                                                        { headers: { Authorization: token } }
                                                    );
                                                    const created = res.data?.meeting;
                                                    if (created) setMeetings([created, ...(meetings || [])]);
                                                    setMeetingName('');
                                                    setMeetingColor(DEFAULT_MEETING_COLOR);
                                                    setMeetingTeacherIds([teacherId]);
                                                } catch (err) {
                                                    console.error('Failed to create meeting', err);
                                                } finally {
                                                    setCreatingMeeting(false);
                                                }
                                            };

                                            const addCustomTemplate = async () => {
                                                const name = customDraftName.trim();
                                                if (!name || !teacherId) return;
                                                setSavingCustomTemplate(true);
                                                try {
                                                    const next = [
                                                        ...(customBlockTemplates || []),
                                                        { template_id: newTemplateId(), name, color: customDraftColor || DEFAULT_CUSTOM_COLOR },
                                                    ];
                                                    await saveTemplates(next);
                                                    setCustomDraftName('');
                                                    setCustomDraftColor(DEFAULT_CUSTOM_COLOR);
                                                } catch (err) {
                                                    console.error('Failed to save custom template', err);
                                                } finally {
                                                    setSavingCustomTemplate(false);
                                                }
                                            };

                                            const deleteCustomTemplate = async (templateId: string) => {
                                                const next = (customBlockTemplates || []).filter((t) => t.template_id !== templateId);
                                                try {
                                                    await axios.put(
                                                        `${API_BASE}/teacher/${teacherId}/update`,
                                                        {
                                                            custom_block_templates: next,
                                                            // instances for this template are cleared by ScheduleItem when deleted from grid;
                                                            // if deleting unused chip, leave timeblocks alone
                                                        },
                                                        { headers: { Authorization: token } }
                                                    );
                                                    setCustomBlockTemplates(next);
                                                    window.dispatchEvent(new CustomEvent('officeCustomTemplateDeleted', { detail: { templateId } }));
                                                } catch (err) {
                                                    console.error('Failed to delete custom template', err);
                                                }
                                            };

                                            const deleteMeeting = async (meetingId: string) => {
                                                try {
                                                    await axios.delete(`${API_BASE}/meeting/${meetingId}/delete`, {
                                                        headers: { Authorization: token },
                                                    });
                                                    setMeetings((meetings || []).filter((m: any) => String(m._id?.$oid || m._id || m.id) !== meetingId));
                                                    window.dispatchEvent(new CustomEvent('officeMeetingDeleted', { detail: { meetingId } }));
                                                } catch (err) {
                                                    console.error('Failed to delete meeting', err);
                                                }
                                            };

                                            return (
                                                <>
                                                    <Box>
                                                        <Heading size="sm" mb={2}>Prep</Heading>
                                                        <Box
                                                            w="100%"
                                                            bg={statusColor}
                                                            color="black"
                                                            px={2}
                                                            py={3}
                                                            border={`2px solid`}
                                                            borderColor={borderColor}
                                                            borderRadius="md"
                                                            draggable
                                                            onDragStart={(e: React.DragEvent) => {
                                                                e.dataTransfer.setData("subject_id", PREP_SUBJECT_ID);
                                                                setDraggedSubjectId(PREP_SUBJECT_ID);
                                                                setDraggedSubjectData({
                                                                    isPrep: true,
                                                                    name: "Prep",
                                                                    displayname: "Prep",
                                                                    minld: PREP_DEFAULT_MINUTES,
                                                                    maxld: PREP_DEFAULT_MINUTES,
                                                                    color: PREP_COLOR,
                                                                });
                                                                setHoverSubject({
                                                                    isPrep: true,
                                                                    name: "Prep",
                                                                    teachers: [],
                                                                });
                                                                e.dataTransfer.effectAllowed = "move";
                                                            }}
                                                            onDragEnd={() => {
                                                                window.dispatchEvent(new CustomEvent("clearDragPreview"));
                                                            }}
                                                            cursor="grab"
                                                            _hover={{ opacity: 0.9 }}
                                                        >
                                                            <VStack spacing={0}>
                                                                <Text fontWeight="bold" fontSize="md">Prep</Text>
                                                                <Text fontSize="sm" color="gray.700" fontWeight="normal">
                                                                    {scheduledPrep} / {targetPrep} min
                                                                </Text>
                                                                <Text fontSize="xs" color="gray.600" fontWeight="normal" textAlign="center">
                                                                    {statusLabel}
                                                                </Text>
                                                                <Text fontSize="xs" color="gray.500" fontWeight="normal">
                                                                    Drag to schedule ({PREP_DEFAULT_MINUTES} min)
                                                                </Text>
                                                            </VStack>
                                                        </Box>
                                                    </Box>

                                                    <Divider />

                                                    <Box>
                                                        <Heading size="sm" mb={2}>Meetings</Heading>
                                                        <VStack align="stretch" spacing={2} mb={3}>
                                                            <Input
                                                                size="sm"
                                                                placeholder="Meeting name"
                                                                value={meetingName}
                                                                onChange={(e) => setMeetingName(e.target.value)}
                                                            />
                                                            <HStack>
                                                                <Text fontSize="sm" minW="40px">Color</Text>
                                                                <Input
                                                                    type="color"
                                                                    value={meetingColor}
                                                                    onChange={(e) => setMeetingColor(e.target.value)}
                                                                    w="60px"
                                                                    p={0}
                                                                    h="32px"
                                                                />
                                                            </HStack>
                                                            <Text fontSize="xs" fontWeight="bold">Teachers</Text>
                                                            <Input
                                                                size="sm"
                                                                placeholder="Search teachers..."
                                                                value={meetingTeacherSearch}
                                                                onChange={(e) => setMeetingTeacherSearch(e.target.value)}
                                                                mb={1}
                                                            />
                                                            <VStack align="stretch" maxH="140px" overflowY="auto" spacing={1}>
                                                                {allTeachers
                                                                    .filter((t: any) => {
                                                                        const term = meetingTeacherSearch.trim().toLowerCase();
                                                                        if (!term) return true;
                                                                        const name = String(t.displayname || t.name || '').toLowerCase();
                                                                        return name.includes(term);
                                                                    })
                                                                    .map((t: any) => {
                                                                    const tid = String(t._id?.$oid || t._id);
                                                                    const checked = meetingTeacherIds.includes(tid);
                                                                    return (
                                                                        <Checkbox
                                                                            key={tid}
                                                                            size="sm"
                                                                            isChecked={checked}
                                                                            onChange={(e) => {
                                                                                if (e.target.checked) {
                                                                                    setMeetingTeacherIds([...meetingTeacherIds, tid]);
                                                                                } else {
                                                                                    setMeetingTeacherIds(meetingTeacherIds.filter((id) => id !== tid));
                                                                                }
                                                                            }}
                                                                        >
                                                                            {t.displayname || t.name}
                                                                        </Checkbox>
                                                                    );
                                                                })}
                                                            </VStack>
                                                            <Button
                                                                size="sm"
                                                                colorScheme="teal"
                                                                isLoading={creatingMeeting}
                                                                onClick={createMeeting}
                                                                isDisabled={!meetingTeacherIds.length}
                                                            >
                                                                Create meeting
                                                            </Button>
                                                        </VStack>
                                                        <VStack align="stretch" spacing={2}>
                                                            {(meetings || []).map((m: any) => {
                                                                const mid = String(m._id?.$oid || m._id || m.id);
                                                                const names = m.teacher_names || [];
                                                                return (
                                                                    <Box
                                                                        key={mid}
                                                                        w="100%"
                                                                        bg={m.color || DEFAULT_MEETING_COLOR}
                                                                        color="black"
                                                                        px={2}
                                                                        py={3}
                                                                        border="1px solid black"
                                                                        borderRadius="md"
                                                                        position="relative"
                                                                        draggable
                                                                        onDragStart={(e: React.DragEvent) => {
                                                                            e.dataTransfer.setData("subject_id", meetingSubjectId(mid));
                                                                            e.dataTransfer.setData("meeting_id", mid);
                                                                            setDraggedSubjectId(meetingSubjectId(mid));
                                                                            const payload = {
                                                                                isMeeting: true,
                                                                                meetingId: mid,
                                                                                name: m.name || 'Meeting',
                                                                                displayname: m.name || 'Meeting',
                                                                                color: m.color || DEFAULT_MEETING_COLOR,
                                                                                teachers: names,
                                                                                teacherIds: (m.teacher_ids || []).map(String),
                                                                                minld: OFFICE_DEFAULT_MINUTES,
                                                                                maxld: OFFICE_DEFAULT_MINUTES,
                                                                            };
                                                                            setDraggedSubjectData(payload);
                                                                            setHoverSubject(payload);
                                                                            e.dataTransfer.effectAllowed = "move";
                                                                        }}
                                                                        onDragEnd={() => {
                                                                            window.dispatchEvent(new CustomEvent("clearDragPreview"));
                                                                        }}
                                                                        cursor="grab"
                                                                        _hover={{ opacity: 0.9 }}
                                                                    >
                                                                        <Button
                                                                            size="xs"
                                                                            position="absolute"
                                                                            top={1}
                                                                            right={1}
                                                                            colorScheme="red"
                                                                            variant="ghost"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                deleteMeeting(mid);
                                                                            }}
                                                                        >
                                                                            ×
                                                                        </Button>
                                                                        <VStack spacing={0} pr={4}>
                                                                            <Text fontWeight="bold" fontSize="md">{m.name || 'Meeting'}</Text>
                                                                            <Text fontSize="xs" color="gray.700" textAlign="center">
                                                                                {names.join(', ') || 'No teachers'}
                                                                            </Text>
                                                                            <Text fontSize="xs" color="gray.500">Hold ⌘ while dragging to preview</Text>
                                                                        </VStack>
                                                                    </Box>
                                                                );
                                                            })}
                                                        </VStack>
                                                    </Box>

                                                    <Divider />

                                                    <Box>
                                                        <Heading size="sm" mb={2}>Custom</Heading>
                                                        <VStack align="stretch" spacing={2} mb={3}>
                                                            <Input
                                                                size="sm"
                                                                placeholder="Label"
                                                                value={customDraftName}
                                                                onChange={(e) => setCustomDraftName(e.target.value)}
                                                            />
                                                            <HStack>
                                                                <Text fontSize="sm" minW="40px">Color</Text>
                                                                <Input
                                                                    type="color"
                                                                    value={customDraftColor}
                                                                    onChange={(e) => setCustomDraftColor(e.target.value)}
                                                                    w="60px"
                                                                    p={0}
                                                                    h="32px"
                                                                />
                                                                <Button
                                                                    size="sm"
                                                                    colorScheme="blue"
                                                                    isLoading={savingCustomTemplate}
                                                                    onClick={addCustomTemplate}
                                                                    isDisabled={!customDraftName.trim()}
                                                                >
                                                                    Add
                                                                </Button>
                                                            </HStack>
                                                        </VStack>
                                                        <VStack align="stretch" spacing={2}>
                                                            {(customBlockTemplates || []).map((tpl) => (
                                                                <Box
                                                                    key={tpl.template_id}
                                                                    w="100%"
                                                                    bg={tpl.color || DEFAULT_CUSTOM_COLOR}
                                                                    color="black"
                                                                    px={2}
                                                                    py={3}
                                                                    border="1px solid black"
                                                                    borderRadius="md"
                                                                    position="relative"
                                                                    draggable
                                                                    onDragStart={(e: React.DragEvent) => {
                                                                        const sid = customSubjectId(tpl.template_id);
                                                                        e.dataTransfer.setData("subject_id", sid);
                                                                        e.dataTransfer.setData("template_id", tpl.template_id);
                                                                        setDraggedSubjectId(sid);
                                                                        setDraggedSubjectData({
                                                                            isCustom: true,
                                                                            templateId: tpl.template_id,
                                                                            name: tpl.name,
                                                                            displayname: tpl.name,
                                                                            color: tpl.color || DEFAULT_CUSTOM_COLOR,
                                                                            minld: OFFICE_DEFAULT_MINUTES,
                                                                            maxld: OFFICE_DEFAULT_MINUTES,
                                                                        });
                                                                        e.dataTransfer.effectAllowed = "move";
                                                                    }}
                                                                    onDragEnd={() => {
                                                                        window.dispatchEvent(new CustomEvent("clearDragPreview"));
                                                                    }}
                                                                    cursor="grab"
                                                                    _hover={{ opacity: 0.9 }}
                                                                >
                                                                    <Button
                                                                        size="xs"
                                                                        position="absolute"
                                                                        top={1}
                                                                        right={1}
                                                                        colorScheme="red"
                                                                        variant="ghost"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            deleteCustomTemplate(tpl.template_id);
                                                                        }}
                                                                    >
                                                                        ×
                                                                    </Button>
                                                                    <VStack spacing={0} pr={4}>
                                                                        <Text fontWeight="bold" fontSize="md">{tpl.name}</Text>
                                                                        <Text fontSize="xs" color="gray.500">Drag to schedule</Text>
                                                                    </VStack>
                                                                </Box>
                                                            ))}
                                                        </VStack>
                                                    </Box>
                                                </>
                                            );
                                        })()}
                                    </VStack>
                                </TabPanel>

                                {/* 4) Hours: day/week span with empty gaps */}
                                <TabPanel px={1} h="100%" overflowY="auto" pb={4}>
                                    <VStack align="stretch" spacing={3}>
                                        <Checkbox
                                            isChecked={excludeEmptyHours}
                                            onChange={(e) => setExcludeEmptyHours(e.target.checked)}
                                            size="sm"
                                            colorScheme="blue"
                                        >
                                            Exclude empty time (filled only)
                                        </Checkbox>
                                        {(() => {
                                            const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
                                            const formatHours = (mins: number) => {
                                                const safe = Math.max(0, Math.round(mins));
                                                const h = Math.floor(safe / 60);
                                                const m = safe % 60;
                                                if (h === 0) return `${m}m`;
                                                if (m === 0) return `${h}h`;
                                                return `${h}h ${m}m`;
                                            };
                                            const mergeFilled = (intervals: Array<[number, number]>) => {
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
                                            const isTeacherBlockAssigned = (subj: any, tb: any) => {
                                                const subjId = String(subj?._id?.$oid || subj?._id || '');
                                                const requiredIds = (item?.required_teach || []).map((sid: any) => toSubjectId(sid));
                                                if (!requiredIds.includes(subjId)) return true;
                                                const override = (item?.required_teach_overrides || []).find(
                                                    (ov: any) => toSubjectId(ov?.subject) === subjId
                                                );
                                                if (!override) return true;
                                                const extras = new Set((override?.extratimeblocks || []).map((id: any) => String(id)));
                                                if (extras.size === 0) return true;
                                                const tbId = getTimeblockId(tb);
                                                if (!tbId) return !override?.excludeextras;
                                                return override?.excludeextras ? !extras.has(tbId) : extras.has(tbId);
                                            };
                                            const teacherAllSubjectIds = new Set([
                                                ...(item?.required_teach || []).map((sid: any) => toSubjectId(sid)),
                                                ...(item?.can_teach || []).map((sid: any) => toSubjectId(sid)),
                                            ]);

                                            type DayInterval = { day: string; start: number; end: number };
                                            const intervals: DayInterval[] = [];
                                            for (const subj of subjects) {
                                                const subjId = String(subj?._id?.$oid || subj?._id || '');
                                                if (!teacherAllSubjectIds.has(subjId)) continue;
                                                for (const tb of (subj.timeblocks || [])) {
                                                    if (!isTeacherBlockAssigned(subj, tb)) continue;
                                                    const start = tb?.start?.time || tb?.starttime;
                                                    const end = tb?.end?.time || tb?.endtime;
                                                    const startDay = tb?.start?.day || tb?.startday;
                                                    const endDay = tb?.end?.day || tb?.endday;
                                                    if (!start || !end || !startDay || startDay !== endDay) continue;
                                                    const s = timeToMinutes(start);
                                                    const e = timeToMinutes(end);
                                                    if (e <= s) continue;
                                                    intervals.push({ day: startDay, start: s, end: e });
                                                }
                                            }
                                            for (const tb of (prepTimeblocks || [])) {
                                                const start = tb?.start?.time || (tb as any)?.starttime;
                                                const end = tb?.end?.time || (tb as any)?.endtime;
                                                const startDay = tb?.start?.day || (tb as any)?.startday;
                                                const endDay = tb?.end?.day || (tb as any)?.endday;
                                                if (!start || !end || !startDay || startDay !== endDay) continue;
                                                const s = timeToMinutes(start);
                                                const e = timeToMinutes(end);
                                                if (e <= s) continue;
                                                intervals.push({ day: startDay, start: s, end: e });
                                            }
                                            for (const tb of (customTimeblocks || [])) {
                                                const start = tb?.start?.time || tb?.starttime;
                                                const end = tb?.end?.time || tb?.endtime;
                                                const startDay = tb?.start?.day || tb?.startday;
                                                const endDay = tb?.end?.day || tb?.endday;
                                                if (!start || !end || !startDay || startDay !== endDay) continue;
                                                const s = timeToMinutes(start);
                                                const e = timeToMinutes(end);
                                                if (e <= s) continue;
                                                intervals.push({ day: startDay, start: s, end: e });
                                            }
                                            for (const meeting of (meetings || [])) {
                                                for (const tb of (meeting.timeblocks || [])) {
                                                    const start = tb?.start?.time || tb?.starttime;
                                                    const end = tb?.end?.time || tb?.endtime;
                                                    const startDay = tb?.start?.day || tb?.startday;
                                                    const endDay = tb?.end?.day || tb?.endday;
                                                    if (!start || !end || !startDay || startDay !== endDay) continue;
                                                    const s = timeToMinutes(start);
                                                    const e = timeToMinutes(end);
                                                    if (e <= s) continue;
                                                    intervals.push({ day: startDay, start: s, end: e });
                                                }
                                            }

                                            const dayStats = days.map((day) => {
                                                const dayIntervals = intervals.filter((iv) => iv.day === day);
                                                if (!dayIntervals.length) {
                                                    return { day, span: 0, filled: 0, empty: 0, earliest: null as string | null, latest: null as string | null };
                                                }
                                                const earliest = Math.min(...dayIntervals.map((iv) => iv.start));
                                                const latest = Math.max(...dayIntervals.map((iv) => iv.end));
                                                const span = latest - earliest;
                                                const filled = mergeFilled(dayIntervals.map((iv) => [iv.start, iv.end] as [number, number]));
                                                const empty = Math.max(0, span - filled);
                                                const toTime = (min: number) => {
                                                    const h = Math.floor(min / 60);
                                                    const m = min % 60;
                                                    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                                                };
                                                return {
                                                    day,
                                                    span,
                                                    filled,
                                                    empty,
                                                    earliest: toTime(earliest),
                                                    latest: toTime(latest),
                                                };
                                            });

                                            const totalSpan = dayStats.reduce((s, d) => s + d.span, 0);
                                            const totalFilled = dayStats.reduce((s, d) => s + d.filled, 0);
                                            const totalEmpty = dayStats.reduce((s, d) => s + d.empty, 0);
                                            const totalShown = excludeEmptyHours ? totalFilled : totalSpan;

                                            return (
                                                <>
                                                    <Box
                                                        w="100%"
                                                        bg="blue.50"
                                                        border="1px solid"
                                                        borderColor="blue.300"
                                                        borderRadius="md"
                                                        p={3}
                                                    >
                                                        <Text fontWeight="bold" fontSize="md">Week total</Text>
                                                        <Text fontSize="lg" fontWeight="bold">
                                                            {formatHours(totalShown)}
                                                        </Text>
                                                        {!excludeEmptyHours && (
                                                            <Text fontSize="xs" color="gray.600">
                                                                Filled {formatHours(totalFilled)} · Empty {formatHours(totalEmpty)}
                                                            </Text>
                                                        )}
                                                        {excludeEmptyHours && (
                                                            <Text fontSize="xs" color="gray.600">
                                                                Classes + office blocks only (gaps excluded)
                                                            </Text>
                                                        )}
                                                    </Box>
                                                    {dayStats.map((d) => {
                                                        const shown = excludeEmptyHours ? d.filled : d.span;
                                                        if (!d.earliest) {
                                                            return (
                                                                <Box
                                                                    key={d.day}
                                                                    w="100%"
                                                                    border="1px solid"
                                                                    borderColor="gray.300"
                                                                    borderRadius="md"
                                                                    p={2}
                                                                    bg="gray.50"
                                                                >
                                                                    <Text fontWeight="bold" fontSize="sm">{d.day}</Text>
                                                                    <Text fontSize="sm" color="gray.500">No classes</Text>
                                                                </Box>
                                                            );
                                                        }
                                                        return (
                                                            <Box
                                                                key={d.day}
                                                                w="100%"
                                                                border="1px solid"
                                                                borderColor="gray.400"
                                                                borderRadius="md"
                                                                p={2}
                                                                bg="white"
                                                            >
                                                                <HStack justify="space-between" align="start">
                                                                    <Text fontWeight="bold" fontSize="sm">{d.day}</Text>
                                                                    <Text fontWeight="bold" fontSize="sm">{formatHours(shown)}</Text>
                                                                </HStack>
                                                                <Text fontSize="xs" color="gray.600">
                                                                    {formatTime(d.earliest!)} – {formatTime(d.latest!)}
                                                                </Text>
                                                                {!excludeEmptyHours && (
                                                                    <Text fontSize="xs" color="gray.600" mt={1}>
                                                                        Filled {formatHours(d.filled)} · Empty {formatHours(d.empty)}
                                                                    </Text>
                                                                )}
                                                                {excludeEmptyHours && (
                                                                    <Text fontSize="xs" color="gray.600" mt={1}>
                                                                        Filled only (empty was {formatHours(d.empty)})
                                                                    </Text>
                                                                )}
                                                            </Box>
                                                        );
                                                    })}
                                                </>
                                            );
                                        })()}
                                    </VStack>
                                </TabPanel>
                            </TabPanels>
                        </Tabs>
                    );
                })()}
            </Flex>
        );
    }else{
    return (

        <Flex
            direction="column"
            bg="#e6fcef"
            // color="white"
            w="100%"
            h="100vh"
            p={5}
            shadow="md"
            position="relative"
            align="center"
            // justify="center"
        >
            <VStack align="center" spacing={2}>
                <Heading fontSize="22px" color="black" as={Link} to="/home" cursor="pointer">
                    Schedule Manager
                </Heading>
                <Divider
                    borderColor="blackAlpha"
                    opacity={1}
                    borderWidth="1px"
                    w={"110%"}
                    my={4}
                />
                <VStack align="start" spacing={0} w={"130%"}>
                    {/*<Button variant="ghost" size="lg" fontSize={"150%"} w="full"colorScheme='blackAlpha' onClick={() => navigate('/home')} color="black">*/}
                    {/*    Home*/}
                    {/*</Button>*/}

                    <Button variant="ghost" size="lg" fontSize={"150%"} w="full" colorScheme='blackAlpha' as={Link} to="/subjects" color="black">
                        Subjects
                    </Button>
                    <Center w="full">
                        <ArrowDownIcon boxSize={5} color="black" />
                    </Center>
                    <Button variant="ghost" size="lg" fontSize={"150%"} w="full" colorScheme='blackAlpha' as={Link} to="/teachers" color="black">
                        Teachers
                    </Button>
                    <Center w="full">
                        <ArrowDownIcon boxSize={5} color="black" />
                    </Center>
                    <Button variant="ghost" size="lg" fontSize={"150%"} w="full" colorScheme='blackAlpha' as={Link} to="/students" color="black">
                        Students
                    </Button>

                </VStack>
            </VStack>
            {/* LOGOUT AT BOTTOM */}
            <Button
                variant="outline"
                onClick={handleLogout}
                colorScheme="red"
                mt="auto"
                alignSelf="start"
                ml={2}
            >
                Logout
            </Button>
        </Flex>

    );}
};

export default Navbar;