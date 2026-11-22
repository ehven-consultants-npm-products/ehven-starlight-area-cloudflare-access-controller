import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRosters, findCourse, rosterAllows } from '../src/rosters.mjs';

const catalog = {
	courses: [
		{ id: 'course-one', path: '/coach/vendor/product/1', roster: 'one' },
		{ id: 'course-two', path: '/coach/vendor/product/2', roster: 'two' },
	],
	previewRoster: 'reviewers',
};
const base = () => ({
	shared: { includes: [], members: [{ email: 'teacher@example.com' }] },
	one: { includes: ['shared'], members: [{ email: 'student@example.com', expiresAt: '2026-12-01T05:00:00Z' }] },
	two: { includes: ['shared'], members: [{ email: 'student@example.com' }] },
	reviewers: { includes: [], members: [] },
});

test('roster includes grant independent course membership and do not grant prerelease', () => {
	const policy = compileRosters(catalog, base());
	assert.equal(rosterAllows(policy.courses[0].grants, 'TEACHER@example.com'), true);
	assert.equal(rosterAllows(policy.previewGrants, 'teacher@example.com'), false);
	const deadline = Date.parse('2026-12-01T05:00:00Z');
	assert.equal(rosterAllows(policy.courses[0].grants, 'student@example.com', deadline - 1), true);
	assert.equal(rosterAllows(policy.courses[0].grants, 'student@example.com', deadline), false);
	assert.equal(rosterAllows(policy.courses[1].grants, 'student@example.com', deadline), true);
	assert.equal(rosterAllows(policy.courses[1].grants, 'student+tag@example.com', deadline), false);
});

test('removing a member affects only the course whose effective roster changed', () => {
	const rosters = base();
	rosters.one.members = [];
	const policy = compileRosters(catalog, rosters);
	assert.equal(rosterAllows(policy.courses[0].grants, 'student@example.com'), false);
	assert.equal(rosterAllows(policy.courses[1].grants, 'student@example.com'), true);
	assert.equal(rosterAllows(policy.courses[0].grants, 'teacher@example.com'), true);
});

test('duplicate grants are a union; an unexpired alternative grant still authorizes', () => {
	const rosters = base();
	rosters.shared.members.push({ email: 'student@example.com' });
	const policy = compileRosters(catalog, rosters);
	assert.equal(rosterAllows(policy.courses[0].grants, 'student@example.com', Date.parse('2027-01-01')), true);
});

test('invalid includes, cycles, schema mistakes, and impossible dates block compilation', () => {
	for (const mutate of [
		(r) => { r.one.includes = ['missing']; },
		(r) => { r.shared.includes = ['one']; },
		(r) => { r.one.includes = ['../secret']; },
		(r) => { r.one.member = []; },
		(r) => { r.one.members[0].expiresAt = '2026-02-30T00:00:00Z'; },
		(r) => { r.one.members[0].expiresAt = '2026-12-01'; },
	]) {
		const rosters = base(); mutate(rosters);
		assert.throws(() => compileRosters(catalog, rosters));
	}
});

test('numbered roots include lessons and index aliases but not similarly prefixed courses', () => {
	const courses = compileRosters(catalog, base()).courses;
	assert.equal(findCourse(courses, '/coach/vendor/product/1').id, 'course-one');
	assert.equal(findCourse(courses, '/coach/vendor/product/1/index.html').id, 'course-one');
	assert.equal(findCourse(courses, '/coach/vendor/product/10/'), undefined);
});

test('course IDs cannot collide with reviewer or learner-preview authorization scopes', () => {
 for (const id of ['prerelease', 'course-previews']) {
  const changed = { ...catalog, courses: [{ ...catalog.courses[0], id }] };
  assert.throws(() => compileRosters(changed, base()), /reserved authorization scopes/);
 }
});
