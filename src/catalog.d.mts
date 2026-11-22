export function courseViews(courses: { id: string; path: string }[], options: { previewRoot: string }): { id: string; coursePath: string; summaryPath: string }[];
export function createAccessSnapshotResolver(options: { courses: { id: string; path: string }[]; previewRoot: string }): (pathname: string) => string | undefined;
