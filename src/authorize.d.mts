import type { CompiledPolicy } from './index.mjs';
import type { LegacyPolicy } from './rosters.mjs';
export { AccessKeysUnavailableError, verifyAccessIdentity, validateTeamDomain } from './verify-identity.mjs';
export type BoundPolicy = (CompiledPolicy | LegacyPolicy) & { teamDomain: string; audiences: Record<string, string> };
export function protectedResponse(response: Response): Response;
export function denyAccess(status?: number): Response;
export function scopeAllows(policy: CompiledPolicy | LegacyPolicy, scope: string, email: unknown, now?: number): boolean;
export function authorizeRequest(request: Request, scope: string, policy: BoundPolicy, options?: { verify?: (request: Request, configuration: { teamDomain: string; audience: string }) => Promise<{ email: string; subject?: string }>; now?: number; onIdentity?: (identity: { email: string; subject?: string }) => void }): Promise<Response | null>;
