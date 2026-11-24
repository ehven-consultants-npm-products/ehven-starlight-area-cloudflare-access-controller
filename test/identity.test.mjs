import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { verifyAccessIdentity } from '../src/verify-identity.mjs';

const issuer = 'https://test.cloudflareaccess.com';
const audience = 'a'.repeat(64);
const now = Date.parse('2026-10-07T21:00:00Z');
const seconds = now / 1000;
const keys = await generateKeyPair('RS256');
const jwk = await exportJWK(keys.publicKey);
const keySet = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256' }] });
async function token(overrides = {}, key = keys.privateKey) {
	return new SignJWT({ type: 'app', email: 'student@example.com', sub: 'user', iss: issuer,
		aud: [audience], iat: seconds, exp: seconds + 3600, ...overrides })
		.setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
}
const request = (jwt) => new Request('https://site.example.com/course/', {
	headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {},
});

test('verified Access user token supplies identity; a supplied email header is insufficient', async () => {
	const identity = await verifyAccessIdentity(request(await token()), { teamDomain: issuer, audience }, { keySet, now });
	assert.equal(identity.email, 'student@example.com');
	await assert.rejects(verifyAccessIdentity(new Request('https://site.example.com/', {
		headers: { 'Cf-Access-Authenticated-User-Email': 'student@example.com' },
	}), { teamDomain: issuer, audience }, { keySet, now }));
});

test('wrong signature, issuer, audience, expiration, token age/type, and missing expiry are denied', async () => {
	const other = await generateKeyPair('RS256');
	const tokens = [
		await token({}, other.privateKey), await token({ iss: 'https://evil.example.com' }),
		await token({ aud: ['b'.repeat(64)] }), await token({ exp: seconds }),
		await token({ type: 'service' }), await token({ exp: undefined }),
		await token({ iat: seconds + 60 }), await token({ iat: seconds - 86401 }),
	];
	for (const jwt of tokens) await assert.rejects(verifyAccessIdentity(request(jwt), { teamDomain: issuer, audience }, { keySet, now }));
});

test('missing or untrusted configuration fails before accepting any bearer token', async () => {
	const jwt = await token();
	await assert.rejects(verifyAccessIdentity(request(jwt), { teamDomain: 'https://evil.example.com', audience }, { keySet, now }));
	await assert.rejects(verifyAccessIdentity(request(jwt), { teamDomain: issuer }, { keySet, now }));
});

async function signingFixture(kid) {
	const pair = await generateKeyPair('RS256');
	return {
		jwk: { ...await exportJWK(pair.publicKey), kid, alg: 'RS256' },
		async assertion(teamDomain) {
			return request(await new SignJWT({ type: 'app', email: 'learner@example.org' })
				.setProtectedHeader({ alg: 'RS256', kid }).setIssuer(teamDomain)
				.setAudience(audience).setSubject('learner').setIssuedAt(seconds)
				.setExpirationTime(seconds + 3600).sign(pair.privateKey));
		},
	};
}

test('remote signing keys refresh after rotation and cached keys are bounded by their freshness window', async t => {
	const teamDomain = 'https://rotation-fixture.cloudflareaccess.com';
	const before = await signingFixture('previous');
	const after = await signingFixture('current');
	const claims = { teamDomain, audience };
	const first = await before.assertion(teamDomain);
	const second = await after.assertion(teamDomain);
	let served = [before.jwk];
	t.mock.timers.enable({ apis: ['Date'], now });
	const fetchKeys = t.mock.method(globalThis, 'fetch', async (url, init) => {
		assert.equal(url, teamDomain + '/cdn-cgi/access/certs');
		assert.equal(init.redirect, 'manual');
		return Response.json({ keys: served });
	});
	const verify = assertion => verifyAccessIdentity(assertion, claims, { now: Date.now() });
	await Promise.all([verify(first), verify(first), verify(first)]);
	assert.equal(fetchKeys.mock.callCount(), 1);

	served = [after.jwk, before.jwk];
	t.mock.timers.tick(31000);
	await verify(second);
	await verify(first);
	assert.equal(fetchKeys.mock.callCount(), 2);

	served = [after.jwk];
	t.mock.timers.tick(601000);
	await verify(second);
	await assert.rejects(verify(first), { code: 'ERR_JWKS_NO_MATCHING_KEY' });
	assert.equal(fetchKeys.mock.callCount(), 3);
});

test('signing-key failure produces a protected 503 and can recover on the next request', async t => {
	const { authorizeRequest } = await import('../src/authorize.mjs');
	const teamDomain = 'https://recovery-fixture.cloudflareaccess.com';
	const fixture = await signingFixture('current');
	const assertion = await fixture.assertion(teamDomain);
	const policy = {
		teamDomain, audiences: { area: audience },
		courses: [{ id: 'area', grants: [{ email: 'learner@example.org', expiresAt: null }] }],
	};
	const outcomes = [
		() => new Response(null, { status: 503 }),
		() => { throw new DOMException('fixture timeout', 'TimeoutError'); },
		() => new Response('invalid key response'),
		() => Response.json({ keys: [fixture.jwk] }),
	];
	const fetchKeys = t.mock.method(globalThis, 'fetch', async () => outcomes.shift()());
	let observed = 0;
	for (let attempt = 0; attempt < 3; attempt++) {
		const denied = await authorizeRequest(assertion, 'area', policy, { now, onIdentity: () => { observed++; } });
		assert.equal(denied.status, 503);
		assert.equal(denied.headers.get('cache-control'), 'private, no-store');
		assert.equal(await denied.text(), 'Access temporarily unavailable.');
	}
	assert.equal(observed, 0);
	assert.equal(await authorizeRequest(assertion, 'area', policy, { now, onIdentity: () => { observed++; } }), null);
	assert.equal(observed, 1);
	assert.equal((await authorizeRequest(request(), 'area', policy, { now })).status, 403);
	assert.equal((await authorizeRequest(assertion, 'area', { ...policy, audiences: { area: 'bad' } }, { now })).status, 503);
	assert.equal(fetchKeys.mock.callCount(), 4);
});
