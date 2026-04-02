// src/pages/Teachers.tsx
import React, {useEffect, useRef, useState} from 'react';
import axios from 'axios';
import {
    Box,
    Menu,
    MenuButton,
    MenuList,
    MenuItem,
    MenuItemOption,
    MenuGroup,
    MenuOptionGroup,
    MenuDivider,
    Heading,
    Text,
    Spinner,
    VStack,
    Center,
    Input,
    HStack,
    Button,
    IconButton,
    Tooltip,
    useDisclosure,
    Modal,
    ModalContent,
    ModalFooter,
    ModalBody,
    ModalCloseButton, ModalHeader, ModalOverlay, InputGroup, InputLeftElement, Divider, Switch
} from '@chakra-ui/react';
import {AddIcon, ArrowUpIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, DeleteIcon, EditIcon, CopyIcon} from "@chakra-ui/icons";
import {FaThumbtack} from "react-icons/fa";
import { useNavigate, Link } from 'react-router-dom';
import { usePageTitle } from '../utils/usePageTitle';
import { API_BASE, getSubjectsFromCache, getTeachersFromCache, loadAllSubjects, loadAllTeachers, loadUserSelf } from '../utils/apiClient';

interface User {
    full_name: string;
    email: string;
    role?: string;
}

function Teachers() {
    // Set page title
    usePageTitle('Teachers - Schedule Manager');
    
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [teachers, setTeachers] = useState<any[]>([]);
    const [teachersLoading, setTeachersLoading] = useState(true);
    const [filteredTeachers, setFilteredTeachers] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [tagSearchTerm, setTagSearchTerm] = useState("");
    const {isOpen, onOpen, onClose} = useDisclosure();
    const [isEditMode, setIsEditMode] = useState(false);
    const [showMoreLPW, setShowMoreLPW] = useState(false);
    const [showMoreMPL, setShowMoreMPL] = useState(false);
    const [currentTeacher, setCurrentTeacher] = useState<any>(null);
    const [pinnedTeacherIds, setPinnedTeacherIds] = useState<string[]>([]);
    const [duplicateAvailability, setDuplicateAvailability] = useState(false);
    const [allSubjects, setAllSubjects] = useState<any[]>([]);
    const [subjectSearch, setSubjectSearch] = useState("");
    const [subjectFilterMode, setSubjectFilterMode] = useState<"all" | "can_teach" | "required">("all");
    const [expandedRequiredSubjects, setExpandedRequiredSubjects] = useState<Record<string, boolean>>({});
    const navigate = useNavigate();
    useEffect(() => {
        const storedPinned = localStorage.getItem('pinned_teacher_ids');
        if (storedPinned) {
            setPinnedTeacherIds(JSON.parse(storedPinned));
        }
    }, []);
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token) {
            console.error('No token found');
            setLoading(false);
            setTeachersLoading(false);
            return;
        }

        const cachedTeachers = getTeachersFromCache();
        if (cachedTeachers) {
            setTeachers(cachedTeachers);
            setFilteredTeachers(cachedTeachers);
            const tags = new Set<string>();
            cachedTeachers.forEach((teacher: { tags: string[]; }) => {
                teacher.tags?.forEach((tag: string) => tags.add(tag));
            });
            const tagArray = Array.from(tags);
            setAvailableTags(tagArray);
            setSelectedTags(tagArray);
            setTeachersLoading(false);
        }

        const cachedSubjects = getSubjectsFromCache();
        if (cachedSubjects) {
            setAllSubjects(cachedSubjects);
        }

        loadUserSelf(token)
            .then((data) => {
                setUser(data);
            })
            .catch((err) => {
                console.error('Failed to fetch user', err);
            })
            .finally(() => {
                setLoading(false);
            });

        loadAllTeachers(token, { preferCache: false })
            .then((data) => {
                setTeachers(data);
                setFilteredTeachers(data);

                const tags = new Set<string>();
                data.forEach((teacher: { tags: string[]; }) => {
                    teacher.tags?.forEach((tag: string) => tags.add(tag));
                });

                const tagArray = Array.from(tags);
                setAvailableTags(tagArray);
                setSelectedTags(tagArray);
            })
            .catch((err) => {
                console.error("Failed to load teachers", err);
            })
            .finally(() => {
                setTeachersLoading(false);
            });

        loadAllSubjects(token, { preferCache: false })
            .then((data) => {
                setAllSubjects(data);
            })
            .catch((err) => console.error("Failed to load subjects", err));
    }, []);


    useEffect(() => {
        let results = [...teachers];

        // Filter by search term (name or tag)
        if (searchTerm.trim()) {
            results = results.filter(sub =>
                sub.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                sub.tags?.some((tag: string) =>
                    tag.toLowerCase().includes(searchTerm.toLowerCase())
                )
            );
        }

        // Filter by selected tags (if any are deselected)
        if (selectedTags.length !== availableTags.length) {
            results = results.filter(sub =>
                sub.tags?.some((tag: string) => selectedTags.includes(tag))
            );
        }



        setFilteredTeachers(results);
    }, [teachers, availableTags, searchTerm, selectedTags]);
    if (loading || teachersLoading) {
        return (
            <Center h="100vh">
                <Spinner size="xl"/>
            </Center>
        );
    }

    if (!user) {
        return (
            <Box p={4}>
                <Heading>Error</Heading>
                <Text>Unauthorized.</Text>
            </Box>
        );
    }
    const togglePin = (teacherId: string) => {
        setPinnedTeacherIds(prev => {
            const isPinned = prev.includes(teacherId);
            const updated = isPinned
                ? prev.filter(id => id !== teacherId)
                : [...prev, teacherId];

            localStorage.setItem('pinned_teacher_ids', JSON.stringify(updated));
            return updated;
        });
    };
    const handleSubmit = () => {
        const token = localStorage.getItem("user_token");
        const data = {...currentTeacher};
        // Remove _id before sending
        delete data._id;
        // Remove orgid if it's not a string (e.g., if it's an object or undefined)
        if (typeof data.orgid !== 'string') {
            delete data.orgid;
        }
        // Handle duplicate availability
        if (!isEditMode && currentTeacher?.name?.endsWith('(Copy)')) {
            if (duplicateAvailability && Array.isArray(data.availability)) {
                data.availability = data.availability.map((tb: any) => {
                    if (tb.start && tb.end) {
                        return {
                            startday: tb.start.day,
                            starttime: tb.start.time,
                            endday: tb.end.day,
                            endtime: tb.end.time
                        };
                    }
                    return tb;
                });
            } else {
                data.availability = [];
            }
        }

        const request = isEditMode
            ? axios.put(`${API_BASE}/teacher/${currentTeacher._id.$oid}/update`, data, {
                headers: {Authorization: token},
            })
            : axios.post(`${API_BASE}/teacher/create`, data, {
                headers: {Authorization: token},
            });

        request
            .then(() => {
                onClose();
                // reload teachers
                axios
                    .get(`${API_BASE}/teacher/all_org_teachers`, {
                        headers: {Authorization: token},
                        withCredentials: true,
                    })
                    .then((res) => {
                        setTeachers(res.data);
                        setFilteredTeachers(res.data);
                    });
            })
            .catch((err) => console.error("Submit failed", err));
    };
    const handleDelete = (teacherId: string) => {
        const token = localStorage.getItem("user_token");
        if (!token) return;

        if (!window.confirm("Are you sure you want to delete this teacher?")) return;

        axios
            .delete(`${API_BASE}/teacher/${teacherId}/delete`, {
                headers: {Authorization: token},
            })
            .then(() => {
                // Refresh teacher list after deletion
                return axios.get(`${API_BASE}/teacher/all_org_teachers`, {
                    headers: {Authorization: token},
                    withCredentials: true,
                });
            })
            .then((res) => {
                setTeachers(res.data);
                setFilteredTeachers(res.data);
            })
            .catch((err) => console.error("Delete failed", err));
    };

    const handleCopyTeacherId = async (teacherId?: string) => {
        if (!teacherId) return;
        try {
            await navigator.clipboard.writeText(teacherId);
        } catch {
            // Fallback for older browsers.
            const el = document.createElement('textarea');
            el.value = teacherId;
            document.body.appendChild(el);
            el.select();
            document.execCommand('copy');
            document.body.removeChild(el);
        }
    };

    const toSubjectId = (raw: any): string => String(raw?.$oid || raw?.subject?.$oid || raw?.subject || raw?.id || raw || "");
    const getTimeblockId = (tb: any): string => String(tb?.blockid || tb?.id || tb?.timeblockId || "");

    const normalizeOverrides = (teacher: any) => {
        const overrides = (teacher?.required_teach_overrides || []).map((ov: any) => ({
            subject: toSubjectId(ov?.subject),
            excludeextras: ov?.excludeextras,
            extratimeblocks: Array.isArray(ov?.extratimeblocks) ? ov.extratimeblocks.map((id: any) => String(id)) : [],
        })).filter((ov: any) => ov.subject);
        return overrides;
    };

    const getOverrideForSubject = (teacher: any, subjectId: string) =>
        normalizeOverrides(teacher).find((ov: any) => ov.subject === subjectId) || null;

    const getSubjectTimeblockIds = (subjectId: string): string[] => {
        const subject = allSubjects.find((s: any) => (s._id?.$oid || s._id) === subjectId);
        return (subject?.timeblocks || []).map((tb: any) => getTimeblockId(tb)).filter(Boolean);
    };

    const isTimeblockSelected = (teacher: any, subjectId: string, blockId: string): boolean => {
        const override = getOverrideForSubject(teacher, subjectId);
        if (!override) return true;
        const extra = new Set(override.extratimeblocks || []);
        if (extra.size === 0) return true;
        return override.excludeextras ? !extra.has(blockId) : extra.has(blockId);
    };

    const setSubjectOverride = (subjectId: string, excludeextras: boolean, selectedBlockIds: string[]) => {
        setCurrentTeacher((prev: any) => {
            const allIds = getSubjectTimeblockIds(subjectId);
            const normalizedSelected = new Set(selectedBlockIds.filter(Boolean));
            const extratimeblocks = excludeextras
                ? allIds.filter((id) => !normalizedSelected.has(id))
                : allIds.filter((id) => normalizedSelected.has(id));

            const existing = normalizeOverrides(prev);
            const next = existing.filter((ov: any) => ov.subject !== subjectId);
            next.push({ subject: subjectId, excludeextras, extratimeblocks });

            return {
                ...prev,
                required_teach_overrides: next,
            };
        });
    };

    const toggleMainTeacher = (subjectId: string, value: boolean) => {
        const allIds = getSubjectTimeblockIds(subjectId);
        const selected = allIds.filter((tbId) => isTimeblockSelected(currentTeacher, subjectId, tbId));
        setSubjectOverride(subjectId, value, selected);
    };

    const toggleSubjectTimeblock = (subjectId: string, blockId: string, checked: boolean) => {
        const allIds = getSubjectTimeblockIds(subjectId);
        const selected = new Set(allIds.filter((tbId) => isTimeblockSelected(currentTeacher, subjectId, tbId)));
        if (checked) selected.add(blockId);
        else selected.delete(blockId);
        const currentOverride = getOverrideForSubject(currentTeacher, subjectId);
        const excludeMode = currentOverride ? !!currentOverride.excludeextras : true;
        setSubjectOverride(subjectId, excludeMode, Array.from(selected));
    };
    // @ts-ignore
    const sortedTeachers = [...filteredTeachers].sort((a, b) => {
        const aPinned = pinnedTeacherIds.includes(a._id?.$oid);
        const bPinned = pinnedTeacherIds.includes(b._id?.$oid);
        return Number(bPinned) - Number(aPinned); // pinned first
    });
    return (
        <Box p={1}>
            <VStack align="center" justify="center" spacing={3}>
                <Heading size="lg">Teachers</Heading>
                <HStack w="full" align="center" justify="center" spacing={5}>
                    <Input
                        placeholder="Search teachers..."
                        size="md"
                        width="80%"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <Button colorScheme="green" rightIcon={<AddIcon/>} width={"100px"} onClick={() => {
                        setIsEditMode(false);
                        setCurrentTeacher(null);
                        onOpen();
                    }}
                    >Create</Button>

                </HStack>
                <HStack w="full" align="center" justify="center" spacing={5}>
                    <Menu closeOnSelect={false}>
                        <MenuButton as={Button} colorScheme='gray' variant="ghost" width="20%"
                                    rightIcon={<ChevronDownIcon/>}>
                            Filter
                        </MenuButton>
                        <MenuList minWidth="240px">
                            <Box px={3} py={2}>
                                <Input
                                    placeholder="Search tags..."
                                    size="sm"
                                    value={tagSearchTerm}
                                    onChange={(e) => setTagSearchTerm(e.target.value)}
                                />
                                <HStack mt={2} justify="space-between">
                                    <Button size="xs" onClick={() => setSelectedTags([...availableTags])}>
                                        Select All
                                    </Button>
                                    <Button size="xs" onClick={() => setSelectedTags([])}>
                                        Deselect All
                                    </Button>
                                </HStack>
                            </Box>
                            <MenuOptionGroup type="checkbox" value={selectedTags}
                                             onChange={(values) => setSelectedTags(values as string[])}>
                                {availableTags
                                    .filter(tag => tag.toLowerCase().includes(tagSearchTerm.toLowerCase()))
                                    .map(tag => (
                                        <MenuItemOption key={tag} value={tag}>
                                            {tag}
                                        </MenuItemOption>
                                    ))}
                            </MenuOptionGroup>
                        </MenuList>
                    </Menu>

                </HStack>
                {/* Scrollable list of items */}
                <Box
                    mt={4}
                    width="100%"
                    maxH="500px"
                    overflowY="auto"
                    borderWidth="0px"
                    borderRadius="md"
                    p={3}
                >
                    <VStack spacing={3} align="stretch">
                        {filteredTeachers.length === 0 && <Text>No teachers found for your organization/search.</Text>}
                        {(() => {
                            const pinned = sortedTeachers.filter(s => pinnedTeacherIds.includes(s._id?.$oid));
                            const unpinned = sortedTeachers.filter(s => !pinnedTeacherIds.includes(s._id?.$oid));

                            return (
                                <>
                                    {pinned.map((teacher) => (
                                        <Box
                                            key={`pinned-${teacher._id?.$oid}`}
                                            as={Link}
                                            to={`/schedule/${teacher._id?.$oid}`}
                                            p={3}
                                            bg="#daf7e6"
                                            borderRadius="md"
                                            cursor="pointer"
                                            _hover={{ bg: "#def" }}
                                            textDecoration="none"
                                            display="block"
                                            onContextMenu={() => {
                                                handleCopyTeacherId(teacher._id?.$oid);
                                            }}
                                            // borderLeft={`7px solid ${teacher.color}`}
                                        >
                                            <HStack justify="space-between">
                                                <Box fontWeight="bold">{teacher.name}</Box>
                                                {/*<VStack spacing={0}>*/}
                                                {/*    <Box fontSize="sm" color="gray.500">Weight</Box>*/}
                                                {/*    <Box fontWeight="medium">{teacher.weight}</Box>*/}
                                                {/*</VStack>*/}
                                                <HStack spacing={1}>
                                                    <Tooltip label="Edit">
                                                        <IconButton
                                                            aria-label="Edit"
                                                            icon={<EditIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                setIsEditMode(true);
                                                                setCurrentTeacher({
                                                                    ...teacher,
                                                                    can_teach: teacher.can_teach?.map((s: any) => s.$oid) || [],
                                                                    required_teach: teacher.required_teach?.map((s: any) => s.$oid) || [],
                                                                    required_teach_overrides: normalizeOverrides(teacher),
                                                                });
                                                                setExpandedRequiredSubjects({});
                                                                onOpen();
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                            }}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Unpin">
                                                        <IconButton
                                                            aria-label="Unpin"
                                                            icon={<FaThumbtack />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="orange"
                                                            onClick={(e) => {e.preventDefault(); e.stopPropagation(); togglePin(teacher._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Delete">
                                                        <IconButton
                                                            aria-label="Delete"
                                                            icon={<DeleteIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="red"
                                                            onClick={(e) => {e.preventDefault(); e.stopPropagation(); handleDelete(teacher._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Duplicate">
                                                        <IconButton
                                                            aria-label="Duplicate"
                                                            icon={<CopyIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="purple"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                setIsEditMode(false);
                                                                setCurrentTeacher({
                                                                    ...teacher,
                                                                    _id: undefined,
                                                                    name: `${teacher.name} (Copy)`,
                                                                    can_teach: (teacher.can_teach || []).map((s: any) => s.$oid || s),
                                                                    required_teach: (teacher.required_teach || []).map((s: any) => s.$oid || s),
                                                                    required_teach_overrides: normalizeOverrides(teacher),
                                                                });
                                                                setExpandedRequiredSubjects({});
                                                                setDuplicateAvailability(false);
                                                                onOpen();
                                                            }}
                                                        />
                                                    </Tooltip>
                                                </HStack>
                                            </HStack>
                                        </Box>
                                    ))}

                                    {(pinned.length > 0 && unpinned.length > 0) && <Divider borderColor="gray.400" />}

                                    {unpinned.map((teacher) => (
                                        <Box
                                            key={`unpinned-${teacher._id?.$oid}`}
                                            as={Link}
                                            to={`/schedule/${teacher._id?.$oid}`}
                                            p={3}
                                            bg="#e1f5e9"
                                            borderRadius="md"
                                            cursor="pointer"
                                            _hover={{ bg: "#def" }}
                                            textDecoration="none"
                                            display="block"
                                            onContextMenu={() => {
                                                handleCopyTeacherId(teacher._id?.$oid);
                                            }}
                                            // borderLeft={`7px solid ${teacher.color}`}
                                        >
                                            <HStack justify="space-between">
                                                <Box fontWeight="bold">{teacher.name}</Box>
                                                {/*<VStack spacing={0}>*/}
                                                {/*    <Box fontSize="sm" color="gray.500">Weight</Box>*/}
                                                {/*    <Box fontWeight="medium">{teacher.weight}</Box>*/}
                                                {/*</VStack>*/}
                                                <HStack spacing={1}>
                                                    <Tooltip label="Edit">
                                                        <IconButton
                                                            aria-label="Edit"
                                                            icon={<EditIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                setIsEditMode(true);
                                                                setCurrentTeacher({
                                                                    ...teacher,
                                                                    can_teach: teacher.can_teach?.map((s: any) => s.$oid) || [],
                                                                    required_teach: teacher.required_teach?.map((s: any) => s.$oid) || [],
                                                                    required_teach_overrides: normalizeOverrides(teacher),
                                                                });
                                                                setExpandedRequiredSubjects({});
                                                                onOpen();
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                            }}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Pin">
                                                        <IconButton
                                                            aria-label="Pin"
                                                            icon={<FaThumbtack />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="gray"
                                                            onClick={(e) => {e.preventDefault(); e.stopPropagation(); togglePin(teacher._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Delete">
                                                        <IconButton
                                                            aria-label="Delete"
                                                            icon={<DeleteIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="red"
                                                            onClick={(e) => {e.preventDefault(); e.stopPropagation(); handleDelete(teacher._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Duplicate">
                                                        <IconButton
                                                            aria-label="Duplicate"
                                                            icon={<CopyIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="purple"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                setIsEditMode(false);
                                                                setCurrentTeacher({
                                                                    ...teacher,
                                                                    _id: undefined,
                                                                    name: `${teacher.name} (Copy)`,
                                                                    can_teach: (teacher.can_teach || []).map((s: any) => s.$oid || s),
                                                                    required_teach: (teacher.required_teach || []).map((s: any) => s.$oid || s),
                                                                    required_teach_overrides: normalizeOverrides(teacher),
                                                                });
                                                                setExpandedRequiredSubjects({});
                                                                setDuplicateAvailability(false);
                                                                onOpen();
                                                            }}
                                                        />
                                                    </Tooltip>
                                                </HStack>
                                            </HStack>
                                        </Box>
                                    ))}
                                </>
                            );
                        })()}
                    </VStack>
                </Box>
            </VStack>
            <Modal isOpen={isOpen} onClose={onClose}>
                <ModalOverlay/>
                <ModalContent>
                    <ModalHeader>{isEditMode ? "Edit Teacher" : "Create Teacher"}</ModalHeader>
                    <ModalCloseButton/>
                    <ModalBody>
                        <VStack spacing={5}>

                                <Input
                                    // pl="40px" // space for color picker
                                    placeholder="Teacher Name"
                                    value={currentTeacher?.name || ""}
                                    onChange={(e) =>
                                        setCurrentTeacher((prev: any) => ({
                                            ...prev,
                                            name: e.target.value,
                                        }))
                                    }
                                />

                            <Divider orientation='horizontal'/>
                            <Box w="100%">
                                <Text fontWeight="bold" fontSize={17}>Can Teach</Text>

                                <Input
                                    placeholder="Search subjects by name or tag..."
                                    value={subjectSearch}
                                    onChange={(e) => setSubjectSearch(e.target.value)}
                                    my={2}
                                />
                                <HStack justify="start" spacing={2} mb={2}>
                                    <Text fontSize="sm" fontWeight="medium">Show:</Text>
                                    <Button size="xs" variant={subjectFilterMode === "all" ? "solid" : "ghost"} onClick={() => setSubjectFilterMode("all")}>All</Button>
                                    <Button size="xs" variant={subjectFilterMode === "can_teach" ? "solid" : "ghost"} onClick={() => setSubjectFilterMode("can_teach")}>Can Teach</Button>
                                    <Button size="xs" variant={subjectFilterMode === "required" ? "solid" : "ghost"} onClick={() => setSubjectFilterMode("required")}>Required</Button>
                                </HStack>
                                <HStack spacing={1} justify={"end"}>
                                    <Text fontWeight="normal" fontSize={9}>Can Teach</Text>
                                    <Divider orientation='vertical'/>
                                    <Text fontWeight="normal" fontSize={9}>Required</Text>
                                </HStack>

                                <Box
                                    maxH="220px"
                                    overflowY="auto"
                                    border="1px solid #ccc"
                                    borderRadius="md"
                                    p={2}
                                    bg="gray.50"
                                >


                                    <VStack align="stretch" spacing={2}>
                                        {allSubjects
                                            .filter(subject => {
                                                const id = subject._id?.$oid;
                                                const matchesSearch = subject.name.toLowerCase().includes(subjectSearch.toLowerCase()) ||
                                                    (subject.tags || []).some((tag: string) =>
                                                        tag.toLowerCase().includes(subjectSearch.toLowerCase())
                                                    );

                                                const isSelected = currentTeacher?.can_teach?.includes(id);
                                                const isRequired = currentTeacher?.required_teach?.includes(id);

                                                if (subjectFilterMode === "can_teach" && !isSelected) return false;
                                                if (subjectFilterMode === "required" && !isRequired) return false;

                                                return matchesSearch;
                                            })
                                            .map(subject => {
                                                const id = subject._id?.$oid;
                                                const isSelected = currentTeacher?.can_teach?.includes(id);
                                                const isRequired = currentTeacher?.required_teach?.includes(id);
                                                const override = getOverrideForSubject(currentTeacher, id);
                                                const excludeMode = override ? !!override.excludeextras : true;
                                                const timeblocks = subject.timeblocks || [];
                                                const isExpanded = !!expandedRequiredSubjects[id];

                                                return (
                                                    <Box key={id} borderWidth="1px" borderColor="gray.200" borderRadius="md" p={2} bg="white">
                                                        <HStack spacing={3} align="center">
                                                            <Box
                                                                w={3}
                                                                h={3}
                                                                borderRadius="full"
                                                                bg={subject.color || "gray.300"}
                                                            />
                                                            <Text flex={1}>{subject.name}</Text>

                                                            {/* Can Teach Switch */}
                                                            <Switch
                                                                size="sm"
                                                                colorScheme="green"
                                                                isChecked={isSelected}
                                                                onChange={(e) => {
                                                                    setCurrentTeacher((prev: any) => {
                                                                        const updated = { ...prev };
                                                                        const list = new Set(updated.can_teach || []);
                                                                        if (e.target.checked) {
                                                                            list.add(id);
                                                                        } else {
                                                                            list.delete(id);
                                                                            updated.required_teach = (updated.required_teach || []).filter((rid: string) => rid !== id);
                                                                            updated.required_teach_overrides = normalizeOverrides(updated).filter((ov: any) => ov.subject !== id);
                                                                        }
                                                                        updated.can_teach = Array.from(list);
                                                                        return updated;
                                                                    });
                                                                }}
                                                            />

                                                            {/* Required Switch */}
                                                            <Switch
                                                                size="sm"
                                                                colorScheme={excludeMode ? "green" : "yellow"}
                                                                isChecked={isRequired}
                                                                onChange={(e) => {
                                                                    const checked = e.target.checked;
                                                                    setCurrentTeacher((prev: any) => {
                                                                        const updated = { ...prev };
                                                                        const list = new Set(updated.required_teach || []);
                                                                        if (checked) {
                                                                            if (!updated.can_teach?.includes(id)) {
                                                                                updated.can_teach = [...(updated.can_teach || []), id];
                                                                            }
                                                                            list.add(id);
                                                                            const currentOverrides = normalizeOverrides(updated).filter((ov: any) => ov.subject !== id);
                                                                            currentOverrides.push({ subject: id, excludeextras: true, extratimeblocks: [] });
                                                                            updated.required_teach_overrides = currentOverrides;
                                                                        } else {
                                                                            list.delete(id);
                                                                            updated.required_teach_overrides = normalizeOverrides(updated).filter((ov: any) => ov.subject !== id);
                                                                            setExpandedRequiredSubjects((prevOpen) => ({ ...prevOpen, [id]: false }));
                                                                        }
                                                                        updated.required_teach = Array.from(list);
                                                                        return updated;
                                                                    });
                                                                }}
                                                            />

                                                            {isRequired && timeblocks.length > 0 && (
                                                                <IconButton
                                                                    aria-label="Toggle required period options"
                                                                    icon={isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                                                                    size="xs"
                                                                    variant="ghost"
                                                                    onClick={() => setExpandedRequiredSubjects((prevOpen) => ({ ...prevOpen, [id]: !prevOpen[id] }))}
                                                                />
                                                            )}
                                                        </HStack>

                                                        {isRequired && timeblocks.length > 0 && isExpanded && (
                                                            <Box mt={2} p={2} borderWidth="1px" borderColor="gray.100" borderRadius="md" bg="gray.50">
                                                                <HStack justify="space-between" mb={2}>
                                                                    <Text fontSize="xs" fontWeight="bold">Main Teacher Mode</Text>
                                                                    <Switch
                                                                        size="sm"
                                                                        colorScheme={excludeMode ? "green" : "yellow"}
                                                                        isChecked={excludeMode}
                                                                        onChange={(e) => toggleMainTeacher(id, e.target.checked)}
                                                                    />
                                                                </HStack>
                                                                <Text fontSize="2xs" color="gray.600" mb={2}>
                                                                    Green = include-all-except-unchecked. Yellow = include-only-checked.
                                                                </Text>
                                                                <VStack align="stretch" spacing={1} maxH="120px" overflowY="auto">
                                                                    {timeblocks.map((tb: any, idx: number) => {
                                                                        const blockId = getTimeblockId(tb);
                                                                        if (!blockId) return null;
                                                                        const selected = isTimeblockSelected(currentTeacher, id, blockId);
                                                                        return (
                                                                            <Switch
                                                                                key={`${id}-tb-${blockId}-${idx}`}
                                                                                size="sm"
                                                                                colorScheme={excludeMode ? "green" : "yellow"}
                                                                                isChecked={selected}
                                                                                onChange={(e) => toggleSubjectTimeblock(id, blockId, e.target.checked)}
                                                                            >
                                                                                {tb.start?.day?.slice(0, 3)} {tb.start?.time} - {tb.end?.time}
                                                                            </Switch>
                                                                        );
                                                                    })}
                                                                </VStack>
                                                            </Box>
                                                        )}
                                                    </Box>
                                                );
                                            })}
                                    </VStack>
                                </Box>
                            </Box>
                            <Divider orientation='horizontal'/>
                            {/*<Text fontWeight={"bold"} fontSize={15}>Can teach</Text>*/}
                            {/*<Divider orientation='horizontal'  />*/}
                            <HStack align="center" w="100%" spacing={4}>
                                {/* Left side: search input + dropdown */}
                                <Box flex={1}>
                                    <Text fontWeight="bold" fontSize={15}>Add Tag</Text>
                                    <Box position="relative">
                                        <Input
                                            placeholder="Search or type tag name"
                                            value={tagSearchTerm}
                                            onChange={(e) => setTagSearchTerm(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && tagSearchTerm.trim()) {
                                                    const newTag = tagSearchTerm.trim();
                                                    if (!currentTeacher?.tags?.includes(newTag)) {
                                                        setCurrentTeacher((prev: any) => ({
                                                            ...prev,
                                                            tags: [...(prev.tags || []), newTag],
                                                        }));
                                                    }
                                                    setTagSearchTerm('');
                                                }
                                            }}
                                        />
                                        {tagSearchTerm && (
                                            <Box
                                                position="absolute"
                                                zIndex={2}
                                                bg="white"
                                                border="1px solid #ccc"
                                                mt={1}
                                                borderRadius="md"
                                                maxH="150px"
                                                overflowY="auto"
                                                width="100%"
                                                boxShadow="sm"
                                            >
                                                {availableTags
                                                    .filter(
                                                        (tag) =>
                                                            tag.toLowerCase().includes(tagSearchTerm.toLowerCase()) &&
                                                            !currentTeacher?.tags?.includes(tag)
                                                    )
                                                    .map((tag) => (
                                                        <Box
                                                            key={tag}
                                                            px={3}
                                                            py={2}
                                                            _hover={{bg: "gray.100", cursor: "pointer"}}
                                                            onClick={() => {
                                                                setCurrentTeacher((prev: any) => ({
                                                                    ...prev,
                                                                    tags: [...(prev.tags || []), tag],
                                                                }));
                                                                setTagSearchTerm('');
                                                            }}
                                                        >
                                                            {tag}
                                                        </Box>
                                                    ))}
                                            </Box>
                                        )}
                                    </Box>
                                </Box>

                                {/* Right side: selected tags */}
                                <Box flex={2}>
                                    <Text fontWeight="bold" fontSize={15}>Selected Tags</Text>
                                    <Box
                                        mt={1}
                                        maxH="120px"
                                        overflowY="auto"
                                        p={2}
                                        border="1px solid #ccc"
                                        borderRadius="md"
                                        bg="gray.50"
                                    >
                                        <HStack wrap="wrap" spacing={2} align="start">
                                            {(currentTeacher?.tags || []).map((tag: string) => (
                                                <Box
                                                    key={tag}
                                                    px={3}
                                                    py={1}
                                                    bg="gray.200"
                                                    borderRadius="full"
                                                    display="flex"
                                                    alignItems="center"
                                                >
                                                    <Text fontSize="sm" mr={2}>
                                                        {tag}
                                                    </Text>
                                                    <IconButton
                                                        icon={<CloseIcon boxSize={2.5}/>}
                                                        size="xs"
                                                        variant="ghost"
                                                        aria-label={`Remove ${tag}`}
                                                        onClick={() =>
                                                            setCurrentTeacher((prev: any) => ({
                                                                ...prev,
                                                                tags: (prev.tags || []).filter((t: string) => t !== tag),
                                                            }))
                                                        }
                                                    />
                                                </Box>
                                            ))}
                                        </HStack>
                                    </Box>
                                </Box>
                            </HStack>
                            <Divider orientation='horizontal'/>

                            {/* Show duplicate availability option only when duplicating */}
                            {!isEditMode && currentTeacher?.name?.endsWith('(Copy)') && (
                                <HStack justify="space-between" w="100%">
                                    <Text fontWeight="bold" fontSize={17}>Duplicate Availability</Text>
                                    <Switch
                                        colorScheme="blue"
                                        size={"md"}
                                        isChecked={duplicateAvailability}
                                        onChange={(e) => setDuplicateAvailability(e.target.checked)}
                                    />
                                </HStack>
                            )}

                            <Text fontWeight="bold" fontSize={17}>*Availability times can be put on their schedule*</Text>


                        </VStack>
                    </ModalBody>
                    <ModalFooter>
                        <Button colorScheme="blue" mr={3} onClick={handleSubmit}>
                            {isEditMode ? "Update" : "Create"}
                        </Button>
                        <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </Box>

    );
}

export default Teachers;