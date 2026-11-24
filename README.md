# Starlight Area Cloudflare Access Controller

Independent roster authorization for protected documentation or training areas,
with Cloudflare Access verification and optional Starlight components. MIT licensed.

This is unreleased development source. The package is marked private while release
acceptance is completed. A registry installation is not available from this repository yet.

## Boundaries

- An area is an explicit URL root and its descendants. Shared ancestors and shared
  rosters are allowed; duplicate roots and parent/child area roots are rejected.
- Membership, optional preview eligibility, discovery, and host admission are
  separate decisions. Enabling discovery grants no content permission.
- Every protected request must be authorized before reading assets or invoking a
  protected handler. Sidebar locks and hidden links are informational.
- Removing an identity takes effect after the changed policy is deployed. An expiry
  already in the deployed policy is checked at the next request without redeployment.
- This controls future requests, including downloads. It cannot recall copies or
  erase content already displayed, printed or downloaded.
- Authentication, deployed Access applications, provider credentials, host routing,
  private configuration and infrastructure state remain application-owned.

## Entry points

| Import | Responsibility |
|---|---|
| Package root | Dependency-free area-policy compilation, membership, path checks and snapshots |
| `/cloudflare` | JWT verification, request authorization and protected responses; uses `jose` |
| `/rosters` | Compatibility API for numbered course catalogs and existing Worker composition |
| `/browser` | Concurrent-only same-origin access-snapshot loading |
| `/catalog` | Course navigation URL helpers without identity or grant data |
| `/entitlements` | Compatibility response for an already authorized course endpoint |
| `/astro/AccessIdentity.astro` | Verified identity presentation |
| `/astro/CourseNavigation.astro` | Course sidebar hints and shared-search UI restrictions |

ESM is the supported module format. The package declares `jose` as its runtime
dependency; importing the pure policy or browser entry does not import JWT code.
Astro/Starlight are consumer-owned host dependencies and are needed only for the
Astro components. The maintained integration fixture targets Astro 7.4.13 and
Starlight 0.41.11; an earlier functional build also passed on Astro 7.3.8.
Use a patched host: Astro 7.3.8 has advisories GHSA-mh32-jxcr-mh9f and
GHSA-r3h5-4585-7x3w. The components use static tags, and this fixture has no Node
image adapter, but this does not assess unrelated consumer code. The permissive
peer range describes functional compatibility, not a blanket security approval
of every older host version. Browser interaction, alternate host versions and deployed
Cloudflare acceptance remain pending; a build is not evidence of those behaviors.

The pure API and JWT tests support Node 22.14.0 and later. The maintained Astro
7.4.13 build fixture requires Node 22.23.4 or later; its higher requirement belongs
to the optional host toolchain. CI checks the core on 22.14.0 and runs the full
Starlight fixture on 22.23.4 and 24.22.3. Use that newer Node baseline when building
the optional components; `npm run check` includes the Astro build.

## Minimal policy

Install a supplied development tarball in a separate project:

```sh
npm install /absolute/path/to/ehven-starlight-area-cloudflare-access-controller-0.1.0-dev.0.tgz
```

Keep private source configuration in the consuming project's
`config/packages/npm/starlight-area-cloudflare-access-controller/`. Import it explicitly
on the server; the package does not scan directories or execute config files.
Do not edit installed package files.

```js
import { compilePolicy, areaAllows } from '@ehven/starlight-area-cloudflare-access-controller';

const policy = compilePolicy({
  areas: [
    { id: 'handbook', path: '/handbook', roster: 'handbook' },
    { id: 'client', path: '/clients/example', roster: 'client' },
  ],
}, {
  handbook: { includes: [], members: [{ email: 'reader@example.org', expiresAt: '2027-01-01T05:00:00Z' }] },
  client: { includes: [], members: [] },
});

console.log(areaAllows(policy, 'handbook', 'reader@example.org', Date.parse('2026-12-01T00:00:00Z'))); // true
console.log(areaAllows(policy, 'client', 'reader@example.org')); // false
```

This demonstrates policy evaluation. A server may use the supplied email only
after verifying identity; a visitor-submitted email is not proof of identity.

`compilePolicy(configuration, rosters)` validates all lists, including unused
ones, and returns detached, frozen grants. Roster includes are a union; an active
alternative grant continues to authorize. Remove every granting path for complete
revocation. Email matching trims and lowercases, preserving dots and plus tags.
An omitted expiry lasts until removal. UTC timestamps use exact seconds and a
real calendar date. `now < expiresAt` is the exclusive authorization rule.

## Optional previews, discovery and admission

To let a current member of selected areas read a separate preview area, add:

```js
preview: {
  id: 'previews',
  path: '/previews',
  eligibleAreaIds: ['handbook', 'client'],
}
```

The compiler derives preview grants from those areas and preserves each expiry.
No preview capability exists when this option is absent. The host must authorize
the preview scope and constrain it to its intended summary routes. The option
does not grant lessons, client documents or downloads from another area.

`areaSnapshot(policy, verifiedEmail)` exposes only authorized area hints by default.
Pass `{ discovery: 'all' }` to deliberately disclose all configured area IDs/paths
and their allowed flags. Discovery does not grant preview access; preview access
does not grant an area's content access. Snapshots expose no rosters or other identities.
Authorize the snapshot endpoint before returning this data.

An independent host-admission roster can be compiled with
`admission: { id: 'review', roster: 'reviewers' }`. It has no area root and does not
conflict with area roots. The host checks admission first, then the requested
area or preview grant. Reviewer admission alone grants neither.

