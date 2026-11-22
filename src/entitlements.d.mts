import type { LegacyPolicy } from './rosters.mjs';
export function entitlementResponse(request: Request, options: { policy: Pick<LegacyPolicy, 'courses'>; email: string; now?: number }): Response;
