import { normalizeEmail, areaAllows } from './policy.mjs';

/** Call only after server-side identity and endpoint authorization. */
export function areaSnapshot(policy, email, { discovery = 'authorized', now = Date.now() } = {}) {
  if (!['authorized', 'all'].includes(discovery) || !Number.isFinite(now)) throw new Error('Invalid snapshot options.');
  const normalized = normalizeEmail(email);
  const areas = policy.areas.map(area => ({ id: area.id, path: area.path, allowed: areaAllows(policy, area.id, normalized, now) }));
  return { identity: { email: normalized }, areas: discovery === 'all' ? areas : areas.filter(area => area.allowed) };
}
