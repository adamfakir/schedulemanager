import React, { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import {
    Alert,
    AlertDescription,
    AlertIcon,
    Box,
    Button,
    Checkbox,
    Divider,
    HStack,
    Link as ChakraLink,
    List,
    ListItem,
    Menu,
    MenuButton,
    MenuDivider,
    MenuItem,
    MenuList,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    Progress,
    Spinner,
    Text,
    VStack,
    useDisclosure,
} from '@chakra-ui/react';
import { ChevronDownIcon, DownloadIcon } from '@chakra-ui/icons';
import { Link as RouterLink } from 'react-router-dom';
import {
    API_BASE,
    loadAllStudents,
    loadAllSubjects,
    loadAllTeachers,
} from '../utils/apiClient';
import { exportEntitiesSchedulesToPdf } from '../utils/pdfExport';
import {
    ChangedEntity,
    ChangeSessionPayload,
    computeStudentFingerprints,
    computeTeacherFingerprints,
    diffEntityFingerprints,
    endChangeSession,
    fetchChangeSession,
    startChangeSession,
} from '../utils/changeSession';

type Props = {
    /** Which list page this panel sits on — controls default review tab emphasis. */
    focus: 'teachers' | 'students';
};

const ChangeSessionPanel: React.FC<Props> = ({ focus }) => {
    const [sessionState, setSessionState] = useState<ChangeSessionPayload | null>(null);
    const [loadingSession, setLoadingSession] = useState(true);
    const [starting, setStarting] = useState(false);
    const [ending, setEnding] = useState(false);
    const [reviewLoading, setReviewLoading] = useState(false);
    const [changedTeachers, setChangedTeachers] = useState<ChangedEntity[]>([]);
    const [changedStudents, setChangedStudents] = useState<ChangedEntity[]>([]);
    const [error, setError] = useState<string | null>(null);

    const { isOpen, onOpen, onClose } = useDisclosure();

    const [pdfExporting, setPdfExporting] = useState(false);
    const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, name: '' });

    // Teacher PDF options
    const [includeHoursInPdf, setIncludeHoursInPdf] = useState(true);
    const [excludeEmptyHoursInPdf, setExcludeEmptyHoursInPdf] = useState(false);
    const [showEndTimeTeachers, setShowEndTimeTeachers] = useState(false);

    // Student PDF options
    const [hideTeacherNamesInPdf, setHideTeacherNamesInPdf] = useState(false);
    const [showEndTimeStudents, setShowEndTimeStudents] = useState(false);

    const refreshSession = useCallback(async () => {
        const token = localStorage.getItem('user_token');
        if (!token) {
            setSessionState({ active: false, session: null });
            setLoadingSession(false);
            return;
        }
        try {
            const data = await fetchChangeSession(token);
            setSessionState(data);
            setError(null);
        } catch (err: any) {
            console.error('Failed to load change session', err);
            setError(err?.response?.data?.error || 'Failed to load change session');
        } finally {
            setLoadingSession(false);
        }
    }, []);

    useEffect(() => {
        refreshSession();
    }, [refreshSession]);

    const loadScheduleContext = async (token: string, force = true) => {
        const [subjects, teachers, students, meetingsRes] = await Promise.all([
            loadAllSubjects(token, { force, preferCache: !force }),
            loadAllTeachers(token, { force, preferCache: !force }),
            loadAllStudents(token, { force, preferCache: !force }),
            axios.get(`${API_BASE}/meeting/all_org_meetings`, { headers: { Authorization: token } }),
        ]);
        return {
            subjects: subjects || [],
            teachers: teachers || [],
            students: students || [],
            meetings: meetingsRes.data || [],
        };
    };

    const handleStart = async () => {
        const token = localStorage.getItem('user_token');
        if (!token) return;
        setStarting(true);
        setError(null);
        try {
            const { subjects, teachers, students, meetings } = await loadScheduleContext(token, true);
            const teacherFingerprints = computeTeacherFingerprints(teachers, subjects, meetings);
            const studentFingerprints = computeStudentFingerprints(students, subjects, teachers);
            const data = await startChangeSession(token, teacherFingerprints, studentFingerprints);
            setSessionState(data);
        } catch (err: any) {
            console.error('Failed to start change session', err);
            setError(err?.response?.data?.error || err?.message || 'Failed to start change session');
        } finally {
            setStarting(false);
        }
    };

    const handleEnd = async () => {
        const token = localStorage.getItem('user_token');
        if (!token) return;
        if (!window.confirm('End this change session? You will no longer see who changed vs the snapshot.')) {
            return;
        }
        setEnding(true);
        setError(null);
        try {
            await endChangeSession(token);
            setSessionState({ active: false, session: null });
            setChangedTeachers([]);
            setChangedStudents([]);
            onClose();
        } catch (err: any) {
            console.error('Failed to end change session', err);
            setError(err?.response?.data?.error || err?.message || 'Failed to end change session');
        } finally {
            setEnding(false);
        }
    };

    const openReview = async () => {
        const token = localStorage.getItem('user_token');
        if (!token || !sessionState?.session) return;
        setReviewLoading(true);
        setError(null);
        onOpen();
        try {
            // Refresh session in case fingerprints were updated elsewhere
            const latest = await fetchChangeSession(token);
            setSessionState(latest);
            if (!latest.session) {
                setChangedTeachers([]);
                setChangedStudents([]);
                return;
            }
            const { subjects, teachers, students, meetings } = await loadScheduleContext(token, true);
            const currentTeacherFps = computeTeacherFingerprints(teachers, subjects, meetings);
            const currentStudentFps = computeStudentFingerprints(students, subjects, teachers);
            setChangedTeachers(
                diffEntityFingerprints(
                    latest.session.teacher_fingerprints,
                    teachers,
                    currentTeacherFps
                )
            );
            setChangedStudents(
                diffEntityFingerprints(
                    latest.session.student_fingerprints,
                    students,
                    currentStudentFps
                )
            );
        } catch (err: any) {
            console.error('Failed to review change session', err);
            setError(err?.response?.data?.error || err?.message || 'Failed to compute changes');
        } finally {
            setReviewLoading(false);
        }
    };

    const exportChangedTeachers = async () => {
        if (!changedTeachers.length) {
            window.alert('No teachers with schedule changes.');
            return;
        }
        const token = localStorage.getItem('user_token');
        setPdfExporting(true);
        setPdfProgress({ current: 0, total: changedTeachers.length, name: '' });
        try {
            const { subjects, meetings } = token
                ? await loadScheduleContext(token, false)
                : { subjects: [], meetings: [] as any[] };
            await exportEntitiesSchedulesToPdf({
                entities: changedTeachers.map((c) => c.entity),
                type: 'Teacher',
                subjects,
                meetings,
                includeHours: includeHoursInPdf,
                excludeEmptyHours: excludeEmptyHoursInPdf,
                showEndTime: showEndTimeTeachers,
                onProgress: setPdfProgress,
            });
        } catch (err: any) {
            console.error('PDF export failed', err);
            window.alert(err?.message || 'PDF export failed');
        } finally {
            setPdfExporting(false);
        }
    };

    const exportChangedStudents = async () => {
        if (!changedStudents.length) {
            window.alert('No students with schedule changes.');
            return;
        }
        const token = localStorage.getItem('user_token');
        setPdfExporting(true);
        setPdfProgress({ current: 0, total: changedStudents.length, name: '' });
        try {
            const { subjects, teachers } = token
                ? await loadScheduleContext(token, false)
                : { subjects: [], teachers: [] as any[] };
            await exportEntitiesSchedulesToPdf({
                entities: changedStudents.map((c) => c.entity),
                type: 'Student',
                subjects,
                teachers,
                hideTeacherNames: hideTeacherNamesInPdf,
                showEndTime: showEndTimeStudents,
                onProgress: setPdfProgress,
            });
        } catch (err: any) {
            console.error('PDF export failed', err);
            window.alert(err?.message || 'PDF export failed');
        } finally {
            setPdfExporting(false);
        }
    };

    if (loadingSession) {
        return (
            <HStack justify="center" py={1}>
                <Spinner size="sm" />
                <Text fontSize="sm" color="gray.600">Loading change session…</Text>
            </HStack>
        );
    }

    const active = !!sessionState?.active && !!sessionState?.session;
    const startedLabel = sessionState?.session?.started_at
        ? new Date(sessionState.session.started_at).toLocaleString()
        : null;

    return (
        <>
            <Box w="full" maxW="900px" mx="auto">
                {error && (
                    <Alert status="error" mb={2} borderRadius="md" py={2}>
                        <AlertIcon />
                        <AlertDescription fontSize="sm">{error}</AlertDescription>
                    </Alert>
                )}
                {!active ? (
                    <HStack justify="center" spacing={3} flexWrap="wrap">
                        <Button
                            size="sm"
                            colorScheme="teal"
                            variant="outline"
                            onClick={handleStart}
                            isLoading={starting}
                            loadingText="Snapshotting…"
                        >
                            Start change session
                        </Button>
                        <Text fontSize="xs" color="gray.500" maxW="420px">
                            Snapshot current schedules, make edits, then review who actually changed and export only those.
                        </Text>
                    </HStack>
                ) : (
                    <Alert status="info" borderRadius="md" py={2} alignItems="flex-start">
                        <AlertIcon mt={1} />
                        <HStack w="full" justify="space-between" align="center" flexWrap="wrap" spacing={3}>
                            <Box>
                                <Text fontSize="sm" fontWeight="semibold">
                                    Change session active
                                </Text>
                                {startedLabel && (
                                    <Text fontSize="xs" color="gray.600">
                                        Started {startedLabel}
                                    </Text>
                                )}
                            </Box>
                            <HStack spacing={2}>
                                <Button size="sm" colorScheme="teal" onClick={openReview}>
                                    Review changes
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    colorScheme="red"
                                    onClick={handleEnd}
                                    isLoading={ending}
                                >
                                    End session
                                </Button>
                            </HStack>
                        </HStack>
                    </Alert>
                )}
            </Box>

            <Modal isOpen={isOpen} onClose={onClose} size="xl" scrollBehavior="inside">
                <ModalOverlay />
                <ModalContent>
                    <ModalHeader>Schedule changes since snapshot</ModalHeader>
                    <ModalCloseButton />
                    <ModalBody>
                        {reviewLoading ? (
                            <CenterPy />
                        ) : (
                            <VStack align="stretch" spacing={5}>
                                <Text fontSize="sm" color="gray.600">
                                    Only people whose <strong>final schedule</strong> differs from the snapshot are listed.
                                    Edits that were undone do not count.
                                </Text>

                                <ChangedSection
                                    title="Teachers"
                                    items={changedTeachers}
                                    emphasize={focus === 'teachers'}
                                    exportMenu={
                                        <Menu closeOnSelect={false} placement="bottom-end">
                                            <MenuButton
                                                as={Button}
                                                size="sm"
                                                colorScheme="purple"
                                                rightIcon={<ChevronDownIcon />}
                                                leftIcon={<DownloadIcon />}
                                                isLoading={pdfExporting}
                                                isDisabled={!changedTeachers.length || pdfExporting}
                                            >
                                                Export PDF
                                            </MenuButton>
                                            <MenuList minW="260px" zIndex={20}>
                                                <Box px={3} py={2}>
                                                    <Text fontSize="sm" fontWeight="bold" mb={2}>
                                                        Export {changedTeachers.length} teacher
                                                        {changedTeachers.length === 1 ? '' : 's'}
                                                    </Text>
                                                    <VStack align="stretch" spacing={2}>
                                                        <Checkbox
                                                            isChecked={showEndTimeTeachers}
                                                            onChange={(e) => setShowEndTimeTeachers(e.target.checked)}
                                                            size="sm"
                                                        >
                                                            Show end time column
                                                        </Checkbox>
                                                        <Checkbox
                                                            isChecked={includeHoursInPdf}
                                                            onChange={(e) => setIncludeHoursInPdf(e.target.checked)}
                                                            size="sm"
                                                        >
                                                            Include Hours panel
                                                        </Checkbox>
                                                        <Checkbox
                                                            isChecked={excludeEmptyHoursInPdf}
                                                            onChange={(e) => setExcludeEmptyHoursInPdf(e.target.checked)}
                                                            size="sm"
                                                            isDisabled={!includeHoursInPdf}
                                                        >
                                                            Exclude empty hours
                                                        </Checkbox>
                                                    </VStack>
                                                </Box>
                                                <MenuDivider />
                                                <MenuItem
                                                    icon={<DownloadIcon />}
                                                    onClick={exportChangedTeachers}
                                                    isDisabled={!changedTeachers.length || pdfExporting}
                                                    fontWeight="bold"
                                                >
                                                    Download PDF
                                                </MenuItem>
                                            </MenuList>
                                        </Menu>
                                    }
                                />

                                <Divider />

                                <ChangedSection
                                    title="Students"
                                    items={changedStudents}
                                    emphasize={focus === 'students'}
                                    exportMenu={
                                        <Menu closeOnSelect={false} placement="bottom-end">
                                            <MenuButton
                                                as={Button}
                                                size="sm"
                                                colorScheme="purple"
                                                rightIcon={<ChevronDownIcon />}
                                                leftIcon={<DownloadIcon />}
                                                isLoading={pdfExporting}
                                                isDisabled={!changedStudents.length || pdfExporting}
                                            >
                                                Export PDF
                                            </MenuButton>
                                            <MenuList minW="260px" zIndex={20}>
                                                <Box px={3} py={2}>
                                                    <Text fontSize="sm" fontWeight="bold" mb={2}>
                                                        Export {changedStudents.length} student
                                                        {changedStudents.length === 1 ? '' : 's'}
                                                    </Text>
                                                    <VStack align="stretch" spacing={2}>
                                                        <Checkbox
                                                            isChecked={showEndTimeStudents}
                                                            onChange={(e) => setShowEndTimeStudents(e.target.checked)}
                                                            size="sm"
                                                        >
                                                            Show end time column
                                                        </Checkbox>
                                                        <Checkbox
                                                            isChecked={hideTeacherNamesInPdf}
                                                            onChange={(e) => setHideTeacherNamesInPdf(e.target.checked)}
                                                            size="sm"
                                                        >
                                                            Hide teacher names
                                                        </Checkbox>
                                                    </VStack>
                                                </Box>
                                                <MenuDivider />
                                                <MenuItem
                                                    icon={<DownloadIcon />}
                                                    onClick={exportChangedStudents}
                                                    isDisabled={!changedStudents.length || pdfExporting}
                                                    fontWeight="bold"
                                                >
                                                    Download PDF
                                                </MenuItem>
                                            </MenuList>
                                        </Menu>
                                    }
                                />

                                {pdfExporting && (
                                    <Box>
                                        <Text fontSize="sm" mb={1}>
                                            Exporting {pdfProgress.name} ({pdfProgress.current}/{pdfProgress.total})
                                        </Text>
                                        <Progress
                                            size="sm"
                                            value={
                                                pdfProgress.total
                                                    ? (pdfProgress.current / pdfProgress.total) * 100
                                                    : 0
                                            }
                                            colorScheme="purple"
                                            hasStripe
                                            isAnimated
                                        />
                                    </Box>
                                )}
                            </VStack>
                        )}
                    </ModalBody>
                    <ModalFooter>
                        <Button variant="ghost" mr={3} onClick={onClose} isDisabled={pdfExporting}>
                            Close
                        </Button>
                        <Button
                            colorScheme="red"
                            variant="outline"
                            onClick={handleEnd}
                            isLoading={ending}
                            isDisabled={pdfExporting}
                        >
                            End session
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </>
    );
};

