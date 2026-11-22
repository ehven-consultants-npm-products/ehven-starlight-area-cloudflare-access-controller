import { compilePolicy, normalizeEmail, rosterAllows } from './policy.mjs';
import { findArea } from './paths.mjs';
export { normalizeEmail, rosterAllows };

/** Compatibility facade for an existing numbered-course catalog and Worker. */
export function compileRosters(catalog, rosters) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)
    || Object.keys(catalog).some(key => !['courses', 'previewRoster'].includes(key))
    || !Array.isArray(catalog.courses)) throw new Error('Invalid course catalog schema.');
  for (const course of catalog.courses) {
    if (!course || ['prerelease', 'course-previews'].includes(course.id)) throw new Error('Course IDs cannot use reserved authorization scopes.');
    if (typeof course.path !== 'string' || !/^\/coach\/[a-z0-9-]+\/[a-z0-9-]+\/[1-9]\d*$/.test(course.path)) throw new Error('Invalid numbered course path.');
  }
  const policy = compilePolicy({ areas: catalog.courses, admission: { id: 'prerelease', roster: catalog.previewRoster } }, rosters);
  return { courses: policy.areas, previewGrants: policy.admission.grants };
}
export function findCourse(courses, pathname) { return findArea(courses, pathname); }
export function learnerGrants(courses) { return courses.flatMap(course => course.grants); }
