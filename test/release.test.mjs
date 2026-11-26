import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname, delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = join(root, 'scripts/release.mjs');
const repository = 'ehven-consultants-npm-products/ehven-starlight-area-cloudflare-access-controller';
const head = 'a'.repeat(40);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t, stable = true) {
  const cwd = mkdtempSync(join(tmpdir(), 'bot-release-test-'));
  t.after(() => rmSync(cwd, {recursive: true, force: true}));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  for (const path of pkg.files) {
    const target = join(cwd, path);
    mkdirSync(dirname(target), {recursive: true});
    cpSync(join(root, path), target);
  }
  Object.assign(pkg, {version: stable ? '1.0.0' : '0.1.0-dev.0', private: !stable});
  writeFileSync(join(cwd, 'package.json'), JSON.stringify(pkg));
  const invoke = (operation, env = process.env) => spawnSync(process.execPath, [script, operation], {
    cwd, env, encoding: 'utf8', timeout: 30000,
  });
  return {cwd, pkg, invoke};
}

function prepared(t) {
  const value = fixture(t);
  const result = value.invoke('prepare');
  assert.equal(result.status, 0, result.stderr);
  return {...value, candidate: JSON.parse(result.stdout)};
}

function provider(value, initial = {}) {
  const {cwd, candidate} = value;
  const bin = join(cwd, 'bin'); mkdirSync(bin);
  const statePath = join(cwd, 'provider.json');
  const state = {head, version: '12.2.2', calls: [], response: {
    [candidate.name]: {name: candidate.name, version: candidate.version, integrity: candidate.integrity,
      stageId: '12345678-1234-1234-1234-123456789abc'},
  }, ...initial};
  writeFileSync(statePath, JSON.stringify(state));
  const fake = `#!${process.execPath}
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,basename} from 'node:path';
const file=${JSON.stringify(statePath)},cwd=${JSON.stringify(cwd)};
const state=JSON.parse(readFileSync(file));const args=process.argv.slice(2),command=basename(process.argv[1]);
const save=()=>writeFileSync(file,JSON.stringify(state));const out=value=>{save();console.log(typeof value==='string'?value:JSON.stringify(value));};
const fail=message=>{save();console.error(message);process.exit(1);};
state.calls.push([command,...args]);
if(command==='git')out(state.head);
else if(command==='npm') {
 if(args[0]==='--version')out(state.version);
 else if(args[0]==='stage'&&args[1]==='publish') {
  const tar=args[2];state.stage={args,tar,bytes:readFileSync(tar).toString('base64'),userConfig:readFileSync(process.env.NPM_CONFIG_USERCONFIG,'utf8'),globalConfig:readFileSync(process.env.NPM_CONFIG_GLOBALCONFIG,'utf8'),keys:Object.keys(process.env),provenance:{event:process.env.GITHUB_EVENT_NAME,repositoryId:process.env.GITHUB_REPOSITORY_ID,ownerId:process.env.GITHUB_REPOSITORY_OWNER_ID,runner:process.env.RUNNER_ENVIRONMENT}};
  out(state.response);
 } else fail('Unexpected npm operation');
} else if(command==='gh') {
 if(args[0]==='api') {
  const path=args[1];
  if(path.endsWith('/git/ref/heads/main'))out({object:{sha:state.main??state.head}});
  else if(path.includes('/actions/workflows/ci.yml/runs'))out({workflow_runs:[{id:1,name:'Package checks',head_sha:state.head,head_branch:'main',event:'push',status:'completed',conclusion:state.ci??'success'}]});
  else if(path.includes('/git/ref/tags/')){if(state.tag)out({object:{type:'commit',sha:state.tag}});else fail('HTTP 404');}
  else if(args.includes('POST')){state.tag=state.head;out({});}
  else fail('Unexpected GitHub API');
 } else if(args[0]==='release') {
  const operation=args[1];
  if(operation==='view'){if(state.release)out(state.release);else fail('release not found');}
  else if(operation==='create') {
   state.release={databaseId:42,isDraft:true,isImmutable:false,tagName:args[2],name:args[args.indexOf('--title')+1],body:args[args.indexOf('--notes')+1],assets:[]};out({});
  } else if(operation==='upload'){state.release.assets.push({name:basename(args.at(-1))});out({});}
  else if(operation==='download'){copyFileSync(join(cwd,'release',args[args.indexOf('--pattern')+1]),args[args.indexOf('--output')+1]);out({});}
  else fail('Unexpected release mutation');
 } else fail('Unexpected gh operation');
} else fail('Unexpected command');
`;
  for (const name of ['git', 'gh', 'npm']) writeFileSync(join(bin, name), fake, {mode: 0o755});
  return {
    read: () => JSON.parse(readFileSync(statePath)),
    env: {...process.env, PATH: bin + delimiter + process.env.PATH,
      GITHUB_REPOSITORY: repository, GITHUB_SHA: head, GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REPOSITORY_ID: '100', GITHUB_REPOSITORY_OWNER_ID: '200', RUNNER_ENVIRONMENT: 'github-hosted',
      GH_TOKEN: 'synthetic-github-token', NODE_AUTH_TOKEN: 'synthetic-npm-token',
      NPM_TOKEN: 'synthetic-legacy-token', NPM_CONFIG_OTP: '123456',
    },
  };
}

