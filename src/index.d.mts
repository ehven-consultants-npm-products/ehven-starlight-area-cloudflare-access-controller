export interface Grant { readonly email: string; readonly expiresAt: number | null; }
export interface Roster { includes: string[]; members: { email: string; expiresAt?: string }[]; }
export interface Area { readonly id: string; readonly path: string; readonly grants: readonly Grant[]; }
export interface AreaConfiguration {
  areas: { id: string; path: string; roster: string }[];
  preview?: { id: string; path: string; eligibleAreaIds: string[] };
  admission?: { id: string; roster: string };
}
export interface CompiledPolicy {
  readonly areas: readonly Area[];
  readonly preview?: { readonly id: string; readonly path: string; readonly eligibleAreaIds: readonly string[]; readonly grants: readonly Grant[] };
  readonly admission?: { readonly id: string; readonly grants: readonly Grant[] };
}
export const POLICY_LIMITS: Readonly<{ areas: number; rosters: number; members: number; depth: number; expandedGrants: number }>;
export function compilePolicy(configuration: AreaConfiguration, rosters: Record<string, Roster>): CompiledPolicy;
export function normalizeEmail(value: string): string;
export function rosterAllows(grants: readonly Grant[] | undefined, email: unknown, now?: number): boolean;
export function areaAllows(policy: CompiledPolicy, areaId: string, email: unknown, now?: number): boolean;
export function previewAllows(policy: CompiledPolicy, email: unknown, now?: number): boolean;
export function admissionAllows(policy: CompiledPolicy, email: unknown, now?: number): boolean;
export function allAreasAllow(policy: CompiledPolicy, email: unknown, now?: number, areaIds?: readonly string[]): boolean;
export function policyScopeAllows(policy: CompiledPolicy, scope: string, email: unknown, now?: number): boolean;
export function validateAreaRoot(path: string): string;
export function normalizePathname(pathname: string): string;
export function pathWithinRoot(pathname: string, root: string): boolean;
export function findArea(areas: readonly Area[], pathname: string): Area | undefined;
export function areaSnapshot(policy: CompiledPolicy, email: string, options?: { discovery?: 'authorized' | 'all'; now?: number }): { identity: { email: string }; areas: { id: string; path: string; allowed: boolean }[] };
