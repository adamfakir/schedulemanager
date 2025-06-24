let draggedSubjectId: string | null = null;
let draggedSubjectData: any | null = null;

export const setDraggedSubjectId = (id: string | null) => {
    draggedSubjectId = id;
};
export const getDraggedSubjectId = () => draggedSubjectId;

export const setDraggedSubjectData = (data: any | null) => {
    draggedSubjectData = data;
};
export const getDraggedSubjectData = () => draggedSubjectData;
let dragHover: { day: string; time: string } | null = null;
let hoverSubject: any = null;
let loadedSubjectId: string | null = null;

export const getDragHover = () => dragHover;
export const setDragHover = (val: typeof dragHover) => { dragHover = val; };

export const getHoverSubject = () => hoverSubject;
export const setHoverSubject = (val: any) => { hoverSubject = val; };

export const getLoadedSubjectId = () => loadedSubjectId;
export const setLoadedSubjectId = (val: string | null) => { loadedSubjectId = val; };