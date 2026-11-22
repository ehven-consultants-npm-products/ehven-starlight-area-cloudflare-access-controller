import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePolicy, findArea, validateAreaRoot, normalizePathname } from '../src/index.mjs';

test('sibling course roots sharing an ancestor or roster are independent', () => {
  const policy = compilePolicy({ areas: [
    { id: 'first', path: '/coach/provider/tool/1', roster: 'shared' },
    { id: 'second', path: '/coach/provider/tool/2', roster: 'shared' },
  ], preview: { id: 'previews', path: '/coach/preview', eligibleAreaIds: ['first', 'second'] } }, { shared: { includes: [], members: [] } });
  assert.equal(findArea(policy.areas, '/coach/provider/tool/1').id, 'first');
  assert.equal(findArea(policy.areas, '/coach/provider/tool/1/index.html').id, 'first');
  assert.equal(findArea(policy.areas, '/coach/provider/tool/10/'), undefined);
  assert.equal(findArea(policy.areas, '/coach/preview/first/'), undefined);
  assert.equal(findArea(policy.areas, '/%63oach/provider/tool/2/').id, 'second');
});

test('roots permit ordinary canonical paths while rejecting wildcard, alias and encoding ambiguity', () => {
  for (const path of ['/members', '/clients/acme', '/en/Manual-v1.2', '/_private/docs']) assert.equal(validateAreaRoot(path), path);
  for (const path of ['/', '', 'members', '/members/', '//members', '/a/../b', '/a/./b', '/a/*', '/a?b', '/a#b', '/a%2fb', '/a\\b', '/a b', '/עברית']) assert.throws(() => validateAreaRoot(path));
});

test('path normalization denies alternate encodings and malformed path representations', () => {
  for (const path of ['/a%2fb', '/a%5cb', '/a%252fb', '/a%00b', '/a%20b', '/a/%2e%2e/b', '/a//b', '/a\\b', '//a', '/a?b', '/a#b', '/a/%', 'https://example.org/a']) assert.throws(() => normalizePathname(path));
  assert.equal(normalizePathname('/a/index.html'), '/a/index.html');
});
