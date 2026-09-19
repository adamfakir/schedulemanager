/** Ensure subject timeblocks have unique blockids (duplicate ids break per-period toggles). */

export const getRawTimeblockId = (tb: any): string =>
    String(tb?.blockid || tb?.id || tb?.timeblockId || '');

export const newTimeblockId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().replace(/-/g, '');
    }
    return `tb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export type TimeblockIdRemap = { from: string; to: string };

export const ensureUniqueTimeblockIds = (
    timeblocks: any[]
): { timeblocks: any[]; changed: boolean; remaps: TimeblockIdRemap[] } => {
    const seen = new Set<string>();
    const remaps: TimeblockIdRemap[] = [];
    let changed = false;

    const next = (timeblocks || []).map((tb: any) => {
        const raw = getRawTimeblockId(tb);
        if (!raw) {
            const id = newTimeblockId();
            changed = true;
            seen.add(id);
            return { ...tb, blockid: id, timeblockId: id };
        }
        if (seen.has(raw)) {
            const id = newTimeblockId();
            changed = true;
            remaps.push({ from: raw, to: id });
            seen.add(id);
            return { ...tb, blockid: id, timeblockId: id };
        }
        seen.add(raw);
        if (!tb?.blockid && !tb?.timeblockId) {
            changed = true;
            return { ...tb, blockid: raw, timeblockId: raw };
        }
        return tb;
    });

    return { timeblocks: next, changed, remaps };
};

/** Keep teacher override lists in sync after duplicate blockids are remapped. */
export const remapOverrideTimeblockIds = (overrides: any[], remaps: TimeblockIdRemap[]): any[] => {
    if (!remaps.length) return overrides || [];
    const byFrom = new Map<string, string[]>();
    for (const r of remaps) {
        const list = byFrom.get(r.from) || [];
        list.push(r.to);
        byFrom.set(r.from, list);
    }
    return (overrides || []).map((ov: any) => {
        const extra = Array.isArray(ov?.extratimeblocks) ? ov.extratimeblocks.map(String) : [];
        if (!extra.length) return ov;
        const nextExtra = new Set(extra);
        for (const oldId of extra) {
            const news = byFrom.get(oldId);
            if (!news) continue;
            for (const n of news) nextExtra.add(n);
        }
        return { ...ov, extratimeblocks: Array.from(nextExtra) };
    });
};

export const serializeTimeblocksForApi = (timeblocks: any[]) =>
    (timeblocks || []).map((tb: any) => {
        const start = tb?.start
            ? { day: tb.start.day, time: tb.start.time }
            : { day: tb.startday, time: tb.starttime };
        const end = tb?.end
            ? { day: tb.end.day, time: tb.end.time }
            : { day: tb.endday, time: tb.endtime };
        return {
            startday: start.day,
            starttime: start.time,
            endday: end.day,
            endtime: end.time,
            blockid: getRawTimeblockId(tb) || newTimeblockId(),
        };
    });
