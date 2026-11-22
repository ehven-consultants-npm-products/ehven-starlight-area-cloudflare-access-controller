/**
 * Public route views without enrollment data.
 * @param {{id:string,path:string}[]} courses
 * @param {{previewRoot:string}} options
 * @returns {{id:string,coursePath:string,summaryPath:string}[]}
 */
export function courseViews(courses,{previewRoot}) {
 return courses.map(({id,path})=>({id,coursePath:path,summaryPath:`${previewRoot}/${id}/`}));
}

// Browser hint selection; authorization remains in the Worker.
export function createAccessSnapshotResolver({courses, previewRoot}) {
 return pathname => {
  const course = courses.find(({path}) => pathname === path || pathname.startsWith(`${path}/`));
  return course ? `${course.path}/_access.json` : pathname.startsWith(`${previewRoot}/`) ? `${previewRoot}/_access.json` : undefined;
 };
}
