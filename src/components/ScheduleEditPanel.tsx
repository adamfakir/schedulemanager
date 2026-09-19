import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Box,
    Button,
    Divider,
    HStack,
    IconButton,
    Input,
    InputGroup,
    InputLeftElement,
    Switch,
    Text,
    useToast,
    VStack,
} from '@chakra-ui/react';
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from '@chakra-ui/icons';
import axios from 'axios';
import { API_BASE, loadAllSubjects, loadStudentById, loadSubjectById, loadTeacherById } from '../utils/apiClient';
import { subjectCacheGlobal, teacherCacheGlobal, studentCacheGlobal } from '../utils/globalCache';

type ScheduleEditType = 'Teacher' | 'Student' | 'Subject';

type Props = {
    type: ScheduleEditType;
    item: any;
    subjects: any[];
    onSaved?: (updated: any) => void;
};

const getEntityId = (entity: any): string =>
    String(entity?._id?.$oid || entity?._id || entity?.id || '');

const toSubjectId = (raw: any): string =>
    String(raw?.$oid || raw?.subject?.$oid || raw?.subject || raw?.id || raw || '');

const getTimeblockId = (tb: any): string =>
    String(tb?.blockid || tb?.id || tb?.timeblockId || '');

const normalizeTeacherDraft = (item: any) => ({
    ...item,
    name: item?.name || '',
    can_teach: (item?.can_teach || []).map((sid: any) => toSubjectId(sid)).filter(Boolean),
    required_teach: (item?.required_teach || []).map((sid: any) => toSubjectId(sid)).filter(Boolean),
    required_teach_overrides: (item?.required_teach_overrides || []).map((ov: any) => ({
        subject: toSubjectId(ov?.subject),
        excludeextras: ov?.excludeextras,
        extratimeblocks: Array.isArray(ov?.extratimeblocks)
            ? ov.extratimeblocks.map((id: any) => String(id))
            : [],
    })).filter((ov: any) => ov.subject),
    tags: [...(item?.tags || [])],
});

const normalizeStudentDraft = (item: any) => ({
    ...item,
    name: item?.name || '',
    required_classes: (item?.required_classes || []).map((sid: any) => toSubjectId(sid)).filter(Boolean),
    tags: [...(item?.tags || [])],
});

const normalizeSubjectDraft = (item: any) => ({
    ...item,
    name: item?.name || '',
    displayname: item?.displayname || item?.name || '',
    displayclass: item?.displayclass || '',
    color: item?.color || '#b8b8b8',
    minld: item?.minld ?? 0,
    maxld: item?.maxld ?? 0,
    minwd: item?.minwd ?? 0,
    maxwd: item?.maxwd ?? 0,
    weight: item?.weight,
    fixed: !!item?.fixed,
    tags: [...(item?.tags || [])],
});

function DurationInput({
    onChange,
    initialHours = '00',
    initialMinutes = '00',
}: {
    initialHours?: string;
    initialMinutes?: string;
    onChange: (duration: { hours: string; minutes: string }) => void;
}) {
    const hoursRef = useRef<HTMLInputElement>(null);
    const minutesRef = useRef<HTMLInputElement>(null);
    const [hours, setHours] = useState(initialHours);
    const [minutes, setMinutes] = useState(initialMinutes);

    useEffect(() => {
        setHours(initialHours);
        setMinutes(initialMinutes);
    }, [initialHours, initialMinutes]);

    return (
        <HStack spacing={0} border="1px solid #ccc" borderRadius="md" overflow="hidden" width="fit-content">
            <Input
                ref={hoursRef}
                type="text"
                placeholder="HH"
                value={hours}
                onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                    setHours(val);
                    onChange({ hours: val, minutes });
                    if (val.length === 2) minutesRef.current?.focus();
                }}
                maxLength={2}
                textAlign="center"
                width="60px"
                border="none"
                borderRight="1px solid #ccc"
                borderRadius="0"
                _focus={{ outline: 'none', boxShadow: 'none' }}
            />
            <Box px={2} fontWeight="bold" bg="gray.50">:</Box>
            <Input
                ref={minutesRef}
                type="text"
                placeholder="MM"
                value={minutes}
                onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                    setMinutes(val);
                    onChange({ hours, minutes: val });
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Backspace' && (e.currentTarget.value === '' || e.currentTarget.selectionStart === 0)) {
                        hoursRef.current?.focus();
                    }
                }}
                maxLength={2}
                textAlign="center"
                width="60px"
                border="none"
                borderLeft="1px solid #ccc"
                borderRadius="0"
                _focus={{ outline: 'none', boxShadow: 'none' }}
            />
        </HStack>
    );
}

