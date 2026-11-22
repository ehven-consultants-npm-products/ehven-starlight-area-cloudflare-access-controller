import { compilePolicy, areaAllows, areaSnapshot, findArea, type CompiledPolicy } from '@ehven/starlight-area-cloudflare-access-controller';
import { authorizeRequest, verifyAccessIdentity, scopeAllows } from '@ehven/starlight-area-cloudflare-access-controller/cloudflare';
import { compileRosters } from '@ehven/starlight-area-cloudflare-access-controller/rosters';
import { loadAccessSnapshot } from '@ehven/starlight-area-cloudflare-access-controller/browser';
import { entitlementResponse } from '@ehven/starlight-area-cloudflare-access-controller/entitlements';
import { courseViews } from '@ehven/starlight-area-cloudflare-access-controller/catalog';
const policy: CompiledPolicy = compilePolicy({ areas: [{ id: 'docs', path: '/docs', roster: 'docs' }] }, { docs: { includes: [], members: [{ email: 'reader@example.org' }] } });
const allowed: boolean = areaAllows(policy, 'docs', 'reader@example.org');
const snapshot = areaSnapshot(policy, 'reader@example.org', { discovery: 'all' });
const root: string | undefined = findArea(policy.areas, '/docs/start/')?.path;
void [allowed, snapshot, root];
void [authorizeRequest, verifyAccessIdentity, scopeAllows, compileRosters, loadAccessSnapshot, entitlementResponse, courseViews];
// @ts-expect-error Clock inputs are epoch milliseconds.
areaAllows(policy, 'docs', 'reader@example.org', 'tomorrow');
// @ts-expect-error Preview policies require explicit eligible areas.
compilePolicy({ areas: [], preview: { id: 'preview', path: '/preview' } }, {});
