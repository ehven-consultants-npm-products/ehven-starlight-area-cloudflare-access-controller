import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePolicy, areaAllows, previewAllows, admissionAllows, allAreasAllow, policyScopeAllows, areaSnapshot, normalizeEmail, POLICY_LIMITS } from '../src/index.mjs';

const cutoff = Date.parse('2027-01-01T05:00:00Z');
const email = 'learner@example.org';
const roster = (members = [], includes = []) => ({ includes, members });
const configuration = () => ({
  areas: [{ id: 'manual', path: '/resources/manual', roster: 'manual' }, { id: 'client', path: '/clients/example', roster: 'client' }],
});
const rosters = () => ({
  shared: roster([{ email: 'owner@example.org' }]),
  manual: roster([{ email, expiresAt: '2027-01-01T05:00:00Z' }], ['shared']),
  client: roster([], ['shared']), reviewers: roster([{ email: 'reviewer@example.org' }]),
});

test('discovery is independently opt-in and cannot alter authorization or preview eligibility', () => {
  const policy = compilePolicy(configuration(), rosters());
  const own = areaSnapshot(policy, email, { now: cutoff - 1 });
  assert.deepEqual(own.areas.map(area => area.id), ['manual']);
  const all = areaSnapshot(policy, email, { discovery: 'all', now: cutoff - 1 });
  assert.equal(all.areas.length, 2);
  assert.equal(all.areas[1].allowed, false);
  assert.equal(previewAllows(policy, email, cutoff - 1), false);
  assert.equal(areaAllows(policy, 'client', email, cutoff - 1), false);
  assert.doesNotMatch(JSON.stringify(all), /grants|expiresAt|owner@example/);
  assert.throws(() => areaSnapshot(policy, email, { discovery: 'everything' }));
});

test('arbitrary independent areas preserve normalized identity and independent grants', () => {
  const policy = compilePolicy(configuration(), rosters());
  assert.equal(areaAllows(policy, 'manual', ' LEARNER@EXAMPLE.ORG ', cutoff - 1), true);
  assert.equal(areaAllows(policy, 'client', email, cutoff - 1), false);
  assert.equal(areaAllows(policy, 'manual', 'learner+tag@example.org', cutoff - 1), false);
  assert.equal(areaAllows(policy, 'unknown', email, cutoff - 1), false);
  assert.equal(previewAllows(policy, email, cutoff - 1), false);
  assert.equal(admissionAllows(policy, email, cutoff - 1), false);
});

test('preview eligibility is opt-in and derived only from explicitly selected areas', () => {
  const config = configuration();
  config.preview = { id: 'previews', path: '/previews', eligibleAreaIds: ['manual'] };
  const lists = rosters();
  lists.client.members.push({ email: 'client-only@example.org' });
  const policy = compilePolicy(config, lists);
  assert.equal(previewAllows(policy, email, cutoff - 1), true);
  assert.equal(previewAllows(policy, email, cutoff), false);
  assert.equal(previewAllows(policy, 'client-only@example.org', cutoff - 1), false);
  assert.equal(policyScopeAllows(policy, 'previews', email, cutoff - 1), true);
  assert.equal(areaAllows(policy, 'client', email, cutoff - 1), false);
});

test('host admission and enrollment remain independent without introducing a root overlap', () => {
  const config = configuration();
  config.admission = { id: 'review', roster: 'reviewers' };
  const policy = compilePolicy(config, rosters());
  assert.equal(admissionAllows(policy, 'reviewer@example.org'), true);
  assert.equal(areaAllows(policy, 'manual', 'reviewer@example.org'), false);
  assert.equal(admissionAllows(policy, email), false);
  assert.equal(policyScopeAllows(policy, 'review', 'reviewer@example.org'), true);
});

test('shared grant union preserves alternate unexpired access and per-request expiry', () => {
  const config = configuration(), lists = rosters();
  lists.shared.members.push({ email });
  const policy = compilePolicy(config, lists);
  assert.equal(areaAllows(policy, 'manual', email, cutoff), true);
  lists.shared.members = [];
  const removed = compilePolicy(config, lists);
  assert.equal(areaAllows(removed, 'manual', email, cutoff), false);
  assert.equal(areaAllows(removed, 'manual', email, cutoff - 1), true);
  assert.equal(areaAllows(policy, 'client', email, cutoff), true);
});

test('compilation detaches source membership and protects compiled state from mutation', () => {
  const config = configuration(), lists = rosters(), policy = compilePolicy(config, lists);
  lists.manual.members[0].email = 'other@example.org';
  config.areas[0].path = '/different';
  assert.equal(areaAllows(policy, 'manual', email, cutoff - 1), true);
  assert.equal(policy.areas[0].path, '/resources/manual');
  assert.throws(() => policy.areas[0].grants.push({ email, expiresAt: null }), TypeError);
});

test('shared search needs all explicitly required grants and denies empty or unknown sets', () => {
  const policy = compilePolicy(configuration(), rosters());
  assert.equal(allAreasAllow(policy, email, cutoff - 1), false);
  assert.equal(allAreasAllow(policy, 'owner@example.org', cutoff - 1), true);
  assert.equal(allAreasAllow(policy, email, cutoff - 1, ['manual']), true);
  assert.equal(allAreasAllow(policy, email, cutoff - 1, []), false);
  assert.equal(allAreasAllow(policy, 'owner@example.org', cutoff - 1, ['unknown']), false);
});

