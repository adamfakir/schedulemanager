// src/pages/Subjects.tsx
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
import {AddIcon, ArrowUpIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, DeleteIcon, EditIcon} from "@chakra-ui/icons";
import {FaThumbtack} from "react-icons/fa";
import { useNavigate } from 'react-router-dom';
const API_BASE = "https://schedulemanagerbackend.onrender.com";

interface User {
    full_name: string;
    email: string;
    role?: string;
}

interface DurationInputProps {
    initialHours?: string;
    initialMinutes?: string;
    onChange: (duration: { hours: string; minutes: string }) => void;
}

function DurationInput({
                           onChange,
                           initialHours = '00',
                           initialMinutes = '00',
                       }: DurationInputProps) {
    const hoursRef = useRef<HTMLInputElement>(null);
    const minutesRef = useRef<HTMLInputElement>(null);

    const [hours, setHours] = useState(initialHours);
    const [minutes, setMinutes] = useState(initialMinutes);

    // Sync with external changes
    useEffect(() => {
        setHours(initialHours);
        setMinutes(initialMinutes);
    }, [initialHours, initialMinutes]);

    const handleHoursChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value.replace(/\D/g, '').slice(0, 2);
        setHours(val);
        onChange({hours: val, minutes});
        if (val.length === 2) {
            minutesRef.current?.focus();
        }
    };

    const handleMinutesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value.replace(/\D/g, '').slice(0, 2);
        setMinutes(val);
        onChange({hours, minutes: val});
    };

    const handleMinutesKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (
            e.key === 'Backspace' &&
            (e.currentTarget.value === '' || e.currentTarget.selectionStart === 0)
        ) {
            hoursRef.current?.focus();
        }
    };

    return (
        <HStack spacing={0} border="1px solid #ccc" borderRadius="md" overflow="hidden" width="fit-content">
            <Input
                ref={hoursRef}
                type="text"
                placeholder="HH"
                value={hours}
                onChange={handleHoursChange}
                maxLength={2}
                textAlign="center"
                width="60px"
                border="none"
                borderRight="1px solid #ccc"
                borderRadius="0"
                _focus={{outline: 'none', boxShadow: 'none'}}
            />
            <Box px={2} fontWeight="bold" bg="gray.50">
                :
            </Box>
            <Input
                ref={minutesRef}
                type="text"
                placeholder="MM"
                value={minutes}
                onChange={handleMinutesChange}
                onKeyDown={handleMinutesKeyDown}
                maxLength={2}
                textAlign="center"
                width="60px"
                border="none"
                borderLeft="1px solid #ccc"
                borderRadius="0"
                _focus={{outline: 'none', boxShadow: 'none'}}
            />
        </HStack>
    );
}

