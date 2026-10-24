<script lang="ts">
  /* The three access rules, side by side, in the order people decide them. */
  import type { Expiry } from '../lib/expiry';
  import ExpiryPicker from './ExpiryPicker.svelte';
  import LimitPicker from './LimitPicker.svelte';
  import PasswordPicker from './PasswordPicker.svelte';

  let {
    id,
    expiry = $bindable<Expiry>({ preset: 'never' }),
    maxClicks = $bindable(''),
    password = $bindable(''),
  }: { id: string; expiry?: Expiry; maxClicks?: string; password?: string } = $props();

  const expirySet = $derived('at' in expiry || expiry.preset !== 'never');
</script>

<span class="access">
  <ExpiryPicker bind:value={expiry} icon="clock" showLabel={false} id="{id}-expiry" triggerClass={expirySet ? 'opt set' : 'opt'} />
  <LimitPicker bind:value={maxClicks} {id} />
  <PasswordPicker bind:value={password} {id} />
</span>

<style>
  .access {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }

  .access :global(.expiry:has(.date-editor)) {
    flex-basis: 100%;
  }
</style>
