import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { normalizeEmail } from './rosters.mjs';

// Cache rotating public signing keys, never authorization decisions or identities.
const keySets = new Map();
const MAX_TEAM_KEY_SETS = 32;

export class AccessKeysUnavailableError extends Error {
	constructor() {
		super('Access signing keys are unavailable.');
		this.name = 'AccessKeysUnavailableError';
	}
}

function remoteKeys(teamDomain) {
	let keys = keySets.get(teamDomain);
	if (keys) {
		keySets.delete(teamDomain);
	} else {
		keys = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`), {
			timeoutDuration: 5000,
			cacheMaxAge: 600000,
			cooldownDuration: 30000,
		});
	}
	keySets.set(teamDomain, keys);
	if (keySets.size > MAX_TEAM_KEY_SETS) keySets.delete(keySets.keys().next().value);
	return async (header, token) => {
		try {
			return await keys(header, token);
		} catch (error) {
			if (error instanceof errors.JWKSNoMatchingKey || error instanceof errors.JWKSMultipleMatchingKeys) throw error;
			throw new AccessKeysUnavailableError();
		}
	};
}

export function validateTeamDomain(teamDomain) {
	if (typeof teamDomain !== 'string' || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain)) {
		throw new Error('A trusted Cloudflare Access team domain is required.');
	}
	return teamDomain;
}

export async function verifyAccessIdentity(request, { teamDomain, audience }, { keySet, now } = {}) {
	validateTeamDomain(teamDomain);
	if (typeof audience !== 'string' || !/^[a-f0-9]{64}$/.test(audience)) {
		throw new Error('A configured application audience is required.');
	}
	const token = request.headers.get('Cf-Access-Jwt-Assertion');
	if (!token || token.length > 32768) throw new Error('Access authentication required.');
	if (now !== undefined && !Number.isFinite(now)) throw new Error('Invalid Access verification time.');
	const { payload } = await jwtVerify(token, keySet ?? remoteKeys(teamDomain), {
		issuer: teamDomain,
		audience,
		algorithms: ['RS256'],
		requiredClaims: ['exp', 'iat', 'sub', 'email'],
		maxTokenAge: '24h',
		currentDate: now === undefined ? undefined : new Date(now),
	});
	if (payload.type !== 'app' || typeof payload.sub !== 'string' || !payload.sub) {
		throw new Error('An Access application user token is required.');
	}
	return { email: normalizeEmail(payload.email), subject: payload.sub };
}