function Subjects() {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [subjects, setSubjects] = useState<any[]>([]);
    const [subjectsLoading, setSubjectsLoading] = useState(true);
    const [filteredSubjects, setFilteredSubjects] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
    const [availableTags, setAvailableTags] = useState<string[]>([]);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [tagSearchTerm, setTagSearchTerm] = useState("");
    const {isOpen, onOpen, onClose} = useDisclosure();
    const [isEditMode, setIsEditMode] = useState(false);
    const [showMoreLPW, setShowMoreLPW] = useState(false);
    const [showMoreMPL, setShowMoreMPL] = useState(false);
    const [showMoreDPN, setShowMoreDPN] = useState(false);
    const [currentSubject, setCurrentSubject] = useState<any>(null);
    const [pinnedSubjectIds, setPinnedSubjectIds] = useState<string[]>([]);
    const navigate = useNavigate();
    useEffect(() => {
        const storedPinned = localStorage.getItem('pinned_subject_ids');
        if (storedPinned) {
            setPinnedSubjectIds(JSON.parse(storedPinned));
        }
    }, []);
    useEffect(() => {
        const token = localStorage.getItem('user_token');
        if (!token) {
            console.error('No token found');
            setLoading(false);
            setSubjectsLoading(false);
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
        axios.get(`${API_BASE}/subject/all_org_subjects`, {
            headers: {Authorization: token},
            withCredentials: true,
        })
            .then(res => {
                const data = res.data;
                setSubjects(data);
                setFilteredSubjects(data);

                const tags = new Set<string>();
                data.forEach((subject: { tags: string[]; }) => {
                    subject.tags?.forEach((tag: string) => tags.add(tag));
                });

                const tagArray = Array.from(tags);
                setAvailableTags(tagArray);
                setSelectedTags(tagArray);
            })
            .catch(err => {
                console.error("Failed to load subjects", err);
            })
            .finally(() => {
                setSubjectsLoading(false);
            });
    }, []);


    useEffect(() => {
        let results = [...subjects];

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

        // Sort by weight
        results.sort((a, b) => {
            return sortOrder === "asc"
                ? a.weight - b.weight
                : b.weight - a.weight;
        });

        setFilteredSubjects(results);
    }, [searchTerm, sortOrder, selectedTags]);
    if (loading || subjectsLoading) {
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
    const togglePin = (subjectId: string) => {
        setPinnedSubjectIds(prev => {
            const isPinned = prev.includes(subjectId);
            const updated = isPinned
                ? prev.filter(id => id !== subjectId)
                : [...prev, subjectId];

            localStorage.setItem('pinned_subject_ids', JSON.stringify(updated));
            return updated;
        });
    };
    const handleSubmit = () => {
        const token = localStorage.getItem("user_token");
        const data = {...currentSubject};

        const request = isEditMode
            ? axios.put(`${API_BASE}/subject/${currentSubject._id.$oid}/update`, data, {
                headers: {Authorization: token},
            })
            : axios.post(`${API_BASE}/subject/create`, data, {
                headers: {Authorization: token},
            });

        request
            .then(() => {
                onClose();
                // reload subjects
                axios
                    .get(`${API_BASE}/subject/all_org_subjects`, {
                        headers: {Authorization: token},
                        withCredentials: true,
                    })
                    .then((res) => {
                        setSubjects(res.data);
                        setFilteredSubjects(res.data);
                    });
            })
            .catch((err) => console.error("Submit failed", err));
    };
    const handleDelete = (subjectId: string) => {
        const token = localStorage.getItem("user_token");
        if (!token) return;

        if (!window.confirm("Are you sure you want to delete this subject?")) return;

        axios
            .delete(`${API_BASE}/subject/${subjectId}/delete`, {
                headers: {Authorization: token},
            })
            .then(() => {
                // Refresh subject list after deletion
                return axios.get(`${API_BASE}/subject/all_org_subjects`, {
                    headers: {Authorization: token},
                    withCredentials: true,
                });
            })
            .then((res) => {
                setSubjects(res.data);
                setFilteredSubjects(res.data);
            })
            .catch((err) => console.error("Delete failed", err));
    };
    // @ts-ignore
    const sortedSubjects = [...filteredSubjects].sort((a, b) => {
        const aPinned = pinnedSubjectIds.includes(a._id?.$oid);
        const bPinned = pinnedSubjectIds.includes(b._id?.$oid);
        return Number(bPinned) - Number(aPinned); // pinned first
    });
    return (
        <Box p={1}>
            <VStack align="center" justify="center" spacing={3}>
                <Heading size="lg">Subjects</Heading>
                <HStack w="full" align="center" justify="center" spacing={5}>
                    <Input
                        placeholder="Search subjects..."
                        size="md"
                        width="80%"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <Button colorScheme="green" rightIcon={<AddIcon/>} width={"100px"} onClick={() => {
                        setIsEditMode(false);
                        setCurrentSubject(null);
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
                    <Menu>
                        <MenuButton as={Button} colorScheme='gray' variant="ghost" width="20%"
                                    rightIcon={<ChevronDownIcon/>}>
                            Sort
                        </MenuButton>
                        <MenuList minWidth="240px">
                            <MenuOptionGroup
                                title="Order"
                                type="radio"
                                defaultValue={sortOrder}
                                onChange={(val) => setSortOrder(val as "asc" | "desc")}
                            >
                                <MenuItemOption value="asc">Ascending</MenuItemOption>
                                <MenuItemOption value="desc">Descending</MenuItemOption>
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
                        {filteredSubjects.length === 0 && <Text>No subjects found for your organization/search.</Text>}
                        {(() => {
                            const pinned = sortedSubjects.filter(s => pinnedSubjectIds.includes(s._id?.$oid));
                            const unpinned = sortedSubjects.filter(s => !pinnedSubjectIds.includes(s._id?.$oid));

                            return (
                                <>
                                    {pinned.map((subject) => (
                                        <Box
                                            key={`pinned-${subject._id?.$oid}`}
                                            p={3}
                                            bg="#daf7e6"
                                            borderRadius="md"
                                            borderLeft={`7px solid ${subject.color}`}
                                            onClick={() => navigate(`/schedule/${subject._id?.$oid}`)}
                                            cursor="pointer"
                                            _hover={{ bg: "#def" }}
                                        >
                                            <HStack justify="space-between">
                                                <Box fontWeight="bold">{subject.name}</Box>
                                                <VStack spacing={0}>
                                                    <Box fontSize="sm" color="gray.500">Weight</Box>
                                                    <Box fontWeight="medium">{subject.weight}</Box>
                                                </VStack>
                                                <HStack spacing={1}>
                                                    <Tooltip label="Edit">
                                                        <IconButton
                                                            aria-label="Edit"
                                                            icon={<EditIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                setIsEditMode(true);
                                                                setCurrentSubject(subject);
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
                                                            onClick={(e) => {e.stopPropagation(); togglePin(subject._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Delete">
                                                        <IconButton
                                                            aria-label="Delete"
                                                            icon={<DeleteIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="red"
                                                            onClick={(e) =>{e.stopPropagation(); handleDelete(subject._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                </HStack>
                                            </HStack>
                                        </Box>
                                    ))}

                                    {(pinned.length > 0 && unpinned.length > 0) && <Divider borderColor="gray.400" />}

                                    {unpinned.map((subject) => (
                                        <Box
                                            key={`unpinned-${subject._id?.$oid}`}
                                            p={3}
                                            bg="#e1f5e9"
                                            borderRadius="md"
                                            borderLeft={`7px solid ${subject.color}`}
                                            onClick={() => navigate(`/schedule/${subject._id?.$oid}`)}
                                            cursor="pointer"
                                            _hover={{ bg: "#def" }}
                                        >
                                            <HStack justify="space-between">
                                                <Box fontWeight="bold">{subject.name}</Box>
                                                <VStack spacing={0}>
                                                    <Box fontSize="sm" color="gray.500">Weight</Box>
                                                    <Box fontWeight="medium">{subject.weight}</Box>
                                                </VStack>
                                                <HStack spacing={1}>
                                                    <Tooltip label="Edit">
                                                        <IconButton
                                                            aria-label="Edit"
                                                            icon={<EditIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={(e) => {
                                                                setIsEditMode(true);
                                                                setCurrentSubject(subject);
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
                                                            onClick={(e) => {e.stopPropagation(); togglePin(subject._id.$oid)}}
                                                        />
                                                    </Tooltip>
                                                    <Tooltip label="Delete">
                                                        <IconButton
                                                            aria-label="Delete"
                                                            icon={<DeleteIcon />}
                                                            variant="ghost"
                                                            size="sm"
                                                            colorScheme="red"
                                                            onClick={(e) => {e.stopPropagation(); handleDelete(subject._id.$oid)}}
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
                    <ModalHeader>{isEditMode ? "Edit Subject" : "Create Subject"}</ModalHeader>
                    <ModalCloseButton/>
                    <ModalBody>
                        <VStack spacing={5}>
                            <InputGroup>
                                {/* Embedded Color Picker */}
                                <InputLeftElement pointerEvents="auto">
                                    <Input
                                        type="color"
                                        value={currentSubject?.color || "#b8b8b8"}
                                        onChange={(e) =>
                                            setCurrentSubject((prev: any) => ({
                                                ...prev,
                                                color: e.target.value,
                                            }))
                                        }
                                        w="90%"
                                        h="100%"
                                        border="none"
                                        p="0"
                                        bg="transparent"
                                        cursor="pointer"
                                        _focus={{boxShadow: "none"}}
                                    />
                                </InputLeftElement>

                                {/* Subject Name Input */}
                                <Input
                                    pl="40px" // space for color picker
                                    placeholder="Subject Name"
                                    value={currentSubject?.name || ""}
                                    onChange={(e) =>
                                        setCurrentSubject((prev: any) => ({
                                            ...prev,
                                            name: e.target.value,
                                        }))
                                    }
                                />
                            </InputGroup>
                            <IconButton
                                aria-label="Expand"
                                icon={showMoreDPN ? <ChevronUpIcon/> : <ChevronDownIcon/>}
                                size="sm"
                                variant="ghost"
                                onClick={() => setShowMoreDPN(!showMoreDPN)}
                            />
                            {showMoreDPN && (
                                <Box pl={2}>
                                    <HStack spacing={3} mt={2}>
                                        <VStack spacing={0} align="stretch">
                                            <Text fontWeight={"bold"} fontSize={10}>Display Name</Text>
                                            <Input placeholder={currentSubject?.name || ""}
                                                   value={currentSubject?.displayname || currentSubject?.name}
                                                   onChange={(e) =>
                                                       setCurrentSubject((prev: any) => ({
                                                           ...prev,
                                                           displayname: e.target.value,
                                                       }))
                                                   }/>
                                        </VStack>

                                        <VStack spacing={0} align="stretch">
                                            <Text fontWeight={"bold"} fontSize={10}>Display Class</Text>
                                            <Input placeholder={""}
                                                   value={currentSubject?.displayclass || ""}
                                                   onChange={(e) =>
                                                       setCurrentSubject((prev: any) => ({
                                                           ...prev,
                                                           displayclass: e.target.value,
                                                       }))
                                                   }/>
                                        </VStack>
                                    </HStack>
                                </Box>
                            )}
                            <Divider orientation='horizontal'/>

                            <HStack justify="space-between" align="top" w="100%">
                                <VStack spacing={1} align="center" w="50%">
                                    <Text fontWeight="bold">Lesson Duration</Text>

                                    <DurationInput
                                        initialHours={(() => {
                                            const avg = ((currentSubject?.minld ?? 0) + (currentSubject?.maxld ?? 0)) / 2;
                                            return String(Math.floor(avg / 60)).padStart(2, '0');
                                        })()}
                                        initialMinutes={(() => {
                                            const avg = ((currentSubject?.minld ?? 0) + (currentSubject?.maxld ?? 0)) / 2;
                                            return String(Math.floor(avg % 60)).padStart(2, '0');
                                        })()}
                                        onChange={({hours, minutes}) => {
                                            const h = parseInt(hours || "0", 10);
                                            const m = parseInt(minutes || "0", 10);
                                            setCurrentSubject((prev: any) => ({
                                                ...prev,
                                                minld: ((h * 60) + m),
                                                maxld: ((h * 60) + m),
                                            }));
                                        }}
                                    />
                                    <IconButton
                                        aria-label="Expand"
                                        icon={showMoreMPL ? <ChevronUpIcon/> : <ChevronDownIcon/>}
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setShowMoreMPL(!showMoreMPL)}
                                    />
                                    {showMoreMPL && (
                                        <Box pl={2}>
                                            <HStack spacing={3} mt={2}>
                                                <VStack spacing={0} align="stretch">
                                                    <Text fontWeight={"bold"} fontSize={10}>Min per/lesson</Text>
                                                    <Input placeholder="mins"
                                                           value={currentSubject?.minld || ""}
                                                           onChange={(e) =>
                                                               setCurrentSubject((prev: any) => ({
                                                                   ...prev,
                                                                   minld: parseInt(e.target.value || "0", 10),
                                                               }))
                                                           }/>
                                                </VStack>

                                                <VStack spacing={0} align="stretch">
                                                    <Text fontWeight={"bold"} fontSize={10}>Max per/lesson</Text>
                                                    <Input placeholder="mins"
                                                           value={currentSubject?.maxld || ""}
                                                           onChange={(e) =>
                                                               setCurrentSubject((prev: any) => ({
                                                                   ...prev,
                                                                   maxld: parseInt(e.target.value || "0", 10),
                                                               }))
                                                           }/>
                                                </VStack>
                                            </HStack>
                                        </Box>
                                    )}
                                </VStack>

                                <VStack spacing={1} align="center" w="50%">
                                    <Text fontWeight="bold">Lessons per week</Text>
                                    <Input
                                        type="text"
                                        placeholder="#"
                                        w="50%"
                                        value={
                                            currentSubject?.minwd != null && currentSubject?.maxwd != null &&
                                            currentSubject?.minld != null && currentSubject?.maxld != null
                                                ? Math.round(
                                                    ((currentSubject.minwd + currentSubject.maxwd) / 2) /
                                                    Math.round((currentSubject.minld + currentSubject.maxld) / 2)
                                                )
                                                : ""
                                        }
                                        onChange={(e) =>
                                            setCurrentSubject((prev: any) => ({
                                                ...prev,
                                                maxwd: parseInt(e.target.value || "0", 10) * (currentSubject?.maxld || 0),
                                                minwd: parseInt(e.target.value || "0", 10) * (currentSubject?.minld || 0),
                                            }))
                                        }
                                    />
                                    <IconButton
                                        aria-label="Expand"
                                        icon={showMoreLPW ? <ChevronUpIcon/> : <ChevronDownIcon/>}
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setShowMoreLPW(!showMoreLPW)}
                                    />
                                    {showMoreLPW && (
                                        <Box pl={2}>
                                            <HStack spacing={3} mt={2}>
                                                <VStack spacing={0} align="stretch">
                                                    <Text fontWeight={"bold"} fontSize={10}>Min per/week</Text>
                                                    <Input placeholder="mins"
                                                           value={currentSubject?.minwd ?? "0"}

                                                           onChange={(e) =>
                                                               setCurrentSubject((prev: any) => ({
                                                                   ...prev,
                                                                   minwd: parseInt(e.target.value || "0", 10),
                                                               }))
                                                           }/>
                                                </VStack>

                                                <VStack spacing={0} align="stretch">
                                                    <Text fontWeight={"bold"} fontSize={10}>Max per/week</Text>
                                                    <Input placeholder="mins"
                                                           value={currentSubject?.maxwd ?? "0"}

                                                           onChange={(e) =>
                                                               setCurrentSubject((prev: any) => ({
                                                                   ...prev,
                                                                   maxwd: parseInt(e.target.value || "0", 10),
                                                               }))
                                                           }/>
                                                </VStack>
                                            </HStack>
                                        </Box>
                                    )}

                                </VStack>
                            </HStack>
                            <Divider orientation='horizontal'/>
                            <HStack justify="space-between" align="top" w="100%">
                                <VStack>
                                    <Text fontWeight={"bold"} fontSize={15}>Weight</Text>
                                    <Input
                                        placeholder="Weight"
                                        type="number"
                                        w={"50%"}
                                        value={currentSubject?.weight === undefined ? "" : currentSubject.weight}

                                        onChange={(e) =>
                                            setCurrentSubject((prev: any) => ({
                                                ...prev,
                                                weight: e.target.value === "" ? undefined : parseInt(e.target.value, 10),
                                            }))
                                        }
                                    />
                                </VStack>
                                <Box
                                    pl={2}
                                    borderWidth="1px"
                                    borderRadius="md"
                                    w="50%"
                                    maxH="100px"
                                    overflowY="auto"
                                    bg="gray.50"
                                >
                                    <VStack align="stretch" spacing={1} p={2}>
                                        {(() => {
                                            const weight = currentSubject?.weight;
                                            const name = currentSubject?.name;
                                            const editedId = currentSubject?._id;
                                            const merged = subjects.map(s => (s._id === editedId ? currentSubject : s));
                                            const sorted = [...merged].sort((a, b) => b.weight - a.weight);
                                            const elements: JSX.Element[] = [];

                                            let inserted = false;

                                            for (let i = 0; i < sorted.length; i++) {
                                                const subj = sorted[i];
                                                if (!inserted && weight != null && weight > subj.weight && !isEditMode) {
                                                    elements.push(
                                                        <HStack
                                                            key="new-subject-preview"
                                                            justify="space-between"
                                                            p={1}
                                                            bg="blue.100"
                                                            borderRadius="md"
                                                            border="1px dashed #3182ce"
                                                        >
                                                            <Text fontSize="sm" fontWeight="bold">
                                                                {currentSubject?.name || "(New Subject)"}
                                                            </Text>
                                                            <Text fontSize="sm">{weight}</Text>
                                                        </HStack>
                                                    );
                                                    inserted = true;
                                                }

                                                const isCurrent = name && subj.name === name && subj.weight === weight;

                                                elements.push(
                                                    <HStack
                                                        key={subj.name + subj.weight}
                                                        justify="space-between"
                                                        p={1}
                                                        bg={isCurrent ? "yellow.100" : "white"}
                                                        borderRadius="md"
                                                        border={isCurrent ? "1px solid #ECC94B" : "1px solid transparent"}
                                                    >
                                                        <Text fontSize="sm" fontWeight={isCurrent ? "bold" : "normal"}>
                                                            {subj.name}
                                                        </Text>
                                                        <Text fontSize="sm">{subj.weight}</Text>
                                                    </HStack>
                                                );
                                            }

                                            // If new weight is smaller than all existing, append it
                                            if (!inserted && weight != null && !isEditMode) {
                                                elements.push(
                                                    <HStack
                                                        key="new-subject-preview-end"
                                                        justify="space-between"
                                                        p={1}
                                                        bg="blue.100"
                                                        borderRadius="md"
                                                        border="1px dashed #3182ce"
                                                    >
                                                        <Text fontSize="sm" fontWeight="bold">
                                                            {currentSubject?.name || "(New Subject)"}
                                                        </Text>
                                                        <Text fontSize="sm">{weight}</Text>
                                                    </HStack>
                                                );
                                            }

                                            return elements;
                                        })()}
                                    </VStack>
                                </Box>
                            </HStack>
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
                                                    if (!currentSubject?.tags?.includes(newTag)) {
                                                        setCurrentSubject((prev: any) => ({
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
                                                            !currentSubject?.tags?.includes(tag)
                                                    )
                                                    .map((tag) => (
                                                        <Box
                                                            key={tag}
                                                            px={3}
                                                            py={2}
                                                            _hover={{bg: "gray.100", cursor: "pointer"}}
                                                            onClick={() => {
                                                                setCurrentSubject((prev: any) => ({
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
                                            {(currentSubject?.tags || []).map((tag: string) => (
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
                                                            setCurrentSubject((prev: any) => ({
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
                            <HStack justify="space-between" w="100%">
                                <Text fontWeight="bold" fontSize={17}>Fixed</Text>
                                <Switch
                                    colorScheme="green"
                                    size={"md"}
                                    isChecked={currentSubject?.fixed || false}
                                    onChange={(e) =>
                                        setCurrentSubject((prev: any) => ({
                                            ...prev,
                                            fixed: e.target.checked,
                                        }))
                                    }
                                />
                            </HStack>

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

export default Subjects;