import React, { createContext, useState, ReactNode } from 'react';

export type TimeBlock = {
    start: { day: string; time: string };
    end:   { day: string; time: string };
};

export type AvailContextType = {
    availability: TimeBlock[];
    setAvailability: (b: TimeBlock[]) => void;
    editing: boolean;
    setEditing: (e: boolean) => void;
    mode: 'available' | 'busy';
    setMode: (m: 'available'|'busy') => void;
};

export const AvailabilityContext = createContext<AvailContextType>({
    availability: [],
    setAvailability: () => {},
    editing: false,
    setEditing: () => {},
    mode: 'available',
    setMode: () => {}
});

export function AvailabilityProvider({ children }: { children: ReactNode }) {
    const [availability, setAvailability] = useState<TimeBlock[]>([]);
    const [editing,    setEditing]    = useState(false);
    const [mode,       setMode]       = useState<'available'|'busy'>('available');

    return (
        <AvailabilityContext.Provider value={{
            availability, setAvailability,
            editing, setEditing,
            mode, setMode
        }}>
            {children}
        </AvailabilityContext.Provider>
    );
}