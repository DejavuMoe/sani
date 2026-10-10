// Isolated prototype QA. Never imports the app or contacts a Sani instance.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(new URL('../../../web/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const axe = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const root = new URL('../', import.meta.url);
const collector = readFileSync(new URL('tools/collect-dom-content.js', root), 'utf8');
const base = process.env.PROTO_URL || 'http://127.0.0.1:4312/sani';
const out = resolve(process.env.R10_OUTPUT || '/tmp/sani-r10');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const quick = process.argv.includes('--quick');
const settingsOnly = process.argv.includes('--settings');
const textOnly = process.argv.includes('--text');
const reviewOnly = process.argv.includes('--review');
const failures = [], results = [], captures = [], errors = [];
const scenes = settingsOnly ? ['r8-settings','r5-socks'] : ['r8-settings','r5-socks','r8-dashboard','r7-tags','r7-text-create','r7-file-create','r7-edit','r8-setup','login','r6-settings-locked','r7-query-error','r7-tokens-error','r7-empty','r6-code','r7-import','r8-settings-long'];
const matrix = (process.argv.includes('--flows') || textOnly || reviewOnly) ? [] : quick ? [[1280,900,'zh','light'],[390,844,'en','dark']] : [1280,390].flatMap(w => ['zh','en'].flatMap(l => ['light','dark'].map(t => [w,w===1280?900:844,l,t])));
async function settle(page) {
  await page.locator('#app main').waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
}
async function go(page,scene,lang,theme,focus='',revision='r10') {
  await page.goto(`${base}/prototype-${revision}.html?${new URLSearchParams({scene,lang,theme,focus,chrome:'0',latency:'0'})}`,{waitUntil:'networkidle'});
  await settle(page);
  if(revision==='r10' && scene==='r8-settings')await expect(page.locator('#r6-max-help')).toContainText('25 MB');
}
async function inspect(page,name,shot=false) {
  await page.addScriptTag({content:axe});
  const result = await page.evaluate(async()=>{
    const visible=e=>e.getBoundingClientRect().height>0 && !e.closest('[inert]');
    const rect=e=>{const r=e.getBoundingClientRect();return {height:r.height,width:r.width,top:r.top,left:r.left,text:(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,45)}};
    const groups=[];
    for(const [parent,child] of [['.st-inline-form','.field,.btn'],['.r5-secret','.field,.btn'],['.r7-manager-tools','.r7-search,.seg'],['.r5-address','.field'],['.r3-color-input','.field,.r4-color-preview'],['.ll-toolbar','.ll-search,.kind,.sort,.ll-pick'],['.cmp-options','.seg,.opt,.cmp-go,.slugf-box']]) {
      for(const p of document.querySelectorAll(parent)) {
        const c=[...p.querySelectorAll(child)].filter(visible).map(rect);
        if(c.length>1) groups.push({parent,controls:c});
      }
    }
    const segments=[...document.querySelectorAll('.seg')].filter(visible).map(e=>({outer:rect(e),buttons:[...e.children].filter(x=>x.tagName==='BUTTON').map(rect)}));
    const violations=(await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))}));
    const badControls=[...document.querySelectorAll('select,input[type="number"],input[type="date"],input[type="datetime-local"],input[type="color"],[title]')].filter(visible).map(e=>e.outerHTML.slice(0,140));
    const overflowing=[...document.querySelectorAll('body *')].filter(visible).filter(e=>e.getBoundingClientRect().right>innerWidth+1 && getComputedStyle(e).position!=='fixed').map(e=>({tag:e.tagName,cls:e.className,...rect(e)})).slice(0,20);
    return {overflowing,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,groups,segments,violations,badControls};
  });
  for(const g of result.groups)for(let i=0;i<g.controls.length;i++)for(let j=i+1;j<g.controls.length;j++){
    const a=g.controls[i],b=g.controls[j];
    if(Math.abs(a.top-b.top)<Math.min(a.height,b.height)/2 && Math.abs(a.left-b.left)>5 && Math.abs(a.height-b.height)>1)failures.push(`${name}: ${g.parent} unequal ${a.height}/${b.height}`);
  }
  for(const s of result.segments)if(s.buttons.every(b=>Math.abs(b.top-s.buttons[0].top)<1) && s.buttons.some(b=>Math.abs(s.outer.height-b.height-4)>1))failures.push(`${name}: segment inset`);
  if(result.overflow||result.violations.length||result.badControls.length)failures.push({name,...result});
  await page.addScriptTag({content:collector});
  captures.push(await page.evaluate(()=>window.__prototypeFirstUICollectDOMContent()));
  results.push({name,viewport:page.viewportSize(),...result});
  if(shot)await page.screenshot({path:resolve(out,name+'.png')});
}
try {
  for(const [width,height,lang,theme] of matrix) {
    const page=await browser.newPage({viewport:{width,height},locale:lang==='zh'?'zh-CN':'en-US',reducedMotion:'reduce',hasTouch:width<500});
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    for(const scene of scenes) {
      const focus=scene==='r8-settings'?'defaults':scene==='r5-socks'?'metadata':scene==='r8-settings-long'?'about':'';
      await go(page,scene,lang,theme,focus);
      const name=`${scene}-${lang}-${theme}-${width}`;
      await inspect(page,name,['r8-settings','r5-socks','r8-dashboard','r7-tags'].includes(scene));
    }
    console.log(`Rendered ${width}px ${lang}/${theme}: ${scenes.length} states`);
    await page.close();
  }
  // Exercise actual inputs, keyboard navigation and async recovery, not DOM mutations.
  for(const [lang,theme] of (settingsOnly || textOnly || reviewOnly) ? [] : [['zh','light'],['en','dark']]) {
    const page=await browser.newPage({viewport:{width:390,height:844},locale:lang==='zh'?'zh-CN':'en-US',hasTouch:true,reducedMotion:'reduce'});
    page.on('pageerror',e=>errors.push(e.message));
    await go(page,'r6-settings-retry',lang,theme,'defaults');
    const defaults=page.locator('#r6-defaults');
    await page.locator('#r6-slugLength').fill('2');
    await expect(page.locator('#r6-slugLength')).toHaveAttribute('aria-invalid','true');
    await expect(defaults.getByRole('button',{name:lang==='zh'?'保存':'Save',exact:true})).toBeDisabled();
    await inspect(page,`defaults-invalid-${lang}`);
    await page.locator('#r6-slugLength').fill('8');
    await page.locator('#r6-slugLength-unit').click();
    await expect(page.locator('#r6-slugLength')).toBeFocused();
    const saveWidth=(await defaults.getByRole('button').boundingBox()).width;
    await defaults.getByRole('button',{name:lang==='zh'?'保存':'Save',exact:true}).click();
    assert.ok(Math.abs((await defaults.getByRole('button').boundingBox()).width-saveWidth)<1,'save button must not resize while busy');
    await expect(defaults.getByRole('button')).toHaveAttribute('aria-busy','true');
    await inspect(page,`defaults-saving-${lang}`);
    await expect(defaults.getByRole('button',{name:lang==='zh'?'重试保存':'Retry save'})).toBeVisible();
    await inspect(page,`defaults-error-${lang}`);
    await defaults.getByRole('button').click();
    await expect(defaults.getByRole('status')).toHaveText(lang==='zh'?'已保存':'Saved');
    await expect(page.locator('#r6-slugLength')).toHaveValue('8');
    await go(page,'r5-retry',lang,theme,'metadata');
    const radio=page.getByRole('radio',{name:'HTTP(S)',exact:true});
    await radio.press('End');
    await expect(page.getByRole('radio',{name:'SOCKS5'})).toHaveAttribute('aria-checked','true');
    await page.getByRole('radio',{name:'SOCKS5'}).press('Home');
    await expect(page.getByRole('radio',{name:lang==='zh'?'直接连接':'Direct',exact:true})).toHaveAttribute('aria-checked','true');
    await radio.click();
    await page.getByRole('button',{name:lang==='zh'?'测试连接':'Test connection',exact:true}).click();
    await expect(page.getByRole('button',{name:lang==='zh'?'重试连接':'Retry connection',exact:true})).toBeVisible();
    await inspect(page,`connection-error-${lang}`);
    await page.getByRole('button',{name:lang==='zh'?'重试连接':'Retry connection',exact:true}).click();
    await expect(page.locator('.r5-feedback')).toContainText(lang==='zh'?'连接成功':'Connected');
    await go(page,'r7-tags',lang,theme);
    await page.getByRole('button',{name:/^(编辑标签|Edit tag) /}).first().click();
    await expect(page.locator('.r7-edit-tag:visible')).toBeVisible();
    await inspect(page,`tag-color-open-${lang}`,true);
    await page.locator('.r7-edit-tag:visible > .field').fill('netcup');
    await inspect(page,`tag-validation-${lang}`);
    await page.locator('.r7-edit-tag:visible > .field').press('Escape');
    await expect(page.locator('.r7-edit-tag:visible')).not.toBeVisible();
    await page.getByRole('textbox',{name:lang==='zh'?'搜索标签':'Search tags',exact:true}).fill('no-match-test');
    await inspect(page,`tag-no-results-${lang}`);
    await page.getByRole('textbox',{name:lang==='zh'?'搜索标签':'Search tags',exact:true}).press('Escape');
    await expect(page.getByRole('button',{name:lang==='zh'?'管理标签':'Manage tags',exact:true})).toBeFocused();
    await go(page,'r8-dashboard',lang,theme);
    const kind=page.locator('.ll-toolbar .kind');
    await kind.click();
    const menu=page.locator('.menu:popover-open');
    await expect(menu).toBeVisible();
    await menu.press('End');
    await expect(menu.getByRole('menuitemradio').last()).toBeFocused();
    await menu.press('Home');
    await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
    await inspect(page,`kind-menu-${lang}`,true);
    await menu.press('Escape');
    await expect(kind).toBeFocused();
    await page.locator('.cmp-options .expiry > button:visible').click();
    await page.getByRole('menuitemradio',{name:/自定义|Pick a time/}).click();
    await expect(page.locator('.r4-date:visible')).toBeVisible();
    await inspect(page,`date-open-${lang}`,true);
    await page.close();
  }
  if(!quick && !settingsOnly && !reviewOnly) {
    for(const [width,height] of textOnly ? [] : [[320,740],[768,900],[390,300],[640,900]]) {
      const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'});
      for(const scene of ['r8-settings','r5-socks','r7-tags','r7-edit','r8-dashboard']){
        await go(page,scene,'en','dark',scene==='r5-socks'?'metadata':scene==='r8-settings'?'defaults':'');
        await inspect(page,`${scene}-boundary-${width}-${height}`);
      }
      await go(page,'r8-dashboard','en','dark');
      await page.locator('.ll-toolbar .kind').click();
      await inspect(page,`menu-boundary-${width}-${height}`,height===300);
      const bounds=await page.locator('.menu:popover-open').boundingBox();
      assert.ok(bounds.y>=7 && bounds.y+bounds.height<=height-7,'menu must stay inside short viewport');
      await page.close();
    }
    // Same fixtures and viewport: control-only compacting versus final spacing/units.
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const ablation=[];
    for(const revision of ['r9','density-only','r10']){
      await go(page,'r8-settings','zh','light','defaults',revision==='density-only'?'r9':revision);
      if(revision==='density-only')await page.addStyleTag({content:':root{--control-compact:36px;--control-field:40px}.r6-length-input .field{height:36px;min-height:36px;width:54px}.r5-route .seg{width:max-content}.r5-route .seg>button{flex:none;min-width:0}'});
      ablation.push(await page.evaluate(revision=>({revision,input:(()=>{const e=document.querySelector('#r6-slugLength'),r=e.getBoundingClientRect();return {width:r.width,height:r.height,font:getComputedStyle(e).fontSize}})(),rowHeight:document.querySelector('.r6-length-row').getBoundingClientRect().height,sectionHeight:document.querySelector('#r6-defaults').getBoundingClientRect().height,segmentHeight:document.querySelector('.r5-route .seg').getBoundingClientRect().height}),revision));
      await page.screenshot({path:resolve(out,`comparison-${revision}.png`)});
    }
    writeFileSync(resolve(out,'ablation.json'),JSON.stringify(ablation,null,2));
    // Enlarge the same controls regardless of selector specificity; this is not browser zoom.
    await page.addStyleTag({content:'.hint,.k,.btn,.field,.seg>button{font-size:26px!important}'});
    await inspect(page,'large-text-stress');
    await page.close();
  }
  if(!quick && !settingsOnly && !textOnly && !process.argv.includes('--flows')) {
    const page=await browser.newPage({viewport:{width:1440,height:1100}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`${base}/review-r10.html`,{waitUntil:'networkidle'});
    await expect(page.frameLocator('#after').locator('#r6-slugLength')).toBeVisible();
    assert.equal(await page.evaluate(()=>window.scrollY),0,'embedded focus must not scroll the review page');
    await page.screenshot({path:resolve(out,'review-desktop.png')});
    await page.getByRole('button',{name:'English',exact:true}).click();
    await page.getByRole('button',{name:'深色',exact:true}).click();
    await page.getByRole('button',{name:'连接与密码',exact:true}).click();
    await expect(page.frameLocator('#after').getByRole('radio',{name:'SOCKS5'})).toHaveAttribute('aria-checked','true');
    assert.equal(await page.evaluate(()=>window.scrollY),0,'scene changes must keep the review controls in view');
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'数字与单位',exact:true}).click();
    await expect(page.frameLocator('#after').locator('#r6-slugLength')).toBeVisible();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'review page must fit mobile');
    await page.screenshot({path:resolve(out,'review-mobile.png')});
    await page.close();
  }
} catch(e) { failures.push(e.stack); }
finally {
  await browser.close();
  writeFileSync(resolve(out,'results.json'),JSON.stringify({results,failures,errors},null,2));
  writeFileSync(resolve(out,'content-captures.json'),JSON.stringify(captures));
}
console.log(JSON.stringify({states:results.length,failures:failures.length,errors:[...new Set(errors)],output:out}));
if(failures.length)console.log(JSON.stringify(failures,null,2));
assert.equal(errors.length,0,'browser errors');
assert.equal(failures.length,0,'render/interaction failures');
