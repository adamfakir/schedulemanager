import axios from 'axios';
import { subjectCacheGlobal, teacherCacheGlobal, studentCacheGlobal } from './globalCache';

export const API_BASE = 'https://schedulebackendapi-3an8u.ondigitalocean.app';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const MIN_NETWORK_REFETCH_GAP_MS = 10 * 1000;

const inFlightRequests = new Map<string, Promise<any>>();
const lastNetworkFetchMs = new Map<string, number>();

const isNotFound = (err: any): boolean =>
    !!(axios.isAxiosError(err) && err.response?.status === 404);

const withDedupe = async <T>(key: string, fetcher: () => Promise<T>): Promise<T> => {
    const existing = inFlightRequests.get(key);
    if (existing) return existing as Promise<T>;

    const pending = fetcher().finally(() => {
        inFlightRequests.delete(key);
    });

    inFlightRequests.set(key, pending);
    return pending;
};

const shouldUseRecentNetworkResult = (key: string): boolean => {
    const lastFetch = lastNetworkFetchMs.get(key);
    if (!lastFetch) return false;
    return Date.now() - lastFetch < MIN_NETWORK_REFETCH_GAP_MS;
};

export const getCache = <T = any>(key: string, ttlMs: number = DEFAULT_TTL_MS): T | null => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const { data, ts } = parsed;
        if (typeof ts !== 'number') return null;
        if (Date.now() - ts > ttlMs) return null;
        return data as T;
    } catch {
        return null;
    }
};

export const setCache = <T = any>(key: string, data: T): void => {
    localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() }));
};

const authedGet = async <T>(path: string, token: string, withCredentials = false): Promise<T> => {
    const res = await axios.get(`${API_BASE}${path}`, {
        headers: { Authorization: token },
        withCredentials,
    });
    return res.data as T;
};

const readSubjectsCache = (): any[] | null => {
    const cached = subjectCacheGlobal.current || getCache<any[]>('subjectCacheGlobal');
    if (cached) subjectCacheGlobal.current = cached;
    return cached || null;
};

const readTeachersCache = (): any[] | null => {
    const cached = teacherCacheGlobal.current || getCache<any[]>('teacherCacheGlobal');
    if (cached) teacherCacheGlobal.current = cached;
    return cached || null;
};

const readStudentsCache = (): any[] | null => {
    const cached = studentCacheGlobal.current || getCache<any[]>('studentCacheGlobal');
    if (cached) studentCacheGlobal.current = cached;
    return cached || null;
};

export const getSubjectsFromCache = readSubjectsCache;
export const getTeachersFromCache = readTeachersCache;
export const getStudentsFromCache = readStudentsCache;

export const loadAllSubjects = async (
    token: string,
    opts: { force?: boolean; preferCache?: boolean } = {}
): Promise<any[]> => {
    const { force = false, preferCache = true } = opts;
    const cached = !force ? readSubjectsCache() : null;
    if (cached && preferCache) return cached;
    if (cached && !force && shouldUseRecentNetworkResult('subject/all_org_subjects')) return cached;

    return withDedupe<any[]>('subject/all_org_subjects', async () => {
        const data = await authedGet<any[]>('/subject/all_org_subjects', token);
        subjectCacheGlobal.current = data || [];
        setCache('subjectCacheGlobal', subjectCacheGlobal.current);
        lastNetworkFetchMs.set('subject/all_org_subjects', Date.now());
        return subjectCacheGlobal.current;
    });
};

export const loadAllTeachers = async (
    token: string,
    opts: { force?: boolean; preferCache?: boolean } = {}
): Promise<any[]> => {
    const { force = false, preferCache = true } = opts;
    const cached = !force ? readTeachersCache() : null;
    if (cached && preferCache) return cached;
    if (cached && !force && shouldUseRecentNetworkResult('teacher/all_org_teachers')) return cached;

    return withDedupe<any[]>('teacher/all_org_teachers', async () => {
        const data = await authedGet<any[]>('/teacher/all_org_teachers', token);
        teacherCacheGlobal.current = data || [];
        setCache('teacherCacheGlobal', teacherCacheGlobal.current);
        lastNetworkFetchMs.set('teacher/all_org_teachers', Date.now());
        return teacherCacheGlobal.current;
    });
};

export const loadAllStudents = async (
    token: string,
    opts: { force?: boolean; preferCache?: boolean } = {}
): Promise<any[]> => {
    const { force = false, preferCache = true } = opts;
    const cached = !force ? readStudentsCache() : null;
    if (cached && preferCache) return cached;
    if (cached && !force && shouldUseRecentNetworkResult('student/all_org_students')) return cached;

    return withDedupe<any[]>('student/all_org_students', async () => {
        const data = await authedGet<any[]>('/student/all_org_students', token);
        studentCacheGlobal.current = data || [];
        setCache('studentCacheGlobal', studentCacheGlobal.current);
        lastNetworkFetchMs.set('student/all_org_students', Date.now());
        return studentCacheGlobal.current;
    });
};

export const loadUserSelf = async (token: string): Promise<any> => {
    return withDedupe<any>('user/get_self', () => authedGet('/user/get_self', token, true));
};

export const loadStudentById = async (
    token: string,
    id: string,
    opts: { allow404?: boolean } = {}
): Promise<any | null> => {
    const { allow404 = false } = opts;
    try {
        return await withDedupe<any>(`student/${id}`, () => authedGet(`/student/${id}`, token));
    } catch (err) {
        if (allow404 && isNotFound(err)) return null;
        throw err;
    }
};

export const loadTeacherById = async (
    token: string,
    id: string,
    opts: { allow404?: boolean } = {}
): Promise<any | null> => {
    const { allow404 = false } = opts;
    try {
        return await withDedupe<any>(`teacher/${id}`, () => authedGet(`/teacher/${id}`, token));
    } catch (err) {
        if (allow404 && isNotFound(err)) return null;
        throw err;
    }
};

export const loadSubjectById = async (
    token: string,
    id: string,
    opts: { allow404?: boolean } = {}
): Promise<any | null> => {
    const { allow404 = false } = opts;
    try {
        return await withDedupe<any>(`subject/${id}`, () => authedGet(`/subject/${id}`, token));
    } catch (err) {
        if (allow404 && isNotFound(err)) return null;
        throw err;
    }
};
