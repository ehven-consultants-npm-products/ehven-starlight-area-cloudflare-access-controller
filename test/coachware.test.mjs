import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePolicy, areaAllows, previewAllows, admissionAllows, allAreasAllow } from '../src/index.mjs';
import { compileRosters, learnerGrants, rosterAllows } from '../src/rosters.mjs';
import { scopeAllows, authorizeRequest } from '../src/authorize.mjs';
import { entitlementResponse } from '../src/entitlements.mjs';

const cutoff = Date.parse('2027-01-01T05:00:00Z');
const learner = 'learner@example.org', owner = 'owner@example.org';
function fixture() {
  const areas = Array.from({ length: 30 }, (_, i) => ({ id: `course-${i+1}`, path: `/coach/vendor/product/${i+1}`, roster: `course-${i+1}` }));
  const rosters = { shared: { includes: [], members: [{ email: owner }] }, reviewers: { includes: [], members: [{ email: owner }, { email: learner }] } };
  for (let i = 0; i < areas.length; i++) rosters[areas[i].roster] = { includes: ['shared'], members: i < 3 ? [{ email: learner, expiresAt: '2027-01-01T05:00:00Z' }] : [] };
  const configuration = { areas, preview: { id: 'course-previews', path: '/coach/preview', eligibleAreaIds: areas.map(area => area.id) }, admission: { id: 'prerelease', roster: 'reviewers' } };
  return { configuration, rosters, policy: compilePolicy(configuration, rosters) };
}

test('thirty sibling courses and the PRA root compile without weakening root-overlap rejection', () => {
  const { policy } = fixture();
  assert.equal(policy.areas.length, 30);
  assert.equal(policy.areas.filter(area => areaAllows(policy, area.id, learner, cutoff - 1)).length, 3);
  assert.equal(previewAllows(policy, learner, cutoff - 1), true);
  assert.equal(allAreasAllow(policy, learner, cutoff - 1), false);
  assert.equal(allAreasAllow(policy, owner, cutoff - 1), true);
});

test('PRA permission permits all summaries through the host adapter while granting no extra course', () => {
  const { policy } = fixture();
  for (const area of policy.areas) {
    assert.equal(scopeAllows(policy, 'course-previews', learner, cutoff - 1), true);
    assert.equal(scopeAllows(policy, area.id, learner, cutoff - 1), Number(area.id.slice(7)) <= 3);
  }
  assert.equal(scopeAllows(policy, 'course-previews', learner, cutoff), false);
  assert.equal(scopeAllows(policy, 'prerelease', learner, cutoff), true);
  assert.equal(scopeAllows(policy, 'course-previews', owner, cutoff), true);
});

test('reviewer-only admission never acquires learner or course permissions', () => {
  const { configuration, rosters } = fixture();
  rosters.reviewers.members.push({ email: 'reviewer@example.org' });
  const policy = compilePolicy(configuration, rosters);
  assert.equal(admissionAllows(policy, 'reviewer@example.org'), true);
  assert.equal(previewAllows(policy, 'reviewer@example.org'), false);
  assert.equal(areaAllows(policy, 'course-1', 'reviewer@example.org'), false);
});

test('legacy compilation preserves the exact effective-grant shapes expected by existing provisioning', () => {
  const { configuration, rosters, policy } = fixture();
  const legacy = compileRosters({ courses: configuration.areas, previewRoster: 'reviewers' }, rosters);
  assert.deepEqual(legacy, { courses: policy.areas, previewGrants: policy.admission.grants });
  for (const time of [cutoff - 1, cutoff, cutoff + 1]) {
    assert.equal(rosterAllows(learnerGrants(legacy.courses), learner, time), previewAllows(policy, learner, time));
    for (const area of policy.areas) assert.equal(scopeAllows(legacy, area.id, learner, time), areaAllows(policy, area.id, learner, time));
  }
});

test('the same identity remains allowed elsewhere when its last grant to one course is removed', () => {
  const { configuration, rosters, policy } = fixture();
  rosters['course-1'].members = [];
  const changed = compilePolicy(configuration, rosters);
  assert.equal(areaAllows(policy, 'course-1', learner, cutoff - 1), true);
  assert.equal(areaAllows(changed, 'course-1', learner, cutoff - 1), false);
  assert.equal(areaAllows(changed, 'course-2', learner, cutoff - 1), true);
  assert.equal(previewAllows(changed, learner, cutoff - 1), true);
  assert.equal(areaAllows(changed, 'course-1', owner, cutoff - 1), true);
});

test('authorization validates the exact requested audience before considering any roster grant', async () => {
  const { policy } = fixture();
  const bound = { ...policy, teamDomain: 'https://example.cloudflareaccess.com', audiences: { 'course-1': 'a'.repeat(64), 'course-previews': 'b'.repeat(64) } };
  const seen = [];
  const verify = async (_request, options) => { seen.push(options.audience); return { email: learner }; };
  const request = new Request('https://example.org/coach/vendor/product/1/');
  assert.equal(await authorizeRequest(request, 'course-1', bound, { verify, now: cutoff - 1 }), null);
  assert.equal((await authorizeRequest(request, 'course-1', bound, { verify, now: cutoff })).status, 403);
  assert.equal((await authorizeRequest(request, 'course-2', bound, { verify, now: cutoff - 1 })).status, 503);
  assert.deepEqual(seen, ['a'.repeat(64), 'a'.repeat(64)]);
});

test('entitlement snapshots preserve the authorized consumer shape without exposing rosters', async () => {
  const { policy } = fixture();
  const legacy = { courses: policy.areas };
  const response = entitlementResponse(new Request('https://example.org/access'), { policy: legacy, email: learner, now: cutoff - 1 });
  const body = await response.json();
  assert.deepEqual(body.identity, { email: learner });
  assert.equal(body.courses.filter(area => area.allowed).length, 3);
  assert.equal(JSON.stringify(body).includes(owner), false);
  assert.equal(JSON.stringify(body).includes('grants'), false);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});
