import assert from 'node:assert/strict';
import test from 'node:test';
import { accessDOM, createAccessLifecycle } from '../src/browser-lifecycle.mjs';

test('components share a page loader and receive a fresh loader after a swap or history restoration', async () => {
	const document = new EventTarget();
	const window = new EventTarget();
	let generation = 0;
	const register = createAccessLifecycle(document, window, () => {
		const id = ++generation;
		return () => id;
	});
	const identity = [], navigation = [];
	const mountIdentity = (load, signal) => identity.push({ id: load(), signal });
	register(mountIdentity);
	register(mountIdentity);
	register((load, signal) => navigation.push({ id: load(), signal }));
	document.dispatchEvent(new Event('astro:page-load'));
	assert.deepEqual(identity.map(mount => mount.id), [1]);
	assert.deepEqual(navigation.map(mount => mount.id), [1]);

	document.dispatchEvent(new Event('astro:before-swap'));
	assert.equal(identity[0].signal.aborted, true);
	assert.equal(navigation[0].signal.aborted, true);
	document.dispatchEvent(new Event('astro:page-load'));
	assert.deepEqual(identity.map(mount => mount.id), [1, 2]);
	assert.deepEqual(navigation.map(mount => mount.id), [1, 2]);

	window.dispatchEvent(new Event('pagehide'));
	assert.equal(identity[1].signal.aborted, true);
	window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
	assert.deepEqual(identity.map(mount => mount.id), [1, 2, 3]);
	assert.deepEqual(navigation.map(mount => mount.id), [1, 2, 3]);
});

test('cleanup restores original child node identity and preserves unrelated attribute changes', () => {
	const original = { text: 'Original lesson' };
	const attributes = new Map([['href', '/original'], ['aria-label', 'Original lesson']]);
	const node = {
		childNodes: [original],
		getAttribute: name => attributes.get(name) ?? null,
		setAttribute: (name, value) => attributes.set(name, value),
		removeAttribute: name => attributes.delete(name),
		replaceChildren(...values) { this.childNodes = values; },
	};
	const controller = new AbortController();
	const dom = accessDOM(controller.signal);
	dom.attribute(node, 'href', '/summary');
	dom.attribute(node, 'aria-label', 'Enrollment required');
	dom.children(node, { text: 'Locked lesson' });
	node.setAttribute('aria-label', 'Host updated name');
	controller.abort();
	assert.equal(node.childNodes[0], original);
	assert.equal(node.getAttribute('href'), '/original');
	assert.equal(node.getAttribute('aria-label'), 'Host updated name');
});