function TagEditor({
    tags,
    availableTags,
    onChange,
}: {
    tags: string[];
    availableTags: string[];
    onChange: (next: string[]) => void;
}) {
    const [tagSearchTerm, setTagSearchTerm] = useState('');
    return (
        <HStack align="center" w="100%" spacing={4}>
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
                                if (!tags.includes(newTag)) onChange([...tags, newTag]);
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
                                        !tags.includes(tag)
                                )
                                .map((tag) => (
                                    <Box
                                        key={tag}
                                        px={3}
                                        py={2}
                                        _hover={{ bg: 'gray.100', cursor: 'pointer' }}
                                        onClick={() => {
                                            onChange([...tags, tag]);
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
            <Box flex={2}>
                <Text fontWeight="bold" fontSize={15}>Selected Tags</Text>
                <Box mt={1} maxH="120px" overflowY="auto" p={2} border="1px solid #ccc" borderRadius="md" bg="gray.50">
                    <HStack wrap="wrap" spacing={2} align="start">
                        {tags.map((tag) => (
                            <Box key={tag} px={3} py={1} bg="gray.200" borderRadius="full" display="flex" alignItems="center">
                                <Text fontSize="sm" mr={2}>{tag}</Text>
                                <IconButton
                                    icon={<CloseIcon boxSize={2.5} />}
                                    size="xs"
                                    variant="ghost"
                                    aria-label={`Remove ${tag}`}
                                    onClick={() => onChange(tags.filter((t) => t !== tag))}
                                />
                            </Box>
                        ))}
                    </HStack>
                </Box>
            </Box>
        </HStack>
    );
}

export default function ScheduleEditPanel({ type, item, subjects, onSaved }: Props) {
    const toast = useToast();
    const [draft, setDraft] = useState<any>(null);
    const [saving, setSaving] = useState(false);
    const [subjectSearch, setSubjectSearch] = useState('');
    const [subjectFilterMode, setSubjectFilterMode] = useState<'all' | 'can_teach' | 'required'>('all');
    const [expandedRequiredSubjects, setExpandedRequiredSubjects] = useState<Record<string, boolean>>({});
    const [showMoreDPN, setShowMoreDPN] = useState(false);
    const [showMoreMPL, setShowMoreMPL] = useState(false);
    const [showMoreLPW, setShowMoreLPW] = useState(false);
    const entityKey = `${type}:${getEntityId(item)}`;

    useEffect(() => {
        if (!item) {
            setDraft(null);
            return;
        }
        if (type === 'Teacher') setDraft(normalizeTeacherDraft(item));
        else if (type === 'Student') setDraft(normalizeStudentDraft(item));
        else setDraft(normalizeSubjectDraft(item));
        setSubjectSearch('');
        setSubjectFilterMode('all');
        setExpandedRequiredSubjects({});
        setShowMoreDPN(false);
        setShowMoreMPL(false);
        setShowMoreLPW(false);
    }, [entityKey]);

    const availableTags = useMemo(() => {
        const set = new Set<string>();
        (subjects || []).forEach((s: any) => (s.tags || []).forEach((t: string) => set.add(t)));
        (draft?.tags || []).forEach((t: string) => set.add(t));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [subjects, draft?.tags]);

    const allSubjects = subjects || [];

    const normalizeOverrides = (teacher: any) =>
        (teacher?.required_teach_overrides || [])
            .map((ov: any) => ({
                subject: toSubjectId(ov?.subject),
                excludeextras: ov?.excludeextras,
                extratimeblocks: Array.isArray(ov?.extratimeblocks)
                    ? ov.extratimeblocks.map((id: any) => String(id))
                    : [],
            }))
            .filter((ov: any) => ov.subject);

    const getOverrideForSubject = (teacher: any, subjectId: string) =>
        normalizeOverrides(teacher).find((ov: any) => ov.subject === subjectId) || null;

    const getSubjectTimeblockIds = (subjectId: string): string[] => {
        const subject = allSubjects.find((s: any) => getEntityId(s) === subjectId);
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
        setDraft((prev: any) => {
            const allIds = getSubjectTimeblockIds(subjectId);
            const normalizedSelected = new Set(selectedBlockIds.filter(Boolean));
            const extratimeblocks = excludeextras
                ? allIds.filter((id) => !normalizedSelected.has(id))
                : allIds.filter((id) => normalizedSelected.has(id));
            const existing = normalizeOverrides(prev);
            const next = existing.filter((ov: any) => ov.subject !== subjectId);
            next.push({ subject: subjectId, excludeextras, extratimeblocks });
            return { ...prev, required_teach_overrides: next };
        });
    };

    const handleSave = async () => {
        const token = localStorage.getItem('user_token');
        if (!token || !draft) return;
        const id = getEntityId(draft);
        if (!id) return;

        const data = { ...draft };
        delete data._id;
        delete data.type;
        delete data._originalId;
        if (data.orgid && typeof data.orgid === 'object') delete data.orgid;

        setSaving(true);
        try {
            if (type === 'Teacher') {
                await axios.put(`${API_BASE}/teacher/${id}/update`, data, {
                    headers: { Authorization: token },
                });
                const refreshed = await loadTeacherById(token, id);
                if (teacherCacheGlobal.current) {
                    teacherCacheGlobal.current = teacherCacheGlobal.current.map((t: any) =>
                        getEntityId(t) === id ? refreshed : t
                    );
                }
                onSaved?.(refreshed);
            } else if (type === 'Student') {
                await axios.put(`${API_BASE}/student/${id}/update`, data, {
                    headers: { Authorization: token },
                });
                const refreshed = await loadStudentById(token, id);
                if (studentCacheGlobal.current) {
                    studentCacheGlobal.current = studentCacheGlobal.current.map((s: any) =>
                        getEntityId(s) === id ? refreshed : s
                    );
                }
                onSaved?.(refreshed);
            } else {
                await axios.put(`${API_BASE}/subject/${id}/update`, data, {
                    headers: { Authorization: token },
                });
                const refreshed = await loadSubjectById(token, id);
                if (subjectCacheGlobal.current) {
                    subjectCacheGlobal.current = subjectCacheGlobal.current.map((s: any) =>
                        getEntityId(s) === id ? refreshed : s
                    );
                }
                await loadAllSubjects(token, { preferCache: false });
                onSaved?.(refreshed);
            }
            window.dispatchEvent(new CustomEvent('scheduleEntityUpdated', { detail: { type, id } }));
            toast({ title: 'Saved', status: 'success', duration: 2000, isClosable: true });
        } catch (err) {
            console.error('Schedule edit save failed', err);
            toast({ title: 'Save failed', status: 'error', duration: 3000, isClosable: true });
        } finally {
            setSaving(false);
        }
    };

    if (!draft) {
        return <Text fontSize="sm" color="gray.600">Loading…</Text>;
    }

    if (type === 'Student') {
        return (
            <VStack align="stretch" spacing={4}>
                <Text fontWeight="bold" fontSize="md">Edit Student</Text>
                <Input
                    placeholder="Student Name"
                    value={draft.name || ''}
                    onChange={(e) => setDraft((prev: any) => ({ ...prev, name: e.target.value }))}
                />
                <Divider />
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
                        <Button size="xs" variant={subjectFilterMode === 'all' ? 'solid' : 'ghost'} onClick={() => setSubjectFilterMode('all')}>All</Button>
                        <Button size="xs" variant={subjectFilterMode === 'required' ? 'solid' : 'ghost'} onClick={() => setSubjectFilterMode('required')}>Required</Button>
                    </HStack>
                    <Box maxH="220px" overflowY="auto" border="1px solid #ccc" borderRadius="md" p={2} bg="gray.50">
                        <VStack align="stretch" spacing={2}>
                            {allSubjects
                                .filter((subject) => {
                                    const id = getEntityId(subject);
                                    const matchesSearch =
                                        String(subject.name || '').toLowerCase().includes(subjectSearch.toLowerCase()) ||
                                        (subject.tags || []).some((tag: string) =>
                                            tag.toLowerCase().includes(subjectSearch.toLowerCase())
                                        );
                                    const isRequired = draft.required_classes?.includes(id);
                                    if (subjectFilterMode === 'required' && !isRequired) return false;
                                    return matchesSearch;
                                })
                                .map((subject) => {
                                    const id = getEntityId(subject);
                                    const isRequired = draft.required_classes?.includes(id);
                                    return (
                                        <HStack key={id} spacing={3} align="center">
                                            <Box w={3} h={3} borderRadius="full" bg={subject.color || 'gray.300'} />
                                            <Text flex={1} fontSize="sm">{subject.name}</Text>
                                            <Switch
                                                size="sm"
                                                colorScheme="red"
                                                isChecked={isRequired}
                                                onChange={(e) => {
                                                    setDraft((prev: any) => {
                                                        const list = new Set(prev.required_classes || []);
                                                        if (e.target.checked) list.add(id);
                                                        else list.delete(id);
                                                        return { ...prev, required_classes: Array.from(list) };
                                                    });
                                                }}
                                            />
                                        </HStack>
                                    );
                                })}
                        </VStack>
                    </Box>
                </Box>
                <Divider />
                <TagEditor
                    tags={draft.tags || []}
                    availableTags={availableTags}
                    onChange={(tags) => setDraft((prev: any) => ({ ...prev, tags }))}
                />
                <Button colorScheme="blue" onClick={handleSave} isLoading={saving}>
                    Save
                </Button>
            </VStack>
        );
    }

    if (type === 'Teacher') {
        return (
            <VStack align="stretch" spacing={4}>
                <Text fontWeight="bold" fontSize="md">Edit Teacher</Text>
                <Input
                    placeholder="Teacher Name"
                    value={draft.name || ''}
                    onChange={(e) => setDraft((prev: any) => ({ ...prev, name: e.target.value }))}
                />
                <Divider />
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
                        <Button size="xs" variant={subjectFilterMode === 'all' ? 'solid' : 'ghost'} onClick={() => setSubjectFilterMode('all')}>All</Button>
                        <Button size="xs" variant={subjectFilterMode === 'can_teach' ? 'solid' : 'ghost'} onClick={() => setSubjectFilterMode('can_teach')}>Can Teach</Button>
                        <Button size="xs" variant={subjectFilterMode === 'required' ? 'solid' : 'ghost'} onClick={() => setSubjectFilterMode('required')}>Required</Button>
                    </HStack>
                    <HStack spacing={1} justify="end">
                        <Text fontWeight="normal" fontSize={9}>Can Teach</Text>
                        <Divider orientation="vertical" />
                        <Text fontWeight="normal" fontSize={9}>Required</Text>
                    </HStack>
                    <Box maxH="220px" overflowY="auto" border="1px solid #ccc" borderRadius="md" p={2} bg="gray.50">
                        <VStack align="stretch" spacing={2}>
                            {allSubjects
                                .filter((subject) => {
                                    const id = getEntityId(subject);
                                    const matchesSearch =
                                        String(subject.name || '').toLowerCase().includes(subjectSearch.toLowerCase()) ||
                                        (subject.tags || []).some((tag: string) =>
                                            tag.toLowerCase().includes(subjectSearch.toLowerCase())
                                        );
                                    const isSelected = draft.can_teach?.includes(id);
                                    const isRequired = draft.required_teach?.includes(id);
                                    if (subjectFilterMode === 'can_teach' && !isSelected) return false;
                                    if (subjectFilterMode === 'required' && !isRequired) return false;
                                    return matchesSearch;
                                })
                                .map((subject) => {
                                    const id = getEntityId(subject);
                                    const isSelected = draft.can_teach?.includes(id);
                                    const isRequired = draft.required_teach?.includes(id);
                                    const override = getOverrideForSubject(draft, id);
                                    const excludeMode = override ? !!override.excludeextras : true;
                                    const timeblocks = subject.timeblocks || [];
                                    const isExpanded = !!expandedRequiredSubjects[id];
                                    return (
                                        <Box key={id} borderWidth="1px" borderColor="gray.200" borderRadius="md" p={2} bg="white">
                                            <HStack spacing={3} align="center">
                                                <Box w={3} h={3} borderRadius="full" bg={subject.color || 'gray.300'} />
                                                <Text flex={1} fontSize="sm">{subject.name}</Text>
                                                <Switch
                                                    size="sm"
                                                    colorScheme="green"
                                                    isChecked={isSelected}
                                                    onChange={(e) => {
                                                        setDraft((prev: any) => {
                                                            const updated = { ...prev };
                                                            const list = new Set(updated.can_teach || []);
                                                            if (e.target.checked) list.add(id);
                                                            else {
                                                                list.delete(id);
                                                                updated.required_teach = (updated.required_teach || []).filter((rid: string) => rid !== id);
                                                                updated.required_teach_overrides = normalizeOverrides(updated).filter((ov: any) => ov.subject !== id);
                                                            }
                                                            updated.can_teach = Array.from(list);
                                                            return updated;
                                                        });
                                                    }}
                                                />
                                                <Switch
                                                    size="sm"
                                                    colorScheme={excludeMode ? 'green' : 'yellow'}
                                                    isChecked={isRequired}
                                                    onChange={(e) => {
                                                        const checked = e.target.checked;
                                                        setDraft((prev: any) => {
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
                                                        onClick={() =>
                                                            setExpandedRequiredSubjects((prevOpen) => ({
                                                                ...prevOpen,
                                                                [id]: !prevOpen[id],
                                                            }))
                                                        }
                                                    />
                                                )}
                                            </HStack>
                                            {isRequired && timeblocks.length > 0 && isExpanded && (
                                                <Box mt={2} p={2} borderWidth="1px" borderColor="gray.100" borderRadius="md" bg="gray.50">
                                                    <HStack justify="space-between" mb={2}>
                                                        <Text fontSize="xs" fontWeight="bold">Main Teacher Mode</Text>
                                                        <Switch
                                                            size="sm"
                                                            colorScheme={excludeMode ? 'green' : 'yellow'}
                                                            isChecked={excludeMode}
                                                            onChange={(e) => {
                                                                const allIds = getSubjectTimeblockIds(id);
                                                                const selected = allIds.filter((tbId) => isTimeblockSelected(draft, id, tbId));
                                                                setSubjectOverride(id, e.target.checked, selected);
                                                            }}
                                                        />
                                                    </HStack>
                                                    <Text fontSize="2xs" color="gray.600" mb={2}>
                                                        Green = include-all-except-unchecked. Yellow = include-only-checked.
                                                    </Text>
                                                    <VStack align="stretch" spacing={1} maxH="120px" overflowY="auto">
                                                        {timeblocks.map((tb: any, idx: number) => {
                                                            const blockId = getTimeblockId(tb);
                                                            if (!blockId) return null;
                                                            const selected = isTimeblockSelected(draft, id, blockId);
                                                            return (
                                                                <Switch
                                                                    key={`${id}-tb-${blockId}-${idx}`}
                                                                    size="sm"
                                                                    colorScheme={excludeMode ? 'green' : 'yellow'}
                                                                    isChecked={selected}
                                                                    onChange={(e) => {
                                                                        const allIds = getSubjectTimeblockIds(id);
                                                                        const selectedSet = new Set(
                                                                            allIds.filter((tbId) => isTimeblockSelected(draft, id, tbId))
                                                                        );
                                                                        if (e.target.checked) selectedSet.add(blockId);
                                                                        else selectedSet.delete(blockId);
                                                                        const currentOverride = getOverrideForSubject(draft, id);
                                                                        const excludeModeNow = currentOverride ? !!currentOverride.excludeextras : true;
                                                                        setSubjectOverride(id, excludeModeNow, Array.from(selectedSet));
                                                                    }}
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
                <Divider />
                <TagEditor
                    tags={draft.tags || []}
                    availableTags={availableTags}
                    onChange={(tags) => setDraft((prev: any) => ({ ...prev, tags }))}
                />
                <Text fontWeight="bold" fontSize={14}>*Availability times can be put on their schedule*</Text>
                <Button colorScheme="blue" onClick={handleSave} isLoading={saving}>
                    Save
                </Button>
            </VStack>
        );
    }

    // Subject
    const avgLd = ((draft.minld ?? 0) + (draft.maxld ?? 0)) / 2;
    const hh = String(Math.floor(avgLd / 60) || 0).padStart(2, '0');
    const mm = String(Math.round(avgLd % 60) || 0).padStart(2, '0');

    return (
        <VStack align="stretch" spacing={4}>
            <Text fontWeight="bold" fontSize="md">Edit Subject</Text>
            <InputGroup>
                <InputLeftElement pointerEvents="auto">
                    <Input
                        type="color"
                        value={draft.color || '#b8b8b8'}
                        onChange={(e) => setDraft((prev: any) => ({ ...prev, color: e.target.value }))}
                        w="90%"
                        h="100%"
                        border="none"
                        p="0"
                        bg="transparent"
                        cursor="pointer"
                        _focus={{ boxShadow: 'none' }}
                    />
                </InputLeftElement>
                <Input
                    pl="40px"
                    placeholder="Subject Name"
                    value={draft.name || ''}
                    onChange={(e) => setDraft((prev: any) => ({ ...prev, name: e.target.value }))}
                />
            </InputGroup>
            <IconButton
                aria-label="Expand display fields"
                icon={showMoreDPN ? <ChevronUpIcon /> : <ChevronDownIcon />}
                size="sm"
                variant="ghost"
                alignSelf="start"
                onClick={() => setShowMoreDPN(!showMoreDPN)}
            />
            {showMoreDPN && (
                <HStack spacing={3}>
                    <VStack spacing={0} align="stretch" flex={1}>
                        <Text fontWeight="bold" fontSize={10}>Display Name</Text>
                        <Input
                            value={draft.displayname || draft.name || ''}
                            onChange={(e) => setDraft((prev: any) => ({ ...prev, displayname: e.target.value }))}
                        />
                    </VStack>
                    <VStack spacing={0} align="stretch" flex={1}>
                        <Text fontWeight="bold" fontSize={10}>Display Class</Text>
                        <Input
                            value={draft.displayclass || ''}
                            onChange={(e) => setDraft((prev: any) => ({ ...prev, displayclass: e.target.value }))}
                        />
                    </VStack>
                </HStack>
            )}
            <Divider />
            <HStack justify="space-between" align="top" w="100%">
                <VStack spacing={1} align="center" w="50%">
                    <Text fontWeight="bold" fontSize={14}>Lesson Duration</Text>
                    <DurationInput
                        initialHours={hh}
                        initialMinutes={mm}
                        onChange={({ hours, minutes }) => {
                            const total = (parseInt(hours || '0', 10) * 60) + parseInt(minutes || '0', 10);
                            setDraft((prev: any) => ({ ...prev, minld: total, maxld: total }));
                        }}
                    />
                    <IconButton
                        aria-label="Expand duration"
                        icon={showMoreMPL ? <ChevronUpIcon /> : <ChevronDownIcon />}
                        size="xs"
                        variant="ghost"
                        onClick={() => setShowMoreMPL(!showMoreMPL)}
                    />
                    {showMoreMPL && (
                        <HStack>
                            <Input
                                size="sm"
                                type="number"
                                placeholder="min"
                                value={draft.minld ?? ''}
                                onChange={(e) => setDraft((prev: any) => ({ ...prev, minld: parseInt(e.target.value || '0', 10) }))}
                            />
                            <Input
                                size="sm"
                                type="number"
                                placeholder="max"
                                value={draft.maxld ?? ''}
                                onChange={(e) => setDraft((prev: any) => ({ ...prev, maxld: parseInt(e.target.value || '0', 10) }))}
                            />
                        </HStack>
                    )}
                </VStack>
                <VStack spacing={1} align="center" w="50%">
                    <Text fontWeight="bold" fontSize={14}>Lessons / Week</Text>
                    <Input
                        size="sm"
                        type="number"
                        value={
                            draft.minwd != null && draft.maxwd != null && draft.minld
                                ? Math.round(((draft.minwd + draft.maxwd) / 2) / Math.max(1, Math.round((draft.minld + draft.maxld) / 2)))
                                : ''
                        }
                        onChange={(e) => {
                            const n = parseInt(e.target.value || '0', 10);
                            setDraft((prev: any) => ({
                                ...prev,
                                maxwd: n * (prev?.maxld || 0),
                                minwd: n * (prev?.minld || 0),
                            }));
                        }}
                    />
                    <IconButton
                        aria-label="Expand LPW"
                        icon={showMoreLPW ? <ChevronUpIcon /> : <ChevronDownIcon />}
                        size="xs"
                        variant="ghost"
                        onClick={() => setShowMoreLPW(!showMoreLPW)}
                    />
                    {showMoreLPW && (
                        <HStack>
                            <Input
                                size="sm"
                                type="number"
                                placeholder="min wd"
                                value={draft.minwd ?? '0'}
                                onChange={(e) => setDraft((prev: any) => ({ ...prev, minwd: parseInt(e.target.value || '0', 10) }))}
                            />
                            <Input
                                size="sm"
                                type="number"
                                placeholder="max wd"
                                value={draft.maxwd ?? '0'}
                                onChange={(e) => setDraft((prev: any) => ({ ...prev, maxwd: parseInt(e.target.value || '0', 10) }))}
                            />
                        </HStack>
                    )}
                </VStack>
            </HStack>
            <Divider />
            <HStack>
                <Text fontWeight="bold" fontSize={14} minW="70px">Weight</Text>
                <Input
                    size="sm"
                    type="number"
                    value={draft.weight === undefined ? '' : draft.weight}
                    onChange={(e) =>
                        setDraft((prev: any) => ({
                            ...prev,
                            weight: e.target.value === '' ? undefined : parseFloat(e.target.value),
                        }))
                    }
                />
            </HStack>
            <HStack justify="space-between" w="100%">
                <Text fontWeight="bold" fontSize={17}>Fixed</Text>
                <Switch
                    colorScheme="green"
                    isChecked={!!draft.fixed}
                    onChange={(e) => setDraft((prev: any) => ({ ...prev, fixed: e.target.checked }))}
                />
            </HStack>
            <Divider />
            <TagEditor
                tags={draft.tags || []}
                availableTags={availableTags}
                onChange={(tags) => setDraft((prev: any) => ({ ...prev, tags }))}
            />
            <Button colorScheme="blue" onClick={handleSave} isLoading={saving}>
                Save
            </Button>
        </VStack>
    );
}
