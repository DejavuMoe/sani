import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const base = 'http://127.0.0.1:18769';
const password = 'local-r7-fixture';
const axe = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const collector = readFileSync('../.agents/skills/prototype-first-ui/scripts/collect_dom_content.js','utf8');
let server: ChildProcess;
test.beforeAll(async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('SANI_')) delete env[key];
  server = spawn('../bin/sani', [], { env: { ...env, SANI_DATA_DIR: mkdtempSync(join(tmpdir(),'sani-r7-')), SANI_LISTEN:'127.0.0.1:18769', SANI_FILES_URL:'http://localhost:18769', SANI_PASSWORD:password, SANI_FETCH_META:'false', SANI_LOG_LEVEL:'error' }, stdio:'ignore' });
  await expect.poll(async () => { try { return (await fetch(`${base}/healthz`)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => { if (server?.exitCode === null) await new Promise<void>(resolve=>{server.once('exit',()=>resolve());server.kill('SIGTERM');}); });
async function login(page: Page, lang='en', theme='light') {
  await page.addInitScript(({lang,theme})=>{localStorage.setItem('sani.lang',lang);localStorage.setItem('sani.theme',theme);},{lang,theme});
  expect((await page.request.post(`${base}/api/admin/v1/session`,{data:{password}})).ok()).toBe(true);
}
async function audit(page: Page) {
  for (const dialog of await page.locator('dialog[open]').all()) await expect(dialog).toHaveCSS('opacity', '1');
  await page.evaluate(axe);
  expect(await page.evaluate(async()=> (await (window as any).axe.run(document,{resultTypes:['violations']})).violations.map((v:any)=>({id:v.id,nodes:v.nodes.map((n:any)=>n.target)})))).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}
async function capture(page: Page, name: string) {
  await page.evaluate(collector);
  writeFileSync(test.info().outputPath(`content-${name}.json`),JSON.stringify(await page.evaluate(()=>(window as any).__prototypeFirstUICollectDOMContent())));
}
const failed = {status:503,contentType:'application/json',body:JSON.stringify({error:{code:'internal',message:'temporary failure'}})};

for (const lang of ['zh', 'en']) for (const theme of ['light', 'dark']) {
  test(`resource menus stay in the viewport with pointer and keyboard: ${lang} ${theme}`, async ({page}) => {
    await login(page, lang, theme);
    expect((await page.request.post(`${base}/api/admin/v1/links`, {data:{url:'https://example.org/menu'}})).ok()).toBe(true);
    for (const viewport of [{width:1280,height:860}, {width:390,height:300}]) {
      await page.setViewportSize(viewport);
      await page.goto(`${base}/admin/`);
      const trigger = page.locator('button.kind');
      await trigger.click();
      const menu = page.locator('.menu:popover-open');
      await expect(menu).toBeVisible();
      const fits = () => menu.evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.top >= 7 && r.bottom <= innerHeight - 7 && r.left >= 7 && r.right <= innerWidth - 7;
      });
      await expect.poll(fits).toBe(true);
      await page.keyboard.press('End');
      await expect(menu.getByRole('menuitemradio').last()).toBeFocused();
      await page.keyboard.press('Home');
      await expect(menu.getByRole('menuitemradio').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await trigger.press('Enter');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveCSS('opacity', '1');
      await expect.poll(fits).toBe(true);
      await audit(page);
      await page.screenshot({path:test.info().outputPath(`menu-${viewport.width}.png`)});
      await page.keyboard.press('Enter');
      await expect(menu).not.toBeVisible();
      await expect(page.locator('.menu:visible')).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await audit(page);
    }
  });
}

test('tag Enter chooses the exact normalized match; manager deletion retries and keeps all content', async ({page})=>{
  await login(page);
  for (const name of ['devops','dev','Café']) await page.request.post(`${base}/api/admin/v1/tags`,{data:{name,color:'blue'}});
  const tag=(await (await page.request.post(`${base}/api/admin/v1/tags`,{data:{name:'remove-global'}})).json()).id;
  const link=await (await page.request.post(`${base}/api/admin/v1/links`,{data:{url:'https://example.com/r7',tags:[tag]}})).json();
  const text=await (await page.request.post(`${base}/api/admin/v1/texts`,{data:{text:'Retain this body',tags:[tag]}})).json();
  const file=await (await page.request.post(`${base}/api/admin/v1/files`,{multipart:{tags:JSON.stringify([tag]),file:{name:'keep.txt',mimeType:'text/plain',buffer:Buffer.from('retain bytes')}}})).json();
  await page.goto(`${base}/admin/`);
  await page.locator('#create-panel-url .tag-add').click();
  const pop=page.locator('.tag-pop:popover-open');
  const search=pop.getByLabel('Search or create a tag');
  await search.fill('DEV');await search.press('Enter');
  await expect(pop.getByRole('checkbox',{name:'dev',exact:true})).toHaveAttribute('aria-checked','true');
  await expect(pop.getByRole('checkbox',{name:'devops',exact:true})).toHaveAttribute('aria-checked','false');
  await search.fill('Cafe\u0301');await search.press('Enter');
  await expect(pop.getByRole('checkbox',{name:'Café',exact:true})).toHaveAttribute('aria-checked','true');
  await pop.getByRole('button',{name:'Manage tags',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'Manage tags',exact:true});
  await manager.getByRole('button',{name:'Delete tag remove-global',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'Delete tag “remove-global”?',exact:true});
  await expect(confirm).toContainText('3 items');
  await page.route(`**/api/admin/v1/tags/${tag}`,route=>route.request().method()==='DELETE'?route.fulfill(failed):route.continue());
  await confirm.getByRole('button',{name:'Delete tag',exact:true}).click();await expect(confirm.getByRole('alert')).toBeVisible();
  await capture(page,'tag-delete-error');
  expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}`)).json()).tags).toEqual([tag]);
  await page.unroute(`**/api/admin/v1/tags/${tag}`);await confirm.getByRole('button',{name:'Retry deletion',exact:true}).click();
  await expect(confirm).not.toBeVisible();await expect(manager.getByLabel('Search tags')).toBeFocused();
  for (const item of [link,text,file]) {const res=await page.request.get(`${base}/api/admin/v1/links/${item.id}`);expect(res.ok()).toBe(true);expect((await res.json()).tags).toEqual([]);}
  await manager.getByRole('button',{name:'Close',exact:true}).click();await expect(page.locator('#create-panel-url .tag-add')).toBeFocused();
});

test('slow creation locks submitted fields, failure preserves the draft, and editing has one leave guard', async ({page})=>{
  await login(page);await page.goto(`${base}/admin/`);
  let release!:()=>void;const held=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/admin/v1/links',async route=>{if(route.request().method()==='POST'){await held;await route.fulfill(failed);}else await route.continue();});
  await page.locator('#composer-url').fill('https://example.com/draft');await page.locator('#create-panel-url .go').click();
  await expect(page.locator('#composer-url')).toBeDisabled();await expect(page.locator('#composer-slug')).toBeDisabled();
  release();await expect(page.locator('#composer-url')).toBeEnabled();await expect(page.locator('#composer-url')).toHaveValue('https://example.com/draft');
  await page.unroute('**/api/admin/v1/links');
  const link=await (await page.request.post(`${base}/api/admin/v1/texts`,{data:{text:'Original body',slug:'r7-edit'}})).json();
  await page.reload();const row=page.locator('.row',{hasText:'/p/r7-edit'});await row.locator('button.main').click();await row.getByRole('button',{name:/^Edit/}).click();
  const body=page.locator(`#edit-text-${link.id}`);await body.fill('Keep my changed body');
  await page.getByRole('link',{name:'Settings',exact:true}).click();const guard=page.getByRole('dialog',{name:'Save changes before leaving?'});
  await capture(page,'edit-leave');
  await guard.getByRole('button',{name:'Keep editing'}).click();await expect(body).toHaveValue('Keep my changed body');
  await page.route(`**/api/admin/v1/links/${link.id}`,route=>route.request().method()==='PATCH'?route.fulfill(failed):route.continue());
  await body.press('Escape');await guard.getByRole('button',{name:'Save and leave'}).click();
  await expect(page.locator('.editor .error-text')).toBeVisible();await expect(body).toHaveValue('Keep my changed body');
  await capture(page,'edit-error');
  await page.unroute(`**/api/admin/v1/links/${link.id}`);await page.getByRole('link',{name:'Settings',exact:true}).click();await guard.getByRole('button',{name:'Save and leave'}).click();
  await expect(page).toHaveURL(/settings$/);expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}/text`)).json()).text).toBe('Keep my changed body');
});

test('query and statistics errors offer retry without presenting empty data or a false range', async ({page})=>{
  await login(page);await page.request.post(`${base}/api/admin/v1/texts`,{data:{text:'Statistics fixture',slug:'r7-query'}});
  await page.goto(`${base}/admin/`);await expect(page.locator('.row').first()).toBeVisible();
  await page.route('**/api/admin/v1/links?*',route=>route.fulfill(failed));await page.getByRole('searchbox').fill('r7-query');
  await expect(page.locator('.list-section [role=alert]')).toContainText('Filtering failed');await expect(page.locator('.list-section .pick')).toBeDisabled();
  await capture(page,'query-error');
  await page.unroute('**/api/admin/v1/links?*');await page.locator('.list-section [role=alert]').getByRole('button',{name:'Retry'}).click();await expect(page.locator('.row')).toHaveCount(1);
  await page.locator('.row button.main').click();await expect(page.locator('.detail .chart-placeholder')).toHaveCount(0);
  await page.route('**/api/admin/v1/links/*/stats?*',route=>route.fulfill(failed));await page.locator('.detail').getByRole('radio',{name:'7 days',exact:true}).click();
  await expect(page.locator('.detail [role=alert]')).toContainText('last 30 days');
  await capture(page,'stats-stale');
  await page.unroute('**/api/admin/v1/links/*/stats?*');await page.locator('.detail [role=alert]').getByRole('button',{name:'Retry'}).click();await expect(page.locator('.detail [role=alert]')).toHaveCount(0);
});

test('token failure is unknown, and import downloads every skipped row', async ({page})=>{
  await login(page);await page.route('**/api/admin/v1/tokens',route=>route.fulfill(failed));await page.goto(`${base}/admin/settings`);
  await expect(page.getByRole('alert')).toContainText('token count is unknown');
  await expect(page.getByRole('button',{name:'Create token',exact:true})).toBeDisabled();
  await capture(page,'tokens-error');
  await page.unroute('**/api/admin/v1/tokens');await page.getByRole('alert').getByRole('button',{name:'Retry'}).click();await expect(page.getByText('No tokens yet',{exact:true})).toBeVisible();
  await page.locator('input[type=file]').setInputFiles({name:'skips.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({app:'sani',version:1,links:Array.from({length:27},(_,i)=>({slug:`bad-${i}`,url:'javascript:bad'}))}))});
  const result=page.locator('.import-result');await expect(result).toContainText('Skipped 27');
  await capture(page,'settings-import');
  const waiting=page.waitForEvent('download');await result.getByRole('button',{name:'Download all skipped records (27)'}).click();const downloaded=await waiting;
  expect(JSON.parse(readFileSync((await downloaded.path())!,'utf8'))).toHaveLength(27);
});

test('browser back and list search preserve a dirty editor until an explicit choice', async ({page}) => {
  await login(page);
  const link = await (await page.request.post(`${base}/api/admin/v1/texts`, {data:{text:'History fixture',slug:'r7-history'}})).json();
  await page.goto(`${base}/admin/settings`);
  await page.getByRole('link',{name:'Back',exact:true}).click();
  const row = page.locator('.row',{hasText:'/p/r7-history'});
  await row.locator('button.main').click();await row.getByRole('button',{name:/^Edit/}).click();
  const body = page.locator(`#edit-text-${link.id}`);
  await body.fill('Do not lose this draft');
  const guard = page.getByRole('dialog',{name:'Save changes before leaving?'});
  await page.getByRole('searchbox').fill('another query');
  await guard.getByRole('button',{name:'Keep editing'}).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(body).toHaveValue('Do not lose this draft');
  await page.goBack();
  await expect(guard).toBeVisible();
  await guard.getByRole('button',{name:'Keep editing'}).click();
  await expect(page).toHaveURL(/admin\/$/);await expect(body).toHaveValue('Do not lose this draft');
  await page.goBack();await guard.getByRole('button',{name:'Discard changes'}).click();
  await expect(page).toHaveURL(/settings$/);
  expect((await (await page.request.get(`${base}/api/admin/v1/links/${link.id}/text`)).json()).text).toBe('History fixture');
});

