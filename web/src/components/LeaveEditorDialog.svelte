<script lang="ts">
  import { editor } from '../lib/editor.svelte';
  import { t } from '../lib/i18n.svelte';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  const open = $derived(editor.pending !== null);
</script>

<svelte:window onbeforeunload={(e) => { if (editor.check?.()) { e.preventDefault(); e.returnValue = ''; } }} />
<Dialog {open} title={t('edit.leaveTitle')} onclose={() => editor.pending = null}>
  <p class="dialog-copy">{t('edit.leaveHint')}</p>
  <div class="dialog-actions">
    <Button onclick={() => editor.pending = null}>{t('edit.continue')}</Button>
    <Button variant="danger" onclick={() => editor.leave()}>{t('edit.discard')}</Button>
    <Button variant="primary" onclick={() => editor.saveAndLeave()}>{t('edit.saveLeave')}</Button>
  </div>
</Dialog>
