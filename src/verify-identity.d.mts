import type { JWTVerifyGetKey } from 'jose';
export function validateTeamDomain(teamDomain: string): string;
export function verifyAccessIdentity(request: Request, configuration: { teamDomain: string; audience: string }, testing?: { keySet?: JWTVerifyGetKey; now?: number }): Promise<{ email: string; subject: string }>;
export class AccessKeysUnavailableError extends Error {}
