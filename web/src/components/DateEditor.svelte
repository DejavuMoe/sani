<script lang="ts">
  import { untrack } from 'svelte';
  import { clock } from '../lib/clock.svelte';
  import { i18n, t } from '../lib/i18n.svelte';
  import { toLocalInput, validLocalExpiry } from '../lib/expiry';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import MenuItem from './MenuItem.svelte';

  const generatedId = $props.id();
  let { value, onchange, oncancel, id = generatedId }: { value: string; onchange: (value: string) => void; oncancel: () => void; id?: string } = $props();
  let date = $state(untrack(() => value.slice(0, 10)));
  let time = $state(untrack(() => value.slice(11, 16)));
  let timeEntry: HTMLDivElement;
  const pad = (n: number) => String(n).padStart(2, '0');
  const selected = $derived([24, 60].map((limit, i) => {
    const part = time.split(':')[i] ?? '';
    return /^\d{2}$/.test(part) && Number(part) < limit ? Number(part) : null;
  }));

  function chooseTime(column: number, n: number) {
    const next = selected.map(value => value ?? 0);
    next[column] = n;
    time = next.map(pad).join(':');
  }

  $effect(() => {
    const menu = timeEntry.querySelector('[popover]')!;
    let frame: number;
    const reveal = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'open') return;
      frame = requestAnimationFrame(() => {
        for (const list of menu.querySelectorAll<HTMLElement>('.time-options')) {
          const checked = list.querySelector<HTMLElement>('[aria-checked="true"]');
          if (checked) list.scrollTop += checked.getBoundingClientRect().top - list.getBoundingClientRect().top - (list.clientHeight - checked.offsetHeight) / 2;
        }
      });
    };
    menu.addEventListener('toggle', reveal);
    return () => { menu.removeEventListener('toggle', reveal); cancelAnimationFrame(frame); };
  });

  function timeKeys(e: KeyboardEvent) {
    const column = (e.target as HTMLElement).closest('[data-time-column]');
    if (!column) return;
    const options = [...column.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const current = options.indexOf(document.activeElement as HTMLElement);
    let target: HTMLElement | null | undefined;
    if (e.key === 'ArrowDown') target = options[(current + 1) % options.length];
    if (e.key === 'ArrowUp') target = options[(current - 1 + options.length) % options.length];
    if (e.key === 'Home') target = options[0];
    if (e.key === 'End') target = options[options.length - 1];
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const sibling = column.parentElement!.querySelector(`[data-time-column="${e.key === 'ArrowLeft' ? 0 : 1}"]`)!;
      target = sibling.querySelector<HTMLElement>('[aria-checked="true"]') ?? sibling.querySelector<HTMLElement>('[role="menuitemradio"]');
    }
    if (current < 0 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) target = column.querySelector<HTMLElement>('[aria-checked="true"]') ?? options[0];
    if (target) { e.preventDefault(); e.stopPropagation(); target.focus(); }
  }
  let month = $state(untrack(() => {
    const d = new Date(value);
    return Number.isNaN(+d) ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(d.getFullYear(), d.getMonth(), 1);
  }));
  const candidate = $derived(`${date}T${time}`);
  const valid = $derived(validLocalExpiry(candidate, clock.now));
  const first = $derived((month.getDay() + 6) % 7);
  const days = $derived(new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate());
  function dateFor(n: number) { return toLocalInput(new Date(month.getFullYear(), month.getMonth(), n, 12)).slice(0,10); }
  function move(n: number) { month = new Date(month.getFullYear(), month.getMonth() + n, 1); }
  function apply() {
    if (!validLocalExpiry(candidate, Date.now())) return;
    const selected = new Date(candidate);
    month = new Date(selected.getFullYear(), selected.getMonth(), 1);
    onchange(candidate);
  }
  function applyOnEnter(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    apply();
  }
</script>

