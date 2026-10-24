<script lang="ts">
  import { t } from '../lib/i18n.svelte';
  import { validMaxClicks } from '../lib/max-clicks';
  import AccessPopover from './AccessPopover.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  let { value = $bindable(''), id, triggerClass = 'opt' }: { value?: string; id: string; triggerClass?: string } = $props();

  let draft = $state('');
  let invalid = $state(false);

  function done(close: () => void) {
    if (!validMaxClicks(draft)) {
      invalid = true;
      return;
    }
    value = draft.trim();
    close();
  }
</script>

<AccessPopover
  label={t('composer.maxClicks')}
  width={240}
  triggerClass={[triggerClass, value && 'set'].filter(Boolean).join(' ')}
  onopen={() => ((draft = value), (invalid = false))}
>
  {#snippet trigger()}
    <Icon name="gauge" size={14} />
    {value ? t('access.visits', { n: Number(value) }) : t('access.noLimit')}
  {/snippet}
  {#snippet children(close)}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="body"
      role="group"
      onkeydown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).matches('input')) {
          e.preventDefault();
          done(close);
        }
      }}
    >
      <label class="title" for="{id}-limit">{t('composer.maxClicks')}</label>
      <div class={['field', invalid && 'invalid']}>
        <input
          id="{id}-limit"
          bind:value={draft}
          inputmode="numeric"
          placeholder={t('access.noLimit')}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-limit-error` : undefined}
          oninput={() => (invalid = false)}
        />
        <span class="unit" aria-hidden="true">{t('access.unit')}</span>
      </div>
      {#if invalid}<p class="error-text" id="{id}-limit-error">{t('err.max_clicks_invalid')}</p>{/if}
      <div class="foot">
        {#if value}<Button size="sm" variant="ghost" onclick={() => ((value = ''), close())}>{t('access.noLimit')}</Button>{/if}
        <span class="gap"></span>
        <Button size="sm" variant="ghost" onclick={close}>{t('act.cancel')}</Button>
        <Button size="sm" variant="primary" onclick={() => done(close)}>{t('access.done')}</Button>
      </div>
    </div>
  {/snippet}
</AccessPopover>

<style>
  .body {
    display: grid;
    gap: 8px;
    padding: 8px 8px 4px;
    font-size: 13px;
  }

  .title {
    font-weight: 600;
  }

  .field {
    display: flex;
    align-items: center;
    height: var(--control-field);
    padding: 0 10px;
    border-radius: var(--radius);
    background: var(--surface);
    --hbt: var(--line-2); --hbr: var(--line-2); --hbb: var(--line-2); --hbl: var(--line-2);
  }

  .field:focus-within {
    --hbt: var(--accent); --hbr: var(--accent); --hbb: var(--accent); --hbl: var(--accent);
    box-shadow: var(--hair-shadow), 0 0 0 2px var(--accent-line);
  }

  .field.invalid {
    --hbt: var(--danger-line); --hbr: var(--danger-line); --hbb: var(--danger-line); --hbl: var(--danger-line);
  }

  .field input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    outline: none;
    background: transparent;
    font-variant-numeric: tabular-nums;
  }

  .unit {
    color: var(--text-2);
  }

  .error-text {
    margin: 0;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 4px -4px 0;
    padding-top: 8px;
    --hbt: var(--line);
  }

  .gap {
    flex: 1;
  }
</style>
