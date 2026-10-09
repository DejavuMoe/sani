<script lang="ts">
  import { untrack } from 'svelte';
  import { clock } from '../lib/clock.svelte';
  import { i18n, t } from '../lib/i18n.svelte';
  import { toLocalInput, validLocalExpiry } from '../lib/expiry';
  import Button from './Button.svelte';

  const generatedId = $props.id();
  let { value, onchange, id = generatedId }: { value: string; onchange: (value: string) => void; id?: string } = $props();
  let date = $state(untrack(() => value.slice(0, 10)));
  let time = $state(untrack(() => value.slice(11, 16)));
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
    <div class="input"><label for="{id}-time">{t('calendar.time')}</label><input id="{id}-time" class="field" placeholder="HH:mm" bind:value={time} onkeydown={applyOnEnter} aria-invalid={!valid || undefined} aria-describedby={!valid ? `${id}-error` : undefined} /></div>
  </div>
  {#if !valid}<p id="{id}-error" class="error-text" role="alert">{t('calendar.invalid')}</p>{/if}
  <p class="hint">{t('calendar.zone')}</p>
  <Button size="sm" disabled={!valid || candidate === value} onclick={apply}>{t('calendar.apply')}</Button>
</div>

<style>
  .date-editor { display: grid; grid-template-columns: minmax(0,1fr); gap: 12px; min-width: 0; width: 280px; max-width: 100%; padding: 14px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); flex-basis: 100%; }
  .date-fields { display: grid; grid-template-columns: minmax(0,1fr) 82px; gap: 8px; }
  .input { display: grid; gap: 7px; min-width: 0; }
  label { font-size: 13px; color: var(--text-2); }
  .field { width: 100%; min-width: 0; }
  .hint, .error-text { font-size: 11px; }
  .calendar-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  .calendar { display: grid; grid-template-columns: repeat(7,1fr); gap: 2px; }
  .calendar > span { text-align: center; font-size: 10px; color: var(--text-3); padding: 5px 0; }
  .calendar button { min-height: 36px; border-radius: var(--radius-xs); aspect-ratio: 1; font-size: 12px; }
  .calendar button:hover { background: var(--surface-2); }
  .calendar button[aria-pressed='true'] { background: var(--accent-soft); color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent-line); }
</style>
