import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../../../web/package.json', import.meta.url));
const ts = require('typescript');
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('prototype-r7.html',root),'utf8');
for (const [,path] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  if (!path.startsWith('https:')) assert.ok(existsSync(new URL(path,root)),`Missing local dependency: ${path}`);
}
for (const name of readdirSync(new URL('src/r7/',root))) {
  if (!/\.jsx?$/.test(name)) continue;
  const code = readFileSync(new URL(`src/r7/${name}`,root),'utf8');
  const result=ts.transpileModule(code,{fileName:name,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});
  assert.deepEqual(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).map(d=>d.messageText),[],name);
  new vm.Script(result.outputText,{filename:name});
}
const metadata=JSON.parse(readFileSync(new URL('_d_meta.json',root),'utf8'));
assert.equal(metadata.assets['Admin app'].versions.find(v=>v.path==='prototype-r7.html').status,'approved');
assert.equal(metadata.assets['Admin app'].versions.find(v=>v.path==='prototype-r6.html').status,'approved');
for(const file of readdirSync(new URL('review-r7/',root)).filter(n=>n.endsWith('.json')&&n.startsWith('r7-'))){
  const result=JSON.parse(readFileSync(new URL(`review-r7/${file}`,root),'utf8'));
  assert.equal(result.overflow,false,file);
  assert.deepEqual(result.violations,[],file);
}
console.log('R7: local dependencies, all JSX/JS syntax, review status and saved browser checks passed.');
