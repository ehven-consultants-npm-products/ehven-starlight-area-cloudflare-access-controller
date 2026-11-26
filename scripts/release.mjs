import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync, rmSync, lstatSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

function productRepository() {
 const match=/^git\+https:\/\/github\.com\/(ehven-consultants-npm-products\/[a-z0-9._-]+)\.git$/.exec(metadata().repository?.url??'');
 if(!match)throw Error('Expected public product repository metadata');return match[1];
}
const sha=(bytes,algorithm='sha256',encoding='hex')=>createHash(algorithm).update(bytes).digest(encoding);
const run=(command,args,options={})=>execFileSync(command,args,{timeout:120000,maxBuffer:4*1024*1024,...options});
const json=(command,args)=>JSON.parse(String(run(command,args)));
const github=path=>json('gh',['api',path]);
const bounded=file=>{const stat=lstatSync(file);if(!stat.isFile()||stat.size>32*1024*1024)throw Error('Expected bounded regular release file');return readFileSync(file);};
const metadata=()=>{const pkg=JSON.parse(readFileSync('package.json','utf8'));if(pkg.private!==false)throw Error('Private preview cannot be released');if(!/^@ehven\/[a-z0-9._-]+$/.test(pkg.name??'')||!/^\d+\.\d+\.\d+$/.test(pkg.version??''))throw Error('Invalid package release identity');return pkg;};

