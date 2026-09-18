import React, { createContext, useState, ReactNode } from 'react';

export type TimeBlock = {
    start: { day: string; time: string };
    end:   { day: string; time: string };
    blockid?: string;
    timeblockId?: string;
};

export type CustomBlockTemplate = {
    template_id: string;
    name: string;
    color: string;
};

export type MeetingRecord = {
    _id?: any;
    id?: string;
    name: string;
    color: string;
    teacher_ids: string[];
    teacher_names?: string[];
    timeblocks?: any[];
};

export type AvailContextType = {
    availability: TimeBlock[];
    setAvailability: (b: TimeBlock[]) => void;
    prepTimeblocks: TimeBlock[];
    setPrepTimeblocks: (b: TimeBlock[]) => void;
    customBlockTemplates: CustomBlockTemplate[];
    setCustomBlockTemplates: (b: CustomBlockTemplate[]) => void;
    customTimeblocks: any[];
    setCustomTimeblocks: (b: any[]) => void;
    meetings: MeetingRecord[];
    setMeetings: (m: MeetingRecord[]) => void;
    editing: boolean;
    setEditing: (e: boolean) => void;
    mode: 'available' | 'busy';
    setMode: (m: 'available'|'busy') => void;
};

export const AvailabilityContext = createContext<AvailContextType>({
    availability: [],
    setAvailability: () => {},
    prepTimeblocks: [],
    setPrepTimeblocks: () => {},
    customBlockTemplates: [],
    setCustomBlockTemplates: () => {},
    customTimeblocks: [],
    setCustomTimeblocks: () => {},
    meetings: [],
    setMeetings: () => {},
    editing: false,
    setEditing: () => {},
    mode: 'available',
    setMode: () => {}
});

export function AvailabilityProvider({ children }: { children: ReactNode }) {
    const [availability, setAvailability] = useState<TimeBlock[]>([]);
    const [prepTimeblocks, setPrepTimeblocks] = useState<TimeBlock[]>([]);
    const [customBlockTemplates, setCustomBlockTemplates] = useState<CustomBlockTemplate[]>([]);
    const [customTimeblocks, setCustomTimeblocks] = useState<any[]>([]);
    const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
    const [editing,    setEditing]    = useState(false);
    const [mode,       setMode]       = useState<'available'|'busy'>('available');

    return (
        <AvailabilityContext.Provider value={{
            availability, setAvailability,
            prepTimeblocks, setPrepTimeblocks,
            customBlockTemplates, setCustomBlockTemplates,
            customTimeblocks, setCustomTimeblocks,
            meetings, setMeetings,
            editing, setEditing,
            mode, setMode
        }}>
            {children}
        </AvailabilityContext.Provider>
    );
}