const CenterPy = () => (
    <HStack justify="center" py={10} spacing={3}>
        <Spinner />
        <Text fontSize="sm">Comparing schedules to snapshot…</Text>
    </HStack>
);

const ChangedSection: React.FC<{
    title: string;
    items: ChangedEntity[];
    emphasize?: boolean;
    exportMenu: React.ReactNode;
}> = ({ title, items, emphasize, exportMenu }) => (
    <Box
        borderWidth={emphasize ? '2px' : '1px'}
        borderColor={emphasize ? 'teal.400' : 'gray.200'}
        borderRadius="md"
        p={3}
    >
        <HStack justify="space-between" mb={2} flexWrap="wrap" spacing={2}>
            <Text fontWeight="bold">
                {title}{' '}
                <Text as="span" fontWeight="normal" color="gray.600">
                    ({items.length} changed)
                </Text>
            </Text>
            {exportMenu}
        </HStack>
        {items.length === 0 ? (
            <Text fontSize="sm" color="gray.500">
                None — schedules match the snapshot.
            </Text>
        ) : (
            <List spacing={1} maxH="220px" overflowY="auto">
                {items.map((item) => (
                    <ListItem key={item.id} fontSize="sm">
                        <HStack justify="space-between">
                            <ChakraLink as={RouterLink} to={`/schedule/${item.id}`} color="teal.600">
                                {item.name}
                            </ChakraLink>
                            {item.reason === 'new' && (
                                <Text fontSize="xs" color="orange.500">
                                    new
                                </Text>
                            )}
                        </HStack>
                    </ListItem>
                ))}
            </List>
        )}
    </Box>
);

export default ChangeSessionPanel;
