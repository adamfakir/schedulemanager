import React from 'react';
import { useEffect, useState, useContext } from 'react';
import {Box, Flex, Button, Spacer, Heading, HStack, VStack, Center, Icon, Divider, Menu,
    MenuButton,
    MenuList,
    MenuItem,
    IconButton,  Tabs, TabList, TabPanels, Tab, TabPanel, Input, Text } from '@chakra-ui/react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowDownIcon, HamburgerIcon} from '@chakra-ui/icons'
import { AvailabilityContext } from '../utils/AvailabilityContext';
import { teacherCacheGlobal, subjectCacheGlobal } from '../utils/globalCache';

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
} from '../utils/dragSubjectStore';const Navbar = () => {
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
    const formatTime = (time: string): string => {
        const [h, m] = time.split(":").map(Number);
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    const {
        availability, setAvailability,
        editing, setEditing,
        mode, setMode
    } = useContext(AvailabilityContext);
     type TimeBlock = {
        start: { day: string; time: string };
        end:   { day: string; time: string };
    };
    const computeBusyRanges = (availability: TimeBlock[]): TimeBlock[] => {
        const allDayTimes = ['00:00', '11:59'];
        const busyRanges: TimeBlock[] = [];

        const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

        for (const day of days) {
            const slots = availability
                .filter(r => r.start.day === day)
                .sort((a, b) => a.start.time.localeCompare(b.start.time));

            let current = '00:00';
            for (const slot of slots) {
                if (slot.start.time > current) {
                    busyRanges.push({
                        start: { day, time: current },
                        end:   { day, time: slot.start.time },
                    });
                }
                current = slot.end.time;
            }

            if (current < '23:59') {
                busyRanges.push({
                    start: { day, time: current },
                    end:   { day, time: '23:59' },
                });
            }
        }

        return busyRanges;
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
        } catch (err) {
            console.error("❌ Failed to save availability:", err);
        }
    };
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!isSchedulePage || !location.pathname.startsWith('/schedule/')) return;
        const id = location.pathname.split('/schedule/')[1];
        setScheduleId(id);
        const fetchTypeAndSubjects = async () => {
            try {
                const res = await axios.get(`https://schedulebackendapi-3an8u.ondigitalocean.app/student/${id}`, {
                    headers: { Authorization: token },
                });
                setScheduleType("Student");
                setItem(res.data);  // <--- Add this
                const allStudentsRes = await axios.get(`https://schedulebackendapi-3an8u.ondigitalocean.app/student/all_org_students`, {
                    headers: { Authorization: token },
                });
                const allStudents = allStudentsRes.data || [];
                setAllStudents(allStudents);
                // Fetch subjects (use cache if available)
                if (!subjectCacheGlobal.current) {
                    const subjRes = await axios.get(`https://schedulebackendapi-3an8u.ondigitalocean.app/subject/all_org_subjects`, {
                        headers: { Authorization: token },
                    });
                    subjectCacheGlobal.current = subjRes.data || [];
                }
                setSubjects(subjectCacheGlobal.current || []);
                // Fetch teachers (use cache if available)
                if (!teacherCacheGlobal.current) {
                    const teacherRes = await axios.get(`https://schedulebackendapi-3an8u.ondigitalocean.app/teacher/all_org_teachers`, {
                        headers: { Authorization: token },
                    });
                    teacherCacheGlobal.current = teacherRes.data || [];
                }
                const allTeachers = teacherCacheGlobal.current || [];
                // Attach teacher names
                const enrichedSubjects = (subjectCacheGlobal.current || []).map((subject: any) => {
                    const requiredTeacherNames = allTeachers
                        .filter((t: any) =>
                            (t.required_teach || []).some((sid: any) =>
                                (sid.$oid || sid) === (subject._id?.$oid || subject._id)
                            )
                        )
                        .map((t: any) => ({
                            name: t.displayname || t.name,
                            id: t._id?.$oid || t._id
                        }));
                    return { ...subject, teachers: requiredTeacherNames };
                });
                setSubjects(enrichedSubjects);
            } catch {
                try {
                    const teacherRes = await axios.get(
                        `https://schedulebackendapi-3an8u.ondigitalocean.app/teacher/${id}`,
                        { headers: { Authorization: token } }
                    );
                    const teacherData = { ...teacherRes.data, type: "Teacher" };
                    setItem(teacherData);
                    setScheduleType("Teacher");
                    setAvailability(teacherData.availability || []);
                    const allStudentsRes = await axios.get(
                        `https://schedulebackendapi-3an8u.ondigitalocean.app/student/all_org_students`,
                        { headers: { Authorization: token } }
                    );
                    setAllStudents(allStudentsRes.data || []);
                    if (!subjectCacheGlobal.current) {
                        const subjRes = await axios.get(
                            `https://schedulebackendapi-3an8u.ondigitalocean.app/subject/all_org_subjects`,
                            { headers: { Authorization: token } }
                        );
                        subjectCacheGlobal.current = subjRes.data;
                    }
                    setSubjects(subjectCacheGlobal.current || []);
                } catch {
                    try {
                        await axios.get(`https://schedulebackendapi-3an8u.ondigitalocean.app/subject/${id}`, {
                            headers: { Authorization: token },
                        });
                        setScheduleType("Subject");
                    } catch {
                        setScheduleType(null);
                    }
                }
            }
        };
        fetchTypeAndSubjects();

        const pinned = localStorage.getItem('pinned_subject_ids');
        if (pinned) {
            setPinnedSubjectIds(JSON.parse(pinned));
        }
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
                        <MenuItem onClick={() => navigate('/subjects')}>Subjects</MenuItem>
                        <MenuItem onClick={() => navigate('/teachers')}>Teachers</MenuItem>
                        <MenuItem onClick={() => navigate('/students')}>Students</MenuItem>
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
                                    {sortedRequired.map(s => (
                                        <Box
                                            key={s._id?.$oid}
                                            draggable
                                            onDragStart={(e) => {
                                                e.dataTransfer.setData("subject_id", s._id?.$oid);
                                                setDraggedSubjectId(s._id?.$oid);
                                                setDraggedSubjectData(s);
                                                e.dataTransfer.effectAllowed = "move";
                                                // 👈 this matches the dropEffect// <-- you'll create this
                                            }}
                                            onDragEnd={() => {
                                                // Tell the schedule to clear hover state
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
                                            onClick={() => navigate(`/schedule/${s._id?.$oid}`)}
                                        >
                                            <VStack spacing={0} w="100%">
                                                <Text fontWeight="bold" fontSize="md">{s.displayname || s.name}</Text>
                                                { s.teachers && s.teachers.length > 0 && (
                                                    <HStack wrap="wrap" justify="center">
                                                        {s.teachers.map((t: any, idx: number) => (
                                                            <Text
                                                                key={t.id || idx}
                                                                fontSize="sm"
                                                                fontWeight="normal"
                                                                // textDecoration="underline"
                                                                color="blackAlpha"
                                                                cursor="pointer"
                                                                _hover={{ textDecoration: "underline", color: "blue.800" }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation(); // 👈 prevent subject box click
                                                                    navigate(`/schedule/${t.id}`);
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
                                            onClick={() => navigate(`/schedule/${s._id?.$oid}`)}
                                        >
                                            <VStack spacing={0} w="100%">
                                                <Text fontWeight="bold" fontSize="md">{s.displayname || s.name}</Text>
                                                { s.teachers && s.teachers.length > 0 && (
                                                    <HStack wrap="wrap" justify="center">
                                                        {s.teachers.map((t: any, idx: number) => (
                                                            <Text
                                                                key={t.id || idx}
                                                                fontSize="sm"
                                                                fontWeight="normal"
                                                                // textDecoration="underline"
                                                                color="blackAlpha"
                                                                cursor="pointer"
                                                                _hover={{ textDecoration: "underline", color: "blue.800" }}
                                                                onClick={(e) => {
                                                                    e.stopPropagation(); // 👈 prevent subject box click
                                                                    navigate(`/schedule/${t.id}`);
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
                                                    onClick={() => navigate(`/schedule/${s._id?.$oid || s._id}`)}
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
                        <Tabs mt={4} variant="enclosed" w="100%">
                            <TabList overflowX="auto" whiteSpace="nowrap">
                                <Tab flex="none">Availability</Tab>
                                    <Tab flex="none">Students</Tab>
                                    <Tab flex="none">Subjects</Tab>
                            </TabList>

                            <TabPanels>
                                {/* 1) Availability (blank for now) */}
                                <TabPanel px={1}>
                                    <VStack align="stretch" spacing={2} maxH="60vh" overflowY="auto">

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
                                                        <select id="add-day" style={{ width: "100%", padding: "6px", borderRadius: "4px" }}>
                                                            {["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map(d => (
                                                                <option key={d}>{d}</option>
                                                            ))}
                                                        </select>
                                                    </Box>

                                                    <Box w="100%">
                                                        <Text fontSize="sm" fontWeight="bold" mb={1}>Start Time</Text>
                                                        <Input id="add-start" type="time" size="sm" width="100%" />
                                                    </Box>

                                                    <Box w="100%">
                                                        <Text fontSize="sm" fontWeight="bold" mb={1}>End Time</Text>
                                                        <Input id="add-end" type="time" size="sm" width="100%" />
                                                    </Box>

                                                    <Button
                                                        size="sm"
                                                        colorScheme="blue"
                                                        alignSelf="start"
                                                        onClick={() => {
                                                            const day = (document.getElementById("add-day") as HTMLSelectElement).value;
                                                            const start = (document.getElementById("add-start") as HTMLInputElement).value;
                                                            const end = (document.getElementById("add-end") as HTMLInputElement).value;
                                                            if (!start || !end || !day) return;

                                                            const newRange = { start: { day, time: start }, end: { day, time: end } };

                                                            if (mode === "available") {
                                                                const updated = [...availability, newRange];
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

                                                                setAvailability(updated);
                                                                saveAvailability(updated);
                                                            }

                                                            // Clear inputs
                                                            (document.getElementById("add-start") as HTMLInputElement).value = '';
                                                            (document.getElementById("add-end") as HTMLInputElement).value = '';
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
                                <TabPanel px={1}>
                                    <VStack align="center" spacing={2} maxH="60vh" overflowY="auto">
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
                                                        w="100%"
                                                        bg="green.100"
                                                        color="black"
                                                        px={2}
                                                        py={3}
                                                        border="1px solid black"
                                                        borderRadius="md"
                                                        cursor="pointer"
                                                        _hover={{ opacity: 0.9 }}
                                                        onClick={() => navigate(`/schedule/${student._id.$oid || student._id}`)}
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
                                <TabPanel px={1}>
                                    <VStack align="center" spacing={2} maxH="60vh" overflowY="auto">
                                        {subjects
                                            .filter((subj: any) =>
                                                teacherSubjectIds.includes(subj._id.$oid || subj._id)
                                            )
                                            .map((subj: any) => (
                                                <Box
                                                    key={subj._id.$oid || subj._id}
                                                    w="100%"
                                                    bg={subj.color || "gray.300"}
                                                    color="black"
                                                    px={2}
                                                    py={3}
                                                    border="1px solid black"
                                                    borderRadius="md"
                                                    cursor="pointer"
                                                    _hover={{ opacity: 0.9 }}
                                                    onClick={() => navigate(`/schedule/${subj._id.$oid || subj._id}`)}
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
                <Heading fontSize="22px" color="black" onClick={() => navigate('/home')} cursor="pointer">
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

                    <Button variant="ghost" size="lg" fontSize={"150%"} w="full"colorScheme='blackAlpha' onClick={() => navigate('/subjects')} color="black">
                        Subjects
                    </Button>
                    <Center w="full">
                        <ArrowDownIcon boxSize={5} color="black" />
                    </Center>
                    <Button variant="ghost" size="lg"  fontSize={"150%"}w="full"colorScheme='blackAlpha' onClick={() => navigate('/teachers')} color="black">
                        Teachers
                    </Button>
                    <Center w="full">
                        <ArrowDownIcon boxSize={5} color="black" />
                    </Center>
                    <Button variant="ghost" size="lg" fontSize={"150%"} w="full"colorScheme='blackAlpha' onClick={() => navigate('/students')} color="black">
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