test('private preview refuses prepare, draft and stage before provider execution', t => {
  const value = fixture(t, false);
  for (const operation of ['prepare', 'draft', 'stage']) assert.notEqual(value.invoke(operation).status, 0);
  value.pkg.version = '1.0.0';
  writeFileSync(join(value.cwd, 'package.json'), JSON.stringify(value.pkg));
  assert.notEqual(value.invoke('prepare').status, 0);
  assert.equal(existsSync(join(value.cwd, 'release')), false);
});

test('stable fixture prepares exactly the npm tarball and SHA256SUMS', t => {
  const {cwd, candidate} = prepared(t);
  assert.equal(candidate.version, '1.0.0');
  assert.deepEqual(candidate.assets.map(x => x.name), ['ehven-starlight-area-cloudflare-access-controller-1.0.0.tgz', 'SHA256SUMS']);
  for (const asset of candidate.assets) assert.equal(asset.sha256, digest(readFileSync(join(cwd, 'release', asset.name))));
});

test('unexpected payload file stops preparation', t => {
  const value = fixture(t);
  value.pkg.files.push('missing.mjs');
  writeFileSync(join(value.cwd, 'package.json'), JSON.stringify(value.pkg));
  assert.notEqual(value.invoke('prepare').status, 0);
});

test('changed candidate bytes stop draft and stage before any provider call', t => {
  const value = prepared(t), mock = provider(value);
  writeFileSync(join(value.cwd, 'release', value.candidate.tarball), 'substituted');
  for (const operation of ['draft', 'stage']) assert.notEqual(value.invoke(operation, mock.env).status, 0);
  assert.deepEqual(mock.read().calls, []);
});

test('draft requires current main with successful current CI', t => {
  for (const initial of [{main: 'b'.repeat(40)}, {ci: 'failure'}, {ci: 'cancelled'}]) {
    const value = prepared(t), mock = provider(value, initial);
    assert.notEqual(value.invoke('draft', mock.env).status, 0);
    assert.equal(mock.read().tag, undefined);
    assert.equal(mock.read().release, undefined);
  }
});

test('draft uploads missing assets, verifies readback and resumes without duplicate upload', t => {
  const value = prepared(t), mock = provider(value);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = value.invoke('draft', mock.env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).draft, true);
  }
  const state = mock.read();
  assert.equal(state.release.isDraft, true);
  assert.equal(state.calls.filter(x => x[1] === 'release' && x[2] === 'upload').length, 2);
  assert.equal(state.calls.some(x => x.includes('--draft') === false && x[2] === 'create'), false);
  assert.ok(state.calls.filter(x => x[2] === 'download').length >= 4);
});

test('published release cannot be changed by draft preparation', t => {
  const value = prepared(t), mock = provider(value, {tag: head, release: {isDraft: false, isImmutable: true}});
  assert.notEqual(value.invoke('draft', mock.env).status, 0);
  assert.equal(mock.read().calls.some(x => x.includes('upload') || x.includes('PATCH') || x.includes('create')), false);
});

test('wrong npm version cannot submit a stage', t => {
  const value = prepared(t), mock = provider(value, {version: '11.19.1'});
  assert.notEqual(value.invoke('stage', mock.env).status, 0);
  assert.equal(mock.read().stage, undefined);
});

test('stage sends exact bytes with empty configs and preserves provenance without inherited tokens', t => {
  const value = prepared(t), mock = provider(value);
  const result = value.invoke('stage', mock.env);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).published, false);
  const state = mock.read(), sent = state.stage;
  assert.deepEqual(Buffer.from(sent.bytes, 'base64'), readFileSync(join(value.cwd, 'release', value.candidate.tarball)));
  assert.equal(sent.userConfig, ''); assert.equal(sent.globalConfig, '');
  for (const key of ['GH_TOKEN', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NPM_CONFIG_OTP']) assert.equal(sent.keys.includes(key), false);
  assert.deepEqual(sent.provenance, {event: 'workflow_dispatch', repositoryId: '100', ownerId: '200', runner: 'github-hosted'});
  assert.ok(sent.args.includes('--provenance')); assert.ok(sent.args.includes('--ignore-scripts'));
  assert.equal(existsSync(sent.tar), false);
  assert.equal(state.calls.some(x => x.includes('approve')), false);
});

test('ambiguous stage response fails without automatic retry or approval', t => {
  const value = prepared(t), mock = provider(value, {response: {}});
  assert.notEqual(value.invoke('stage', mock.env).status, 0);
  const state = mock.read();
  assert.equal(state.calls.filter(x => x[1] === 'stage').length, 1);
  assert.equal(state.calls.some(x => x.includes('approve')), false);
  assert.equal(existsSync(state.stage.tar), false);
});
