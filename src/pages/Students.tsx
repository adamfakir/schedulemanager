// src/pages/Students.tsx
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
import { useNavigate, Link } from 'react-router-dom';
import { usePageTitle } from '../utils/usePageTitle';
import { API_BASE, getStudentsFromCache, getSubjectsFromCache, loadAllStudents, loadAllSubjects, loadUserSelf } from '../utils/apiClient';

interface User {
    full_name: string;
    email: string;
    role?: string;
}

function Students() {
    // Set page title
    usePageTitle('Students - Schedule Manager');
    
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [students, setStudents] = useState<any[]>([]);
    const [studentsLoading, setStudentsLoading] = useState(true);
    const [filteredStudents, setFilteredStudents] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [tagSearchTerm, setTagSearchTerm] = useState("");
    const {isOpen, onOpen, onClose} = useDisclosure();
    const [isEditMode, setIsEditMode] = useState(false);
    const [currentStudent, setCurrentStudent] = useState<any>(null);
    const [pinnedStudentIds, setPinnedStudentIds] = useState<string[]>([]);
    const [allSubjects, setAllSubjects] = useState<any[]>([]);
    const [subjectSearch, setSubjectSearch] = useState("");
    const [subjectFilterMode, setSubjectFilterMode] = useState<"all" | "required">("all");
    const navigate = useNavigate();
    useEffect(() => {
        const storedPinned = localStorage.getItem('pinned_student_ids');
        if (storedPinned) {
            setPinnedStudentIds(JSON.parse(storedPinned));
        }
    }, []);
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token) {
            console.error('No token found');
            setLoading(false);
            setStudentsLoading(false);
            return;
        }

        const cachedStudents = getStudentsFromCache();
        if (cachedStudents) {
            setStudents(cachedStudents);
            setFilteredStudents(cachedStudents);
            const tags = new Set<string>();
            cachedStudents.forEach((student: { tags: string[]; }) => {
                student.tags?.forEach((tag: string) => tags.add(tag));
            });
            const tagArray = Array.from(tags);
            setAvailableTags(tagArray);
            setSelectedTags(tagArray);
            setStudentsLoading(false);
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

        loadAllStudents(token, { preferCache: false })
            .then((data) => {
                setStudents(data);
                setFilteredStudents(data);

                const tags = new Set<string>();
                data.forEach((student: { tags: string[]; }) => {
                    student.tags?.forEach((tag: string) => tags.add(tag));
                });

                const tagArray = Array.from(tags);
                setAvailableTags(tagArray);
                setSelectedTags(tagArray);
            })
            .catch((err) => {
                console.error("Failed to load students", err);
            })
            .finally(() => {
                setStudentsLoading(false);
            });

        loadAllSubjects(token, { preferCache: false })
            .then((data) => {
                setAllSubjects(data);
            })
            .catch((err) => console.error("Failed to load subjects", err));
    }, []);


    useEffect(() => {
        let results = [...students];

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



        setFilteredStudents(results);
    }, [students, availableTags, searchTerm, selectedTags]);
    if (loading || studentsLoading) {
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
    const togglePin = (studentId: string) => {
        setPinnedStudentIds(prev => {
            const isPinned = prev.includes(studentId);
            const updated = isPinned
                ? prev.filter(id => id !== studentId)
                : [...prev, studentId];

            localStorage.setItem('pinned_student_ids', JSON.stringify(updated));
            return updated;
        });
    };
    const handleSubmit = () => {
        const token = localStorage.getItem("user_token");
        const data = {...currentStudent};
        delete data._id;
        // Remove orgid if it's not a string (e.g., if it's an object or undefined)
        if (typeof data.orgid !== 'string') {
            delete data.orgid;
        }

        const request = isEditMode
            ? axios.put(`${API_BASE}/student/${currentStudent._id.$oid}/update`, data, {
                headers: {Authorization: token},
            })
            : axios.post(`${API_BASE}/student/create`, data, {
                headers: {Authorization: token},
            });

        request
            .then(() => {
                onClose();
                // reload students
                axios
                    .get(`${API_BASE}/student/all_org_students`, {
                        headers: {Authorization: token},
                        withCredentials: true,
                    })
                    .then((res) => {
                        setStudents(res.data);
                        setFilteredStudents(res.data);
                    });
            })
            .catch((err) => console.error("Submit failed", err));
    };
    const handleDelete = (studentId: string) => {
        const token = localStorage.getItem("user_token");
        if (!token) return;

        if (!window.confirm("Are you sure you want to delete this student?")) return;

        axios
            .delete(`${API_BASE}/student/${studentId}/delete`, {
                headers: {Authorization: token},
            })
            .then(() => {
                // Refresh student list after deletion
                return axios.get(`${API_BASE}/student/all_org_students`, {
                    headers: {Authorization: token},
                    withCredentials: true,
                });
            })
            .then((res) => {
                setStudents(res.data);
                setFilteredStudents(res.data);
            })
            .catch((err) => console.error("Delete failed", err));
    };
    // @ts-ignore
    const sortedStudents = [...filteredStudents].sort((a, b) => {
        const aPinned = pinnedStudentIds.includes(a._id?.$oid);
        const bPinned = pinnedStudentIds.includes(b._id?.$oid);
        return Number(bPinned) - Number(aPinned); // pinned first
    });
    return (
        <Box p={1}>
            <VStack align="center" justify="center" spacing={3}>
                <Heading size="lg">Students</Heading>
                <HStack w="full" align="center" justify="center" spacing={5}>
                    <Input
                        placeholder="Search students..."
                        size="md"
                        width="80%"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <Button colorScheme="green" rightIcon={<AddIcon/>} width={"100px"} onClick={() => {
                        setIsEditMode(false);
                        setCurrentStudent(null);
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
                        {filteredStudents.length === 0 && <Text>No students found for your organization/search.</Text>}
                        {(() => {
                            const pinned = sortedStudents.filter(s => pinnedStudentIds.includes(s._id?.$oid));
                            const unpinned = sortedStudents.filter(s => !pinnedStudentIds.includes(s._id?.$oid));

                            return (
                                <>
                                    {pinned.map((student) => (
                                        <Box
                                            key={`pinned-${student._id?.$oid}`}
                                            as={Link}
                                            to={`/schedule/${student._id?.$oid}`}
                                            p={3}
                                            bg="#daf7e6"
                                            borderRadius="md"
                                            cursor="pointer"
                                            _hover={{ bg: "#def" }}
                                            textDecoration="none"
                                            display="block"
                                            // borderLeft={`7px solid ${student.color}`}
                                        >
                                            <HStack justify="space-between">
                                                <Box fontWeight="bold">{student.name}</Box>
                                                {/*<VStack spacing={0}>*/}
                                                {/*    <Box fontSize="sm" color="gray.500">Weight</Box>*/}
                                                {/*    <Box fontWeight="medium">{student.weight}</Box>*/}
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
                                                                setCurrentStudent({
                                                                    ...student,
                                                                    required_classes: student.required_classes?.map((s: any) => s.$oid) || [],
                                                                });
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
                                                            onClick={(e) => {e.preventDefault(); e.stopPropagation(); togglePin(student._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Delete">
                                                        <IconButton
                                                            aria-label="Delete"
                                                            icon={<DeleteIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="red"
                                                            onClick={(e) => {e.preventDefault(); e.stopPropagation(); handleDelete(student._id.$oid)}}
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
                                                                setCurrentStudent({
                                                                    ...student,
                                                                    _id: undefined,
                                                                    name: `${student.name} (Copy)`,
                                                                    required_classes: (student.required_classes || []).map((s: any) => s.$oid || s),
                                                                });
                                                                onOpen();
                                                            }}
                                                        />
                                                    </Tooltip>
                                                </HStack>
                                            </HStack>
                                        </Box>
                                    ))}

                                    {(pinned.length > 0 && unpinned.length > 0) && <Divider borderColor="gray.400" />}

                                    {unpinned.map((student) => (
                                        <Box
                                            key={`unpinned-${student._id?.$oid}`}
                                            as={Link}
                                            to={`/schedule/${student._id?.$oid}`}
                                            p={3}
                                            bg="#e1f5e9"
                                            borderRadius="md"
                                            cursor="pointer"
                                            _hover={{ bg: "#def" }}
                                            textDecoration="none"
                                            display="block"
                                            // borderLeft={`7px solid ${student.color}`}
                                        >
                                            <HStack justify="space-between">
                                                <Box fontWeight="bold">{student.name}</Box>
                                                {/*<VStack spacing={0}>*/}
                                                {/*    <Box fontSize="sm" color="gray.500">Weight</Box>*/}
                                                {/*    <Box fontWeight="medium">{student.weight}</Box>*/}
                                                {/*</VStack>*/}
                                                <HStack spacing={1}>
                                                    <Tooltip label="Edit">
                                                        <IconButton
                                                            aria-label="Edit"
                                                            icon={<EditIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                setIsEditMode(true);
                                                                setCurrentStudent({
                                                                    ...student,
                                                                    required_classes: student.required_classes?.map((s: any) => s.$oid) || [],
                                                                });
                                                                onOpen();
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
                                                            onClick={(e) => {e.preventDefault(); e.stopPropagation(); togglePin(student._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Delete">
                                                        <IconButton
                                                            aria-label="Delete"
                                                            icon={<DeleteIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="red"
                                                            onClick={(e) => {e.preventDefault(); e.stopPropagation(); handleDelete(student._id.$oid)}}
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
                                                                setCurrentStudent({
                                                                    ...student,
                                                                    _id: undefined,
                                                                    name: `${student.name} (Copy)`,
                                                                    required_classes: (student.required_classes || []).map((s: any) => s.$oid || s),
                                                                });
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
                    <ModalHeader>{isEditMode ? "Edit Student" : "Create Student"}</ModalHeader>
                    <ModalCloseButton/>
                    <ModalBody>
                        <VStack spacing={5}>

                            <Input
                                // pl="40px" // space for color picker
                                placeholder="Student Name"
                                value={currentStudent?.name || ""}
                                onChange={(e) =>
                                    setCurrentStudent((prev: any) => ({
                                        ...prev,
                                        name: e.target.value,
                                    }))
                                }
                            />

                            <Divider orientation='horizontal'/>
                            <Box w="100%">
                                <Text fontWeight="bold" fontSize={17}>Required Classes</Text>

                                <Input
                                    placeholder="Search subjects by name or tag..."
                                    value={subjectSearch}
                                    onChange={(e) => setSubjectSearch(e.target.value)}
                                    my={2}
                                />
                                <HStack justify="start" spacing={2} mb={2}>
                                    <Text fontSize="sm" fontWeight="medium">Show:</Text>
                                    <Button size="xs" variant={subjectFilterMode === "all" ? "solid" : "ghost"} onClick={() => setSubjectFilterMode("all")}>All</Button>
                                    <Button size="xs" variant={subjectFilterMode === "required" ? "solid" : "ghost"} onClick={() => setSubjectFilterMode("required")}>Required</Button>
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
                                                const matchesSearch =
                                                    subject.name.toLowerCase().includes(subjectSearch.toLowerCase()) ||
                                                    (subject.tags || []).some((tag: string) =>
                                                        tag.toLowerCase().includes(subjectSearch.toLowerCase())
                                                    );

                                                const isRequired = currentStudent?.required_classes?.includes(id);

                                                if (subjectFilterMode === "required" && !isRequired) return false;
                                                return matchesSearch;
                                            })
                                            .map(subject => {
                                                const id = subject._id?.$oid;
                                                const isRequired = currentStudent?.required_classes?.includes(id);

                                                return (
                                                    <HStack key={id} spacing={3} align="center">
                                                        <Box w={3} h={3} borderRadius="full" bg={subject.color || "gray.300"} />
                                                        <Text flex={1}>{subject.name}</Text>
                                                        <Switch
                                                            size="sm"
                                                            colorScheme="red"
                                                            isChecked={isRequired}
                                                            onChange={(e) => {
                                                                setCurrentStudent((prev: any) => {
                                                                    const updated = { ...prev };
                                                                    const list = new Set(updated.required_classes || []);
                                                                    if (e.target.checked) {
                                                                        list.add(id);
                                                                    } else {
                                                                        list.delete(id);
                                                                    }
                                                                    updated.required_classes = Array.from(list);
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
                                                    if (!currentStudent?.tags?.includes(newTag)) {
                                                        setCurrentStudent((prev: any) => ({
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
                                                            !currentStudent?.tags?.includes(tag)
                                                    )
                                                    .map((tag) => (
                                                        <Box
                                                            key={tag}
                                                            px={3}
                                                            py={2}
                                                            _hover={{bg: "gray.100", cursor: "pointer"}}
                                                            onClick={() => {
                                                                setCurrentStudent((prev: any) => ({
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
                                            {(currentStudent?.tags || []).map((tag: string) => (
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
                                                            setCurrentStudent((prev: any) => ({
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

export default Students;