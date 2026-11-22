export interface AccessSnapshot { identity: { email: string }; courses: { path: string; allowed: boolean }[]; }
export function createAccessSnapshotLoader(fetchImplementation?: typeof fetch): (endpoint: string) => Promise<AccessSnapshot>;
export const loadAccessSnapshot: (endpoint: string) => Promise<AccessSnapshot>;
