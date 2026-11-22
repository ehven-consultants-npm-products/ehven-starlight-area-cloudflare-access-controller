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
