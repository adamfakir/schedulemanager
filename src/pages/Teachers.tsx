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
    ModalCloseButton, ModalHeader, ModalOverlay, InputGroup, InputLeftElement, Collapse, Divider, Switch
} from '@chakra-ui/react';
import {AddIcon, ArrowUpIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, DeleteIcon, EditIcon, CopyIcon} from "@chakra-ui/icons";
import {FaThumbtack} from "react-icons/fa";
import { useNavigate } from 'react-router-dom';
const API_BASE = "https://schedulebackendapi-3an8u.ondigitalocean.app/";

interface User {
    full_name: string;
    email: string;
    role?: string;
}

function Teachers() {
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

        axios.get(`${API_BASE}/user/get_self`, {
            headers: {Authorization: token},
            withCredentials: true,
        })
            .then((res) => {
                setUser(res.data);
            })
            .catch((err) => {
                console.error('Failed to fetch user', err);
            })
            .finally(() => {
                setLoading(false);
            });
        axios.get(`${API_BASE}/teacher/all_org_teachers`, {
            headers: {Authorization: token},
            withCredentials: true,
        })
            .then(res => {
                const data = res.data;
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
            .catch(err => {
                console.error("Failed to load teachers", err);
            })
            .finally(() => {
                setTeachersLoading(false);
            });
        axios.get(`${API_BASE}/subject/all_org_subjects`, {
            headers: { Authorization: token },
            withCredentials: true,
        })
            .then((res) => {
                setAllSubjects(res.data);
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
    }, [searchTerm, selectedTags]);
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
                                            p={3}
                                            bg="#daf7e6"
                                            borderRadius="md"
                                            onClick={() => navigate(`/schedule/${teacher._id?.$oid}`)}
                                            cursor="pointer"
                                            _hover={{ bg: "#def" }}
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
                                                                });
                                                                onOpen();
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
                                                            onClick={(e) => {e.stopPropagation(); togglePin(teacher._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Delete">
                                                        <IconButton
                                                            aria-label="Delete"
                                                            icon={<DeleteIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="red"
                                                            onClick={(e) => {e.stopPropagation(); handleDelete(teacher._id.$oid)}}
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
                                                                e.stopPropagation();
                                                                setIsEditMode(false);
                                                                setCurrentTeacher({
                                                                    ...teacher,
                                                                    _id: undefined,
                                                                    name: `${teacher.name} (Copy)`,
                                                                    can_teach: (teacher.can_teach || []).map((s: any) => s.$oid || s),
                                                                    required_teach: (teacher.required_teach || []).map((s: any) => s.$oid || s),
                                                                });
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
                                            p={3}
                                            bg="#e1f5e9"
                                            borderRadius="md"
                                            onClick={() => navigate(`/schedule/${teacher._id?.$oid}`)}
                                            cursor="pointer"
                                            _hover={{ bg: "#def" }}
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
                                                                });
                                                                onOpen();
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
                                                            onClick={(e) => {e.stopPropagation(); togglePin(teacher._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Delete">
                                                        <IconButton
                                                            aria-label="Delete"
                                                            icon={<DeleteIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="red"
                                                            onClick={(e) => {e.stopPropagation(); handleDelete(teacher._id.$oid)}}
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
                                                                e.stopPropagation();
                                                                setIsEditMode(false);
                                                                setCurrentTeacher({
                                                                    ...teacher,
                                                                    _id: undefined,
                                                                    name: `${teacher.name} (Copy)`,
                                                                    can_teach: (teacher.can_teach || []).map((s: any) => s.$oid || s),
                                                                    required_teach: (teacher.required_teach || []).map((s: any) => s.$oid || s),
                                                                });
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

                                                return (
                                                    <HStack key={id} spacing={3} align="center">
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
                                                                        // Uncheck required if no longer can teach
                                                                        updated.required_teach = (updated.required_teach || []).filter((rid: string) => rid !== id);
                                                                    }
                                                                    updated.can_teach = Array.from(list);
                                                                    return updated;
                                                                });
                                                            }}
                                                        />

                                                        {/* Required Switch */}
                                                        <Switch
                                                            size="sm"
                                                            colorScheme="red"
                                                            isChecked={isRequired}
                                                            onChange={(e) => {
                                                                setCurrentTeacher((prev: any) => {
                                                                    const updated = { ...prev };
                                                                    const list = new Set(updated.required_teach || []);
                                                                    if (e.target.checked) {
                                                                        if (!updated.can_teach?.includes(id)) {
                                                                            updated.can_teach = [...(updated.can_teach || []), id];
                                                                        }
                                                                        list.add(id);
                                                                    } else {
                                                                        list.delete(id);
                                                                    }
                                                                    updated.required_teach = Array.from(list);
                                                                    return updated;
                                                                });
                                                            }}
                                                        />
                                                    </HStack>
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