function directAssets(pkg) {
 const paths=[...new Set([pkg.style,pkg.unpkg,...Object.values(pkg.exports??{}).filter(value=>typeof value==='string'&&value.startsWith('./dist/'))].filter(Boolean).map(x=>x.replace(/^\.\//,'')))];
 if(paths.some(x=>!/^[-A-Za-z0-9._/]+$/.test(x)||x.startsWith('/')||x.split('/').some(v=>!v||v==='.'||v==='..'))||new Set(paths.map(path=>basename(path))).size!==paths.length)throw Error('Invalid direct asset paths');
 return paths;
}

export function prepare() {
 const pkg=metadata(),repository=productRepository();
 if(!/^@ehven\/[a-z0-9._-]+$/.test(pkg.name??'')||!/^\d+\.\d+\.\d+$/.test(pkg.version)||pkg.repository.url!==`git+https://github.com/${repository}.git`)throw Error('Package release identity mismatch');
 mkdirSync('release',{recursive:true});
 const response=json('npm',['pack','--ignore-scripts','--offline','--json','--pack-destination','release']);
 const entries=Array.isArray(response)?response:Object.values(response);
 if(entries.length!==1||entries[0].name!==pkg.name||entries[0].version!==pkg.version)throw Error('Unexpected packed identity');
 const packed=entries[0];
 const expected=[...new Set([...(pkg.files??[]),'LICENSE','README.md','package.json'])].sort();
 if(JSON.stringify(packed.files.map(x=>x.path).sort())!==JSON.stringify(expected))throw Error('Unexpected package file inventory');
 for(const path of directAssets(pkg)) {
   const name=basename(path),css=bounded(path);
   const inside=run('tar',['-xOzf',join('release',packed.filename),'--','package/'+path]);
   if(!css.equals(inside))throw Error('Release asset differs from packed output');
   copyFileSync(path,join('release',name));
 }
 const tar=bounded(join('release',packed.filename));
 if('sha512-'+sha(tar,'sha512','base64')!==packed.integrity)throw Error('Packed integrity mismatch');
 const names=[packed.filename,...directAssets(pkg).map(path=>basename(path))];
 writeFileSync('release/SHA256SUMS',names.map(name=>sha(bounded(join('release',name)))+'  '+name+'\n').join(''));
 const candidate={schemaVersion:1,repository,name:pkg.name,version:pkg.version,tag:'v'+pkg.version,tarball:packed.filename,integrity:packed.integrity,assets:[...names,'SHA256SUMS'].map(name=>({name,sha256:sha(bounded(join('release',name)))}))};
 writeFileSync('release/candidate.json',JSON.stringify(candidate,null,2)+'\n');
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`tag=${candidate.tag}\ntarball=${candidate.tarball}\n`);
 return candidate;
}

function candidate() {
 const value=JSON.parse(bounded('release/candidate.json'));
 const pkg=metadata(),repository=productRepository();
 if(value.repository!==repository||value.name!==pkg.name||value.version!==pkg.version||value.tag!=='v'+pkg.version||value.tarball!==pkg.name.slice(1).replace('/','-')+'-'+pkg.version+'.tgz'||value.schemaVersion!==1||!Array.isArray(value.assets)||value.assets.length!==directAssets(pkg).length+2||new Set(value.assets.map(x=>x.name)).size!==value.assets.length)throw Error('Candidate metadata mismatch');
 const names=[value.tarball,...directAssets(pkg).map(path=>basename(path)),'SHA256SUMS'];
 for(const asset of value.assets)if(!names.includes(asset.name)||sha(bounded(join('release',asset.name)))!==asset.sha256)throw Error('Candidate asset changed');
 if('sha512-'+sha(bounded(join('release',value.tarball)),'sha512','base64')!==value.integrity)throw Error('Candidate tarball changed');
 return value;
}

function currentMain() {
 const repository=productRepository();
 const head=String(run('git',['rev-parse','HEAD'])).trim();
 if(process.env.GITHUB_REPOSITORY!==repository||process.env.GITHUB_SHA!==head||github(`repos/${repository}/git/ref/heads/main`).object.sha!==head)throw Error('Release requires the exact current product main');
 const runs=github(`repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${head}&branch=main&per_page=10`).workflow_runs;
 const ci=runs.filter(x=>x.name==='Package checks'&&x.head_sha===head&&x.head_branch==='main'&&x.event==='push').sort((a,b)=>b.id-a.id)[0];
 if(!ci||ci.status!=='completed'||ci.conclusion!=='success')throw Error('Current main CI must pass before release');
 return head;
}

export function draft() {
 const value=candidate(),head=currentMain(),repository=productRepository();
 const title=value.name+' '+value.version,notes='See the versioned README and changelog for usage, compatibility and changes.';
 let ref;
 try {ref=github(`repos/${repository}/git/ref/tags/${value.tag}`).object;}
 catch(e){if(!/HTTP 404/i.test(String(e.stderr??'')))throw e;}
 if(ref&&ref.type!=='commit')throw Error('Expected a direct source tag');
 if(!ref){run('gh',['api','--method','POST',`repos/${repository}/git/refs`,'-f','ref=refs/tags/'+value.tag,'-f','sha='+head]);ref=github(`repos/${repository}/git/ref/tags/${value.tag}`).object;}
 if(ref.type!=='commit')throw Error('Release tag readback differs');
 const previousTag=ref.sha;
 let release;
 try {release=json('gh',['release','view',value.tag,'--repo',repository,'--json','databaseId,isDraft,isImmutable,tagName,name,body,assets']);}
 catch(e) {if(!/release not found|HTTP 404/i.test(String(e.stderr??'')))throw e;}
 if(release) {
   if(!release.isDraft||release.isImmutable!==false||release.tagName!==value.tag||release.name!==title||release.body!==notes)throw Error('Existing release conflicts with this draft');
   if(previousTag!==head) {
     if(release.assets.length!==value.assets.length)throw Error('Only a complete identical draft can advance its source tag');
     const comparison=github(`repos/${repository}/compare/${previousTag}...${head}?per_page=1`);
     if(comparison.status!=='ahead'||comparison.behind_by!==0)throw Error('Draft source tag must fast-forward');
   }
 } else {
   if(previousTag!==head)throw Error('Existing source tag has no identical draft');
   run('gh',['release','create',value.tag,'--repo',repository,'--verify-tag','--draft','--title',title,'--notes',notes]);
   release=json('gh',['release','view',value.tag,'--repo',repository,'--json','databaseId,isDraft,tagName,name,body,assets']);
   if(!release.isDraft)throw Error('Expected unpublished draft');
 }
 ref=github(`repos/${repository}/git/ref/tags/${value.tag}`).object;
 if(ref.type!=='commit'||ref.sha!==previousTag)throw Error('Release tag changed while preparing');
 const temporary=mkdtempSync(join(tmpdir(),'access-controller-assets-'));
 try {
   const expected=new Map(value.assets.map(x=>[x.name,x.sha256]));
   const observed=new Set();
   for(const asset of release.assets) {
     if(!expected.has(asset.name)||observed.has(asset.name))throw Error('Unexpected draft asset');
     const file=join(temporary,asset.name);run('gh',['release','download',value.tag,'--repo',repository,'--pattern',asset.name,'--output',file]);
     if(sha(bounded(file))!==expected.get(asset.name))throw Error('Draft asset conflicts');observed.add(asset.name);
   }
   for(const asset of value.assets)if(!observed.has(asset.name))run('gh',['release','upload',value.tag,'--repo',repository,join('release',asset.name)]);
   const final=json('gh',['release','view',value.tag,'--repo',repository,'--json','databaseId,isDraft,isImmutable,tagName,name,body,assets']);
   if(final.databaseId!==release.databaseId||!final.isDraft||final.isImmutable!==false||final.tagName!==value.tag||final.name!==title||final.body!==notes||final.assets.length!==value.assets.length||new Set(final.assets.map(x=>x.name)).size!==value.assets.length||final.assets.some(x=>!expected.has(x.name)))throw Error('Draft changed while preparing');
   for(const asset of value.assets) {
     const file=join(temporary,'verified-'+asset.name);run('gh',['release','download',value.tag,'--repo',repository,'--pattern',asset.name,'--output',file]);
     if(sha(bounded(file))!==asset.sha256)throw Error('Draft readback differs');
   }
   if(previousTag!==head) {
     if(currentMain()!==head||github(`repos/${repository}/git/ref/tags/${value.tag}`).object.sha!==previousTag)throw Error('Source changed before draft tag advance');
     // Unpublished drafts may follow a workflow-only fix when every asset is identical.
     // Published/immutable releases and divergent tags are never advanced.
     run('gh',['api','--method','PATCH',`repos/${repository}/git/refs/tags/${value.tag}`,'-f','sha='+head,'-F','force=false']);
   }
   ref=github(`repos/${repository}/git/ref/tags/${value.tag}`).object;
   if(ref.type!=='commit'||ref.sha!==head)throw Error('Final source tag readback differs');
 } finally {rmSync(temporary,{recursive:true,force:true});}
 return {draft:true,tag:value.tag,source:head,assetsVerified:value.assets.length,...(previousTag!==head?{tagAdvancedFrom:previousTag}:{})};
}

export function stage() {
 const value=candidate();currentMain();
 if(String(run('npm',['--version'])).trim()!=='12.2.2')throw Error('npm 12.2.2 required');
 const temporary=mkdtempSync(join(tmpdir(),'access-controller-stage-'));
 try {
   const env={};
   for(const key of ['PATH','HOME','TMPDIR','LANG','LC_ALL','SSL_CERT_FILE','SSL_CERT_DIR','NODE_EXTRA_CA_CERTS','ACTIONS_ID_TOKEN_REQUEST_URL','ACTIONS_ID_TOKEN_REQUEST_TOKEN','GITHUB_ACTIONS','RUNNER_ENVIRONMENT','GITHUB_EVENT_NAME','GITHUB_REPOSITORY_ID','GITHUB_REPOSITORY_OWNER_ID','GITHUB_REPOSITORY','GITHUB_SHA','GITHUB_REF','GITHUB_REF_NAME','GITHUB_REF_TYPE','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_WORKFLOW_REF','GITHUB_WORKFLOW_SHA','GITHUB_SERVER_URL','GITHUB_ACTOR','CI'])if(process.env[key]!==undefined)env[key]=process.env[key];
   for(const key of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])if(process.env[key]){if(!['http:','https:'].includes(new URL(process.env[key]).protocol))throw Error('Unsupported proxy');env[key]=process.env[key];}
   Object.assign(env,{NPM_CONFIG_USERCONFIG:join(temporary,'user.npmrc'),NPM_CONFIG_GLOBALCONFIG:join(temporary,'global.npmrc'),NPM_CONFIG_CACHE:join(temporary,'cache'),NPM_CONFIG_REGISTRY:'https://registry.npmjs.org/',NPM_CONFIG_STRICT_SSL:'true',NPM_CONFIG_FETCH_RETRIES:'0',NPM_CONFIG_FETCH_TIMEOUT:'30000',NPM_CONFIG_UPDATE_NOTIFIER:'false',NPM_CONFIG_LOGS_MAX:'0'});
   writeFileSync(env.NPM_CONFIG_USERCONFIG,'',{mode:0o600,flag:'wx'});writeFileSync(env.NPM_CONFIG_GLOBALCONFIG,'',{mode:0o600,flag:'wx'});
   const file=join(temporary,value.tarball);writeFileSync(file,bounded(join('release',value.tarball)),{mode:0o400,flag:'wx'});
   const result=JSON.parse(String(run('npm',['stage','publish',file,'--access','public','--tag','latest','--ignore-scripts','--provenance','--json'],{cwd:temporary,env})))[value.name];
   if(result?.name!==value.name||result.version!==value.version||result.integrity!==value.integrity||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(result.stageId??''))throw Error('Ambiguous stage submission; inspect existing stages before retrying');
   return {name:value.name,version:value.version,stageId:result.stageId,integrity:value.integrity,published:false};
 } finally {rmSync(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {const operation=process.argv[2];if(process.argv.length!==3||!['prepare','draft','stage'].includes(operation))throw Error('Use prepare, draft or stage');console.log(JSON.stringify(({prepare,draft,stage})[operation](),null,2));}
 catch {console.error('Release preparation stopped. Verify candidate, current CI and provider state before retrying.');process.exitCode=1;}
}

