import { validateAreaRoot, validateIndependentRoots } from './paths.mjs';

const ID = /^[a-z0-9-]+$/;
const ROSTER_ID = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const POLICY_LIMITS = Object.freeze({ areas: 256, rosters: 1024, members: 50000, depth: 32, expandedGrants: 200000 });

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid ${label} schema.`);
}
function list(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new Error(`Invalid or oversized ${label}.`);
  return value;
}
export function normalizeEmail(value) {
  if (typeof value !== 'string' || value.length > 254 || !EMAIL.test(value.trim())) throw new Error('Invalid roster email.');
  return value.trim().toLowerCase();
}
function expiry(value) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) throw new Error('expiresAt must be an exact UTC timestamp.');
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value.replace('Z', '.000Z')) throw new Error('Invalid expiresAt calendar date.');
  return instant;
}

function rosterCompiler(rosters) {
  if (!rosters || typeof rosters !== 'object' || Array.isArray(rosters)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(rosters))) throw new Error('A roster map is required.');
  const ids = Object.keys(rosters);
  if (ids.length > POLICY_LIMITS.rosters) throw new Error('Too many rosters.');
  const cache = new Map(), heights = new Map(), visiting = new Set();
  let members = 0, expanded = 0;
  function resolve(id, depth = 0) {
    if (typeof id !== 'string' || id.length > 128 || !ROSTER_ID.test(id) || !Object.hasOwn(rosters, id)) throw new Error('Missing or invalid roster include.');
    if (visiting.has(id)) throw new Error('Roster include cycle.');
    if (depth > POLICY_LIMITS.depth) throw new Error('Roster include depth exceeded.');
    if (cache.has(id)) {
      if (depth + heights.get(id) > POLICY_LIMITS.depth) throw new Error('Roster include depth exceeded.');
      return cache.get(id);
    }
    visiting.add(id);
    const roster = rosters[id];
    object(roster, ['includes', 'members'], 'roster');
    list(roster.includes, POLICY_LIMITS.rosters, 'roster includes');
    list(roster.members, POLICY_LIMITS.members, 'roster members');
    const unique = new Map();
    function add(grant) {
      if (++expanded > POLICY_LIMITS.expandedGrants) throw new Error('Expanded roster grant limit exceeded.');
      unique.set(JSON.stringify(grant), grant);
    }
    let height = 0;
    for (const include of roster.includes) {
      for (const grant of resolve(include, depth + 1)) add(grant);
      height = Math.max(height, 1 + heights.get(include));
    }
    for (const member of roster.members) {
      if (++members > POLICY_LIMITS.members) throw new Error('Total roster member limit exceeded.');
      object(member, ['email', 'expiresAt'], 'roster member');
      add(Object.freeze({ email: normalizeEmail(member.email), expiresAt: expiry(member.expiresAt) }));
    }
    const grants = [...unique.values()].sort((a, b) => a.email < b.email ? -1 : a.email > b.email ? 1 : (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
    visiting.delete(id);
    heights.set(id, height);
    cache.set(id, Object.freeze(grants));
    return cache.get(id);
  }
  for (const id of ids) resolve(id);
  return resolve;
}

export function compilePolicy(configuration, rosters) {
  object(configuration, ['areas', 'preview', 'admission'], 'area configuration');
  const sources = list(configuration.areas, POLICY_LIMITS.areas, 'areas');
  if (!sources.length) throw new Error('At least one area is required.');
  const resolve = rosterCompiler(rosters), scopes = new Set();
  function scope(id) {
    if (typeof id !== 'string' || id.length > 128 || !ID.test(id) || scopes.has(id)) throw new Error('Scope IDs must be valid and unique.');
    scopes.add(id); return id;
  }
  const areas = sources.map(area => {
    object(area, ['id', 'path', 'roster'], 'area');
    return Object.freeze({ id: scope(area.id), path: validateAreaRoot(area.path), grants: resolve(area.roster) });
  });
  let preview, admission;
  if (configuration.preview !== undefined) {
    const source = configuration.preview;
    object(source, ['id', 'path', 'eligibleAreaIds'], 'preview');
    const eligible = list(source.eligibleAreaIds, POLICY_LIMITS.areas, 'preview eligible areas');
    if (!eligible.length || new Set(eligible).size !== eligible.length || eligible.some(id => !areas.some(area => area.id === id))) throw new Error('Preview requires distinct existing eligible area IDs.');
    const grants = new Map();
    let visits = 0;
    for (const area of areas.filter(area => eligible.includes(area.id))) {
      for (const grant of area.grants) {
        if (++visits > POLICY_LIMITS.expandedGrants) throw new Error('Preview grant expansion limit exceeded.');
        grants.set(JSON.stringify(grant), grant);
      }
    }
    preview = Object.freeze({ id: scope(source.id), path: validateAreaRoot(source.path), eligibleAreaIds: Object.freeze([...eligible]),
      grants: Object.freeze([...grants.values()]) });
  }
  if (configuration.admission !== undefined) {
    const source = configuration.admission;
    object(source, ['id', 'roster'], 'host admission');
    admission = Object.freeze({ id: scope(source.id), grants: resolve(source.roster) });
  }
  validateIndependentRoots(areas, preview);
  return Object.freeze({ areas: Object.freeze(areas), ...(preview ? { preview } : {}), ...(admission ? { admission } : {}) });
}

export function rosterAllows(grants, email, now = Date.now()) {
  if (!Array.isArray(grants) || !Number.isFinite(now)) return false;
  let normalized;
  try { normalized = normalizeEmail(email); } catch { return false; }
  return grants.some(grant => grant && grant.email === normalized
    && (grant.expiresAt === null || Number.isFinite(grant.expiresAt) && now < grant.expiresAt));
}
export function areaAllows(policy, areaId, email, now = Date.now()) {
  return rosterAllows(policy.areas.find(area => area.id === areaId)?.grants, email, now);
}
export function previewAllows(policy, email, now = Date.now()) {
  return rosterAllows(policy.preview?.grants, email, now);
}
export function admissionAllows(policy, email, now = Date.now()) {
  return rosterAllows(policy.admission?.grants, email, now);
}
export function allAreasAllow(policy, email, now = Date.now(), areaIds = policy.areas.map(area => area.id)) {
  return Array.isArray(areaIds) && areaIds.length > 0 && areaIds.every(id => areaAllows(policy, id, email, now));
}
export function policyScopeAllows(policy, scope, email, now = Date.now()) {
  if (typeof scope !== 'string') return false;
  if (policy.preview?.id === scope) return previewAllows(policy, email, now);
  if (policy.admission?.id === scope) return admissionAllows(policy, email, now);
  return areaAllows(policy, scope, email, now);
}
