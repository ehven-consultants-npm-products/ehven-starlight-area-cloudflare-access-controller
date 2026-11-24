import { createAccessSnapshotLoader } from './access-snapshot.mjs';

export function createAccessLifecycle(document, window, createLoader = createAccessSnapshotLoader) {
	const mounts = new Map();
	let load = createLoader();

	function mount(callback) {
		if (mounts.get(callback)) return;
		const controller = new AbortController();
		mounts.set(callback, controller);
		callback(load, controller.signal);
	}
	function startPage() {
		for (const callback of mounts.keys()) mount(callback);
	}
	function endPage() {
		for (const [callback, controller] of mounts) {
			mounts.set(callback, null);
			controller?.abort();
		}
		load = createLoader();
	}
	document.addEventListener('astro:before-swap', endPage);
	document.addEventListener('astro:page-load', startPage);
	window.addEventListener('pagehide', endPage);
	window.addEventListener('pageshow', event => { if (event.persisted) startPage(); });

	return callback => {
		if (mounts.has(callback)) return;
		mounts.set(callback, null);
		mount(callback);
	};
}

let register;
export function onAccessPage(callback) {
	register ??= createAccessLifecycle(document, window);
	register(callback);
}

// Restore only state this mount changed and retain the original child nodes.
export function accessDOM(signal) {
	const undo = [];
	signal.addEventListener('abort', () => {
		for (const restore of undo.reverse()) restore();
	}, { once: true });
	return {
		attribute(node, name, value) {
			const previous = node.getAttribute(name);
			const apply = next => next === null ? node.removeAttribute(name) : node.setAttribute(name, next);
			if (value === previous) return;
			apply(value);
			undo.push(() => { if (node.getAttribute(name) === value) apply(previous); });
		},
		children(node, ...children) {
			const previous = [...node.childNodes];
			node.replaceChildren(...children);
			const installed = [...node.childNodes];
			undo.push(() => {
				if (node.childNodes.length === installed.length && installed.every((child, index) => node.childNodes[index] === child)) {
					node.replaceChildren(...previous);
				}
			});
		},
	};
}
