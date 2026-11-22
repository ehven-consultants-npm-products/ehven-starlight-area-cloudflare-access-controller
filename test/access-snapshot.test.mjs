import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccessSnapshotLoader } from '../src/access-snapshot.mjs';

test('concurrent identity/navigation reads share one no-store request, but later reads fetch the current identity', async () => {
	let calls = 0;
	const load = createAccessSnapshotLoader(async (endpoint, options) => {
		calls++;
		assert.equal(endpoint, '/coach/preview/_access.json');
		assert.equal(options.credentials, 'same-origin');
		assert.equal(options.cache, 'no-store');
		assert.equal(options.redirect, 'error');
		await new Promise(resolve => setImmediate(resolve));
		return Response.json({ identity: { email: `${calls}@example.org` }, courses: [] });
	});
	const [header, navigation] = await Promise.all([load('/coach/preview/_access.json'), load('/coach/preview/_access.json')]);
	assert.equal(calls, 1); assert.deepEqual(header, navigation);
	assert.equal((await load('/coach/preview/_access.json')).identity.email, '2@example.org');
	assert.equal(calls, 2);
});

test('failed identity reads do not persist; access endpoints must be same-origin paths', async () => {
	let calls = 0;
	const load = createAccessSnapshotLoader(async () => ++calls === 1 ? new Response('Denied', { status: 403 }) : Response.json({ identity: { email: 'current@example.org' }, courses: [] }));
	await assert.rejects(load('/access'), /unavailable/);
	assert.equal((await load('/access')).identity.email, 'current@example.org');
	for (const endpoint of ['//other.example/access', 'https://other.example/access', '/\\other.example/access', '/\n/other.example', '/a%2f%2fb', '/a#fragment']) await assert.rejects(load(endpoint), /same-origin/);
	assert.equal(calls, 2);
});

test('malformed navigation snapshots are rejected and do not persist', async () => {
	for (const value of [null, {}, { identity: { email: 'reader@example.org' } },
		{ identity: { email: 'reader@example.org' }, courses: [{ path: '/area', allowed: 'yes' }] },
		{ identity: { email: 'reader@example.org' }, courses: [{ path: '//other.example/area', allowed: false }] }]) {
		const load = createAccessSnapshotLoader(async () => Response.json(value));
		await assert.rejects(load('/access'));
	}
});
