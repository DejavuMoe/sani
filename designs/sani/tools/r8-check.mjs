import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../../../web/package.json', import.meta.url));
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('prototype-r8.html',root),'utf8');
for (const [,path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!path.startsWith('https:')) assert.ok(existsSync(new URL(path,root)),`Missing local dependency: ${path}`);
}
for (const name of readdirSync(new URL('src/r8/',root))) {
  if (!/\.jsx?$/.test(name)) continue;
  const code = readFileSync(new URL(`src/r8/${name}`,root),'utf8');
  const result=ts.transpileModule(code,{fileName:name,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
  assert.deepEqual(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>d.messageText),[],name);
  new vm.Script(result.outputText,{filename:name});
}
const metadata=JSON.parse(readFileSync(new URL('_d_meta.json',root),'utf8'));
assert.equal(metadata.assets['Admin app'].versions.find(v=>v.path==='prototype-r8.html').status,'needs-review');
assert.equal(metadata.assets['Admin app'].versions.find(v=>v.path==='prototype-r6.html').status,'approved');
for(const file of readdirSync(new URL('review-r8/',root)).filter(n=>n.endsWith('.json')&&!n.startsWith('content-'))){
  const result=JSON.parse(readFileSync(new URL(`review-r8/${file}`,root),'utf8'));
  assert.equal(result.overflow,false,file);
  assert.deepEqual(result.violations,[],file);
}
console.log('R8: local dependencies, all JSX/JS syntax, review status and saved browser checks passed.');

const ctx={window:{}};vm.createContext(ctx);
for(const path of ['src/gen/i18n.js','src/r7/copy.js','src/r8/copy.js'])vm.runInContext(readFileSync(new URL(path,root),'utf8'),ctx);
const words=ctx.window.SANI_I18N;
for(const lang of ['zh','en'])for(const kind of ['url','text','file'])assert.equal(words[lang]['filter.'+kind],words[lang]['create.'+kind]);
assert.equal(words.zh['list.copyShort'],words.zh['keys.copy']);
assert.equal(words.en['list.copyShort'],words.en['keys.copy']);
assert.equal(words.en['list.spark.one'],'1 visit in the last 14 days');
assert.equal(words.en['list.spark.other'],'{n} visits in the last 14 days');
assert.equal(words.zh['keys.new'],'聚焦创建区域');
console.log('R8: shared category names, copy labels and English visit plurals passed.');