`areaAllows`, `previewAllows`, `admissionAllows` and `policyScopeAllows` evaluate
these decisions independently. `allAreasAllow` checks all requested area IDs and
denies an empty/unknown set; it is useful when a shared index contains every area's
private excerpts. Every helper accepts an optional epoch-millisecond clock.

## Cloudflare composition

Cloudflare Access handles browser login. The verifier checks the assertion header
using the configured trusted team-domain JWKS endpoint, RS256, application audience,
issuer, expiry, issued-at, subject, email and application-token type. Tokens older
than 24 hours or issued in the future are rejected. An email header alone is ignored.

Add consumer-owned `teamDomain` and `audiences` to the compiled server policy.
Each scope needs its actual 64-character application audience. Do not guess audience
values or accept them from a browser. Keep mappings consistent with deployed applications.

```js
import { findArea } from '@ehven/starlight-area-cloudflare-access-controller';
import { authorizeRequest, protectedResponse } from '@ehven/starlight-area-cloudflare-access-controller/cloudflare';

// boundPolicy is compiled policy plus trusted teamDomain and audiences.
export function protectedAreaWorker(boundPolicy) {
  return {
    async fetch(request, env) {
      let area;
      try { area = findArea(boundPolicy.areas, new URL(request.url).pathname); }
      catch { return new Response('Invalid path', { status: 400 }); }
      if (!area) return new Response('Not found', { status: 404 });
      const denied = await authorizeRequest(request, area.id, boundPolicy);
      if (denied) return denied;
      return protectedResponse(await env.ASSETS.fetch(request));
    },
  };
}
```

This narrow example handles only independent protected areas. Compose preview,
snapshot, host-admission and public routes explicitly in the consumer. Keep
unknown paths within protected namespaces denied. Validate hostnames and route
aliases before serving content. Configure `assets.run_worker_first: true`, and
ensure no alternate asset endpoint bypasses the gate. For encoded paths, normalize
both authorization and the asset request consistently; `findArea` rejects ambiguous
encodings but does not rewrite the Request object.

`authorizeRequest` returns a protected denial response or `null` on success. Its
`onIdentity` callback receives verified identity after scope authorization.
Missing or invalid bindings and signing-key retrieval failures return a generic
503. Invalid tokens, unknown signing keys in a valid key set, and insufficient
grants return 403. Both responses are non-cacheable. The verifier retains at most
32 team key-set resolvers per process or isolate, with a five-second fetch timeout,
ten-minute key-set freshness and a 30-second interval before refreshing for an
unknown key. A failed refresh denies the request. The trusted `verify` test seam never permits trusting browser identity.

Protected responses disable browser/CDN caching and indexing and remove validators.
Keep protected media/downloads under the appropriate protected root. A shared
private search index must receive all necessary membership checks before serving
it; hiding the search control alone is insufficient.

## Existing numbered-course consumers

`compileRosters({ courses, previewRoster }, rosters)` preserves the existing
`{ courses, previewGrants }` compiled shape for nonempty numbered-course catalogs.
It retains `/coach/<provider>/<product>/<number>` validation and reserved scope IDs
`prerelease` and `course-previews`. New arbitrary-area consumers use `compilePolicy`.

The compatibility `scopeAllows` retains the existing learner-preview union, and
`entitlementResponse` retains `{ identity: { email }, courses: [{ path, allowed }] }`.
It must be called only after endpoint authorization. PRA summaries may remain
available to anyone with an active course grant, while each lesson/download still
requires its own course grant. A host-level reviewer gate remains independent.

The Astro components consume this compatibility snapshot shape. Both accept an
explicit same-origin endpoint and production hostname, with an optional prerelease
hostname. CourseNavigation also accepts a `summaryPaths` map from course root to
private summary URL. It expects the documented course/lesson attributes in the
consumer's Starlight sidebar. These components do not create endpoints or configure
Access. The components mount on normal page loads and Astro ClientRouter page
loads. Page swaps and page exits remove package-owned decorations and listeners,
and a restored history entry fetches a fresh snapshot. Late results are ignored
after cleanup. Test these interactions with the consumer's actual sidebar markup.

The browser loader includes same-origin credentials, disables caching, rejects
redirects, and uses an eight-second timeout. It shares only concurrent reads;
completed results are discarded and browser storage is unused. Hosts need Fetch,
URL and AbortSignal.timeout support. Browser failure does not disable server gates.

## Validation limits and recovery

Roots are canonical ASCII URL paths without trailing slashes, wildcard syntax,
query/fragment, percent escapes, dot segments or the whole-site `/` root. Unicode
root configuration and arbitrary nested-area policies are outside this version.
Shared ancestors, roster includes and a separate host-admission gate are supported.
Configuration errors throw; bad identities or non-finite clocks cannot authorize.

Fixed compilation bounds are exported as `POLICY_LIMITS`: 256 areas, 1,024 rosters,
50,000 authored members, 32 include edges of depth and 200,000 expanded grant visits.
Roots are limited to 1,024 characters, roster/scope IDs to 128, normalized request
path inputs to 8,192, emails to 254, and bearer-token headers to 32,768 characters.
Exceeding a bound fails validation; it never silently drops grants.

Removal is a security-sensitive migration: establish another effective gate before
removing this one. Preserve Cloudflare Access during rollback; avoid restoring a
Worker that serves protected assets without checking current membership. Preview
requests, payments and CRM records do not change enrollment unless the consumer
implements a separate, authorized enrollment workflow.
