// In-memory invalidation only. Authoritative data and permissions always come from the API.
const listeners = new Set();
export const onProjectsChanged = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const notifyProjectsChanged = () => listeners.forEach((listener) => listener());
