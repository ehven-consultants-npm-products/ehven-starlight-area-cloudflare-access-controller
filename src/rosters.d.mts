import type { Area, Grant, Roster } from './index.mjs';
export { normalizeEmail, rosterAllows } from './index.mjs';
export interface LegacyPolicy { courses: readonly Area[]; previewGrants: readonly Grant[]; }
export function compileRosters(catalog: { courses: { id: string; path: string; roster: string }[]; previewRoster: string }, rosters: Record<string, Roster>): LegacyPolicy;
export function findCourse(courses: readonly Area[], pathname: string): Area | undefined;
export function learnerGrants(courses: readonly Area[]): Grant[];