test('an uploading file stays locked but can be canceled without losing its draft', async ({page}) => {
  await login(page);await page.goto(`${base}/admin/`);await page.getByRole('tab',{name:'Files',exact:true}).click();
  const panel = page.getByRole('tabpanel',{name:'Files',exact:true});
  await panel.locator('input[type=file]').setInputFiles({name:'cancel-me.txt',mimeType:'text/plain',buffer:Buffer.from('retain upload draft')});
  let release!:()=>void;const held = new Promise<void>(resolve => release=resolve);
  await page.route('**/api/admin/v1/files',async route => { await held; await route.abort(); });
  try {
    await panel.locator('.go').click();
    await expect(panel.locator('.slug input')).toBeDisabled();
    await capture(page,'upload-busy');
    await panel.locator('.cancel-upload').click();
    await expect(panel.locator('.slug input')).toBeEnabled();
    await expect(panel).toContainText('cancel-me.txt');
  } finally { release(); }
});

for (const [lang,theme,width] of [['zh','light',1280],['en','dark',390],['zh','dark',320],['en','light',1280]] as const) {
  test(`R9 control groups and expanded controls ${lang}/${theme}/${width}`,async({page},info)=>{
    await login(page,lang,theme);await page.request.post(`${base}/api/admin/v1/tags`,{data:{name:'dev'}});expect((await page.request.post(`${base}/api/admin/v1/links`,{data:{url:`https://example.com/r9/${lang}/${theme}/${width}`}})).ok()).toBe(true);await page.setViewportSize({width,height:900});await page.goto(`${base}/admin/`);
    const compact = width <= 640 ? 44 : 32, field = width <= 640 ? 44 : 36;
    const heights = async (selector: string, height: number) => {
      const controls = page.locator(selector);
      expect(await controls.count(), selector).toBeGreaterThan(0);
      for (const control of await controls.all()) await expect(control).toHaveCSS('height', `${height}px`);
    };
    await expect(page.locator('.tag-manage-trigger')).toBeVisible();
    await heights('.toolbar .search,.toolbar .pick,.toolbar .kind,.toolbar .sort,.tag-filters .tag-filter', compact);
    await page.locator('.toolbar .kind').press('Enter');
    const menu = page.locator('.menu:popover-open');
    await expect(menu.getByRole('menuitemradio')).toHaveText(lang === 'zh' ? ['全部类型','链接','文本','文件'] : ['All types','Links','Text','Files']);
    for (const option of await menu.getByRole('menuitemradio').all()) await expect(option).toHaveCSS('min-height', `${width <= 640 ? 44 : 38}px`);
    await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
    await page.locator('#create-panel-url .tag-add').click();
    await expect(page.locator('.tag-pop:popover-open .tag-manage-row')).toHaveCSS('min-height', `${width <= 640 ? 44 : 38}px`);
    await page.screenshot({path:info.outputPath('tag-picker.png')});
    await page.locator('.tag-pop:popover-open .tag-manage-row').press('Enter');const manager=page.getByRole('dialog',{name:lang==='zh'?'管理标签':'Manage tags',exact:true});
    await expect(manager).toBeVisible();await audit(page);
    await heights('.tag-manager-search,.tag-manager-tools .seg', field);
    await heights('.tag-manager-tools .seg button', field - 4);
    if (width > 640) {
      const search = (await manager.locator('.tag-manager-search').boundingBox())!, range = (await page.locator('.tag-manager-tools .seg').boundingBox())!;
      expect(Math.abs(search.y - range.y)).toBeLessThanOrEqual(1);
    }
    await capture(page,`tags-${lang}-${theme}-${width}`);
    await page.screenshot({path:info.outputPath(`tags-${lang}-${theme}-${width}.png`)});
    await manager.getByRole('radio',{name:lang==='zh'?'全部':'All',exact:true}).press('ArrowRight');
    await manager.getByRole('radio',{name:lang==='zh'?'未使用':'Unused',exact:true}).click();await audit(page);
    const edit=manager.getByRole('button',{name:lang==='zh'?'编辑标签 dev':'Edit tag dev',exact:true});await edit.press('Enter');
    const child=page.getByRole('dialog',{name:lang==='zh'?'编辑标签':'Edit tag',exact:true});await expect(child).toBeVisible();await audit(page);
    await heights('.tag-manager-edit > .field,.tag-manager-edit .color-input .field,.tag-manager-edit .color-preview', field);
    await heights('.tag-manager-edit .dialog-actions .btn', compact);
    await capture(page,`tag-edit-${lang}-${theme}-${width}`);
    await page.screenshot({path:info.outputPath(`tag-edit-${lang}-${theme}-${width}.png`)});
    await child.getByRole('button',{name:lang==='zh'?'取消':'Cancel',exact:true}).click();await expect(edit).toBeFocused();
    await manager.getByRole('button',{name:lang==='zh'?'关闭':'Close',exact:true}).click();
    for (const [kind,label] of [['text',lang==='zh'?'文本':'Text'],['file',lang==='zh'?'文件':'Files']]) {
      await page.getByRole('tab',{name:label,exact:true}).click();
      await heights(`#create-panel-${kind} .opt,#create-panel-${kind} .slug .box,#create-panel-${kind} .go`,compact);
    }
    await page.goto(`${base}/admin/settings`);
    await heights('.inline-form .field,.inline-form .btn,.length-input input',field);
    const typography = await page.locator('.about dd').evaluateAll(elements=>elements.map(el=>({font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize})));
    expect(typography).toHaveLength(3);expect(typography[1]).toEqual(typography[0]);expect(typography[2]).toEqual(typography[0]);
    for (const row of await page.locator('.about > div').all()) await expect(row).toHaveCSS('column-gap','12px');
    await capture(page,`settings-${lang}-${theme}-${width}`);
    await audit(page);await page.locator('.about').scrollIntoViewIfNeeded();
    await page.screenshot({path:info.outputPath('about.png')});
  });
}


test('narrow tag toolbars keep management and more actions for every small catalog size', async ({page}) => {
  await login(page);
  for (const width of [320,390]) for (let count=0;count<=5;count++) {
    await page.route('**/api/admin/v1/tags', async route => {
      const response = await route.fetch();
      const catalog = await response.json();
      catalog.items = Array.from({length:count},(_,i)=>({id:100+i,name:`tag-${i}`,color:'blue',count:0}));
      await route.fulfill({response,json:catalog});
    });
    await page.setViewportSize({width,height:900});await page.goto(`${base}/admin/`);
    const manage=page.locator('.tag-manage-trigger');
    await expect(manage).toBeVisible();
    await expect(page.getByRole('button',{name:'More tags',exact:true})).toBeVisible();
    await manage.press('Enter');
    const dialog=page.getByRole('dialog',{name:'Manage tags',exact:true});await expect(dialog).toBeVisible();
    await dialog.getByRole('button',{name:'Close',exact:true}).click();await expect(manage).toBeFocused();
    await page.unroute('**/api/admin/v1/tags');
  }
});
