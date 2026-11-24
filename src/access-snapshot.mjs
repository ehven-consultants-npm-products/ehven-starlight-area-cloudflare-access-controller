import { normalizePathname, validateAreaRoot } from './paths.mjs';
// Share only concurrent requests. Never persist an identity or authorization result.
export function createAccessSnapshotLoader(fetchImpl = (...args) => fetch(...args)) {
	const pending = new Map();
	return async function loadAccessSnapshot(endpoint) {
		try { normalizePathname(endpoint); } catch { throw new Error('A same-origin access endpoint is required.'); }
		if (pending.has(endpoint)) return pending.get(endpoint);
		const request = (async () => {
			const response = await fetchImpl(endpoint, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000) });
			if (!response.ok) throw new Error('Access information unavailable.');
			const value = await response.json();
			if (!value || typeof value.identity?.email !== 'string' || value.identity.email.length > 254
				|| !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.identity.email) || !Array.isArray(value.courses) || value.courses.length > 256
				|| value.courses.some(course => !course || typeof course.allowed !== 'boolean')) throw new Error('Access information unavailable.');
			const roots = new Set();
			for (const course of value.courses) {
				if (roots.has(validateAreaRoot(course.path))) throw new Error('Access information unavailable.');
				roots.add(course.path);
			}
			return value;
		})();
		pending.set(endpoint, request);
		try { return await request; }
		finally { pending.delete(endpoint); }
	};
}

export const loadAccessSnapshot = createAccessSnapshotLoader();