<div class="date-editor">
  <div class="calendar-head"><Button size="sm" icon="chevronLeft" aria-label={t('calendar.previous')} onclick={() => move(-1)} /><span>{month.toLocaleDateString(i18n.lang === 'zh' ? 'zh-CN' : 'en', { year: 'numeric', month: 'long' })}</span><Button size="sm" icon="chevronRight" aria-label={t('calendar.next')} onclick={() => move(1)} /></div>
  <div class="calendar" role="group" aria-label={t('calendar.choose')}>
    {#each (i18n.lang === 'zh' ? ['一', '二', '三', '四', '五', '六', '日'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']) as day}<span aria-hidden="true">{day}</span>{/each}
    {#each Array(first) as _}<span aria-hidden="true"></span>{/each}
    {#each Array(days) as _, i}<button type="button" aria-label={dateFor(i+1)} aria-pressed={date === dateFor(i+1)} onclick={() => date = dateFor(i+1)}>{i+1}</button>{/each}
  </div>
  <div class="date-fields">
    <div class="input"><label for="{id}-date">{t('calendar.date')}</label><input id="{id}-date" class="field" placeholder="YYYY-MM-DD" bind:value={date} onkeydown={applyOnEnter} aria-invalid={!valid || undefined} aria-describedby={!valid ? `${id}-error` : undefined} /></div>
    <div class="input"><label for="{id}-time">{t('calendar.time')}</label><div class="time-entry" bind:this={timeEntry}>
      <input id="{id}-time" class="field" placeholder="HH:mm" bind:value={time} onkeydown={applyOnEnter} aria-invalid={!valid || undefined} aria-describedby={!valid ? `${id}-error` : undefined} />
      <Menu triggerClass="time-trigger" label={t('calendar.chooseTime')} minWidth={224} align="end">
        {#snippet button()}<Icon name="clock" size={14} />{/snippet}
        {#snippet children(close)}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="time-columns" onkeydown={timeKeys}>
            {#each [24, 60] as count, column}
              <div data-time-column={column}>
                <div class="time-column-label" aria-hidden="true">{t(column === 0 ? 'calendar.hours' : 'calendar.minutes')}</div>
                <!-- Scroll regions remain keyboard reachable even when their menu items have tabindex=-1. -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <div class="time-options" role="group" aria-label={t(column === 0 ? 'calendar.hours' : 'calendar.minutes')} tabindex="0">
                  {#each Array(count) as _, n}<MenuItem checked={selected[column] === n} onclick={() => chooseTime(column, n)}>{pad(n)}</MenuItem>{/each}
                </div>
              </div>
            {/each}
          </div>
          <div class="sep" role="separator"></div>
          <div class="time-done"><MenuItem onclick={close}>{t('calendar.done')}</MenuItem></div>
        {/snippet}
      </Menu>
    </div></div>
  </div>
  {#if !valid}<p id="{id}-error" class="error-text" role="alert">{t('calendar.invalid')}</p>{/if}
  <p class="hint">{t('calendar.zone')}</p>
  <div class="foot"><Button size="sm" variant="ghost" onclick={oncancel}>{t('act.cancel')}</Button><Button size="sm" variant="primary" disabled={!valid} onclick={apply}>{t('calendar.apply')}</Button></div>
</div>

<style>
  /* Same insets and footer as the limit and password popovers beside it. */
  .date-editor { display: grid; grid-template-columns: minmax(0,1fr); gap: 8px; min-width: 0; width: 100%; padding: 8px 8px 4px; }
  .date-fields { display: grid; grid-template-columns: minmax(0,1fr) 112px; gap: 8px; }
  .input { display: grid; gap: 7px; min-width: 0; }
  label { font-size: 13px; color: var(--text-2); }
  .field { width: 100%; min-width: 0; }
  .hint, .error-text { font-size: 12px; }
  .calendar-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .calendar { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; }
  .calendar > span { text-align: center; font-size: 12px; color: var(--text-3); padding: 5px 0; }
  .calendar button { min-height: 32px; border-radius: var(--radius-xs); aspect-ratio: 1; font-size: 12px; }
  .calendar button:hover { background: var(--surface-2); }
  .calendar button[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); box-shadow: var(--hair-shadow), inset 0 0 0 0.5px var(--accent-line); }
  .foot { display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin: 4px -4px 0; padding-top: 8px; --hbt: var(--line); }
  .time-entry { position: relative; min-width: 0; }
  .time-entry > input { padding-right: 34px; font-variant-numeric: tabular-nums; }
  .time-entry :global(.time-trigger) { position: absolute; right: 2px; top: 2px; bottom: 2px; width: 28px; display: grid; place-items: center; color: var(--text-2); border-radius: var(--radius-sm); }
  .time-entry :global(.time-trigger:hover), .time-entry :global(.time-trigger[aria-expanded='true']) { background: var(--surface-2); color: var(--text); }
  .time-entry :global(.time-trigger:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
  .time-entry :global(.menu) { width: 224px; }
  /* In dark both layers are surface-2; a stronger edge keeps the menu apart from the popover under it. */
  :global([data-theme='dark']) .time-entry :global([popover].menu) { --hbt: var(--line-3); --hbr: var(--line-3); --hbb: var(--line-3); --hbl: var(--line-3); }
  .time-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 4px; }
  .time-column-label { padding: 4px 8px 8px; color: var(--text-2); font-size: 12px; }
  .time-options { height: 180px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line-3) transparent; }
  .time-options :global(.item) { font-variant-numeric: tabular-nums; }
  .sep { height: 0.5px; margin: 4px 6px; background: var(--line); }
</style>
