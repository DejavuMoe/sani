<script lang="ts">
  import { generatePassword, validPassword } from '../lib/access';
  import { t } from '../lib/i18n.svelte';
  import AccessPopover from './AccessPopover.svelte';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';

  let { value = $bindable(''), id, triggerClass = 'opt' }: { value?: string; id: string; triggerClass?: string } = $props();

  let draft = $state('');
  let invalid = $state(false);

  // Opening an empty picker offers a fresh code, selected, so Enter accepts it.
  function onopen() {
    draft = value || generatePassword();
    invalid = false;
  }

  function done(close: () => void) {
    if (!validPassword(draft)) {
      invalid = true;
      return;
    }
    value = draft.trim();
    close();
  }
</script>

<AccessPopover label={t('access.password')} triggerClass={[triggerClass, value && 'set'].filter(Boolean).join(' ')} {onopen}>
  {#snippet trigger()}
    <Icon name="lock" size={14} />
    {#if value}<span class="code">{value}</span>{:else}{t('access.noPassword')}{/if}
  {/snippet}
  {#snippet children(close)}
    <!-- Not a form: this sits inside the composer's form, and Enter must not submit that. -->
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
      <label class="title" for="{id}-password">{t('access.password')}</label>
      <div class={['field', invalid && 'invalid']}>
        <input
          id="{id}-password"
          class="code"
          bind:value={draft}
          maxlength="64"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? `${id}-password-error` : undefined}
          oninput={() => (invalid = false)}
        />
        <Button size="sm" variant="ghost" icon="refresh" aria-label={t('access.regenerate')} onclick={() => ((draft = generatePassword()), (invalid = false))} />
      </div>
      {#if invalid}<p class="error-text" id="{id}-password-error">{t('err.password_invalid')}</p>{/if}
      <div class="foot">
        {#if value}<Button size="sm" variant="danger" onclick={() => ((value = ''), close())}>{t('access.remove')}</Button>{/if}
        <span class="gap"></span>
        <Button size="sm" variant="ghost" onclick={close}>{t('act.cancel')}</Button>
        <Button size="sm" variant="primary" onclick={() => done(close)}>{t('access.done')}</Button>
      </div>
    </div>
  {/snippet}
</AccessPopover>

<style>
  .code {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

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
    gap: 2px;
    height: var(--control-field);
    padding: 0 2px 0 10px;
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
  }

  .field :global(.btn) {
    border-radius: var(--radius-sm);
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