test('reject overlapping area roots, preview collisions, and duplicate or conflicting scopes', () => {
  const changes = [
    c => { c.areas[1].path = c.areas[0].path; },
    c => { c.areas[1].path = c.areas[0].path + '/management'; },
    c => { c.areas[1].path = '/resources'; },
    c => { c.areas[1].id = c.areas[0].id; },
    c => { c.preview = { id: 'previews', path: '/resources/manual/preview', eligibleAreaIds: ['manual'] }; },
    c => { c.preview = { id: 'manual', path: '/previews', eligibleAreaIds: ['manual'] }; },
    c => { c.admission = { id: 'manual', roster: 'reviewers' }; },
  ];
  for (const change of changes) { const config = configuration(); change(config); assert.throws(() => compilePolicy(config, rosters())); }
});

test('reject unknown schema keys, invalid timestamps and invalid preview references', () => {
  for (const value of [null, {}, { areas: [] }, { ...configuration(), hidden: true }]) assert.throws(() => compilePolicy(value, rosters()));
  for (const eligibleAreaIds of [[], ['missing'], ['manual', 'manual'], null]) {
    assert.throws(() => compilePolicy({ ...configuration(), preview: { id: 'preview', path: '/preview', eligibleAreaIds } }, rosters()));
  }
  for (const value of ['2027-01-01', '2027-02-30T00:00:00Z', '2027-01-01T00:00:00+00:00', null, 0]) {
    const lists = rosters(); lists.manual.members[0].expiresAt = value;
    assert.throws(() => compilePolicy(configuration(), lists));
  }
  for (const key of ['expires', 'expireAt', 'role']) {
    const lists = rosters(); lists.manual.members[0][key] = 'unexpected';
    assert.throws(() => compilePolicy(configuration(), lists));
  }
});

test('unused broken lists, missing includes and cycles fail before compilation succeeds', () => {
  for (const lists of [
    { ...rosters(), unused: roster([], ['missing']) },
    { ...rosters(), unused: roster([], ['unused']) },
    { ...rosters(), unused: { member: [] } },
  ]) assert.throws(() => compilePolicy(configuration(), lists));
});

test('include-depth bounds apply irrespective of roster insertion order or memoization', () => {
  for (const reverse of [false, true]) {
    const pairs = [];
    for (let i = 0; i <= POLICY_LIMITS.depth + 1; i++) pairs.push([`list-${i}`, roster([], i ? [`list-${i - 1}`] : [])]);
    if (reverse) pairs.reverse();
    assert.throws(() => compilePolicy({ areas: [{ id: 'area', path: '/area', roster: 'list-0' }] }, Object.fromEntries(pairs)), /depth/);
  }
});

test('area count, roster count, and total direct memberships are bounded', () => {
  assert.throws(() => compilePolicy({ areas: Array.from({ length: POLICY_LIMITS.areas + 1 }, () => configuration().areas[0]) }, rosters()));
  const lists = Object.fromEntries(Array.from({ length: POLICY_LIMITS.rosters + 1 }, (_, i) => [`r-${i}`, roster()]));
  assert.throws(() => compilePolicy(configuration(), lists), /Too many/);
  assert.throws(() => compilePolicy({ areas: [{ id: 'a', path: '/a', roster: 'a' }] }, {
    a: roster(Array.from({ length: 30000 }, () => ({ email }))), b: roster(Array.from({ length: 30000 }, () => ({ email }))),
  }), /member limit/);
});

test('include and preview fan-out are bounded before building oversized flattened arrays', () => {
  const shared = { includes: [], members: Array.from({ length: 250 }, (_, i) => ({ email: `reader-${i}@example.org` })) };
  assert.throws(() => compilePolicy({ areas: [{ id: 'a', path: '/a', roster: 'a' }] }, {
    shared, a: { members: [], includes: Array.from({ length: 1024 }, () => 'shared') },
  }), /expan|grant limit/i);
  const areas = Array.from({ length: 201 }, (_, i) => ({ id: `a-${i}`, path: `/a-${i}`, roster: 'shared' }));
  assert.throws(() => compilePolicy({ areas, preview: { id: 'preview', path: '/preview', eligibleAreaIds: areas.map(area => area.id) } }, {
    shared: { includes: [], members: Array.from({ length: 1000 }, (_, i) => ({ email: `reader-${i}@example.org` })) },
  }), /Preview grant expansion/);
});

test('malformed identities and clocks cannot authorize', () => {
  const policy = compilePolicy(configuration(), rosters());
  for (const identity of [null, 'invalid', {}, 'a@b', 'line\nfeed@example.org']) assert.equal(areaAllows(policy, 'manual', identity, cutoff - 1), false);
  for (const now of [NaN, Infinity, -Infinity, '2027']) assert.equal(areaAllows(policy, 'manual', email, now), false);
  assert.equal(normalizeEmail(' A.B+tag@EXAMPLE.ORG '), 'a.b+tag@example.org');
});
