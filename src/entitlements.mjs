import { rosterAllows } from './rosters.mjs';
import { denyAccess, protectedResponse } from './authorize.mjs';
export function entitlementResponse(request, {policy,email,now=Date.now()}) {
 if(!['GET','HEAD'].includes(request.method))return denyAccess(405);
 return protectedResponse(Response.json({identity:{email},courses:policy.courses.map(course=>({path:course.path,allowed:rosterAllows(course.grants,email,now)}))}));
}
