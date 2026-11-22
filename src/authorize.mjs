import { rosterAllows, learnerGrants } from './rosters.mjs';
import { verifyAccessIdentity } from './verify-identity.mjs';
import { policyScopeAllows } from './policy.mjs';
export { verifyAccessIdentity, validateTeamDomain } from './verify-identity.mjs';

export function protectedResponse(response) {
	const headers = new Headers(response.headers);
	headers.set('Cache-Control', 'private, no-store');
	headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
	headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
	headers.delete('ETag');
	headers.delete('Last-Modified');
	const vary = new Set((headers.get('Vary') ?? '').split(',').map((item) => item.trim()).filter(Boolean));
	vary.add('Cf-Access-Jwt-Assertion');
	headers.set('Vary', [...vary].join(', '));
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function denyAccess(status = 403) {
	return protectedResponse(new Response(status === 503 ? 'Access configuration unavailable.' : 'Access denied.', { status }));
}

// Reuse enrollment decisions after a host-level identity has already been verified.
// This does not verify a token or substitute one application's audience for another.
export function scopeAllows(policy, scope, email, now = Date.now()) {
	if (policy.areas) return policyScopeAllows(policy, scope, email, now);
	const grants = scope === 'prerelease'
		? policy.previewGrants
		: scope === 'course-previews' ? learnerGrants(policy.courses)
		: policy.courses.find((course) => course.id === scope)?.grants;
	return rosterAllows(grants, email, now);
}

export async function authorizeRequest(request, scope, policy, { verify = verifyAccessIdentity, now = Date.now(), onIdentity = () => {} } = {}) {
	const audience = Object.hasOwn(policy.audiences ?? {}, scope) ? policy.audiences[scope] : undefined;
	if (!audience || !policy.teamDomain) return denyAccess(503);
	try {
		const identity = await verify(request, { teamDomain: policy.teamDomain, audience });
		if (!scopeAllows(policy, scope, identity.email, now)) return denyAccess();
		onIdentity(identity);
		return null;
	} catch {
		// Do not disclose verifier internals, email addresses, or bearer tokens.
		return denyAccess();
	}
}
