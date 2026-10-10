import assert from 'node:assert/strict';
import {readFileSync,existsSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
const root=new URL('../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
const html=read('prototype-r9.html');
for(const [,path] of html.matchAll(/(?:src|href)="([^"]+)"/g))
  if(!path.startsWith('https:')) assert.ok(existsSync(new URL(path,root)),path);
const ts=createRequire(new URL('../../../web/package.json',import.meta.url))('typescript');
const compiled=ts.transpileModule(read('src/r9/app.jsx'),{fileName:'app.jsx',reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}});
assert.deepEqual(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
new vm.Script(compiled.outputText);
new vm.Script(read('tools/r9-qa.js'));

// Exercise the measurement rule with unequal heights, offset edges and wrapping.
const rect=(height,top=0,left=0)=>({height,top,bottom:top+height,left,width:100});
const node=r=>({tagName:'INPUT',className:'field',textContent:'',getAttribute:()=>'',closest:()=>null,getBoundingClientRect:()=>r});
function checkPair(a,b) {
  const parent={...node(rect(100)),querySelectorAll:()=>[node(a),node(b)]};
  const ctx={document:{querySelectorAll:s=>s==='.r7-manager-tools'?[parent]:[]},getComputedStyle:()=>({borderRadius:'8px',fontSize:'13px',lineHeight:'1'})};
  vm.createContext(ctx);
  vm.runInContext(read('tools/r9-qa.js').split("if (new URLSearchParams")[0],ctx);
  return ctx.captureGeometry().groups[0].pass;
}
assert.equal(checkPair(rect(36),rect(36,0,110)),true);
assert.equal(checkPair(rect(37.5),rect(28,4.75,110)),false);
assert.equal(checkPair(rect(36),rect(36,2,110)),false);
assert.equal(checkPair(rect(44),rect(44,56)),true);
assert.equal(checkPair(rect(38),rect(38,11)),true); // vertically scrolling menu rows

const fieldGroups=new Set(['.r7-manager-tools','.r3-color-input','.r4-date-fields','.st-inline-form','.r5-secret','.r5-auth-fields','.r5-address','.le','.login-form','.setup-form']);
const seen=new Set(); let states=0,groups=0;
for(const name of readdirSync(new URL('review-r9/',root)).filter(n=>n.endsWith('.json')&&!n.startsWith('content-')&&n!=='before.json')) {
  const r=JSON.parse(read('review-r9/'+name));
  assert.equal(r.overflow,false,name);
  assert.deepEqual(r.violations,[],name);
  assert.deepEqual(r.geometry.failures,[],name);
  assert.ok(r.geometry.groups.length,name+' must measure real groups');
  for(const g of r.geometry.groups){
    seen.add(g.group); groups++;
    const expected=r.viewport[0]<=640?44:fieldGroups.has(g.group)?36:g.group==='.tag-pop:popover-open'?38:32;
    for(const c of g.controls)assert.ok(Math.abs(c.height-expected)<=1,`${name}: ${g.group} ${c.height} != ${expected}`);
  }
  states++;
}
for(const group of ['.r7-manager-tools','.r3-color-input','.r5-auth-fields','.cmp-options','.ll-toolbar','.le','.tag-selected','.tag-pop:popover-open','.setup-form'])assert.ok(seen.has(group),`Missing coverage: ${group}`);
assert.ok(states>=20);
const meta=JSON.parse(read('_d_meta.json'));
assert.equal(meta.assets['Admin app'].versions.find(v=>v.path==='prototype-r9.html').status,'approved');
assert.equal(meta.assets['Admin app'].versions.find(v=>v.path==='prototype-r8.html').status,'changes-requested');
console.log(`R9: ${states} browser states, ${groups} group instances, ${seen.size} group types; geometry, axe, overflow, dependency/syntax and measurement self-checks passed.`);
