/** Canonical ASCII roots; no glob syntax, implicit decoding or silent repair. */
export function validateAreaRoot(path) {
  if (typeof path !== 'string' || path.length > 1024 || path === '/'
    || !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(path)
    || path.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Area roots must be explicit canonical ASCII paths without a trailing slash.');
  }
  return path;
}

/** Accept a URL pathname, rather than a full URL. Reject ambiguous encodings. */
export function normalizePathname(pathname) {
  if (typeof pathname !== 'string' || pathname.length > 8192 || !pathname.startsWith('/')
    || /%(?:2f|5c)/i.test(pathname)) throw new Error('Invalid or ambiguous pathname.');
  let path;
  try { path = decodeURIComponent(pathname); } catch { throw new Error('Invalid pathname encoding.'); }
  if (/[\\%?#\u0000-\u0020\u007f]/.test(path) || path.includes('//')
    || path.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid or ambiguous pathname.');
  return path;
}

export function pathWithinRoot(pathname, root) {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function validateIndependentRoots(areas, preview) {
  const roots = [...areas.map(area => area.path), ...(preview ? [preview.path] : [])].sort();
  for (let i = 1; i < roots.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pathWithinRoot(roots[i], roots[j])) throw new Error('Duplicate or overlapping area roots are not supported.');
    }
  }
}

export function findArea(areas, pathname) {
  const path = normalizePathname(pathname);
  return areas.find(area => pathWithinRoot(path, area.path));
}
