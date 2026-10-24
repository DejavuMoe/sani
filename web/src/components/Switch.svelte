<script lang="ts">
  let {
    checked,
    onchange,
    label,
    disabled = false,
    id,
  }: { checked: boolean; onchange: (v: boolean) => void; label: string; disabled?: boolean; id?: string } = $props();
</script>

<button
  {id}
  type="button"
  role="switch"
  class="switch"
  aria-checked={checked}
  aria-label={label}
  {disabled}
  onclick={() => onchange(!checked)}
>
  <span class="thumb"></span>
</button>

<style>
  .switch {
    position: relative;
    flex: none;
    width: 34px;
    height: 20px;
    border-radius: 10px;
    background: var(--line-3);
  }

  .switch[aria-checked='true'] {
    background: var(--solid);
  }

  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: var(--hair-shadow);
  }

  .switch[aria-checked='true'] .thumb {
    transform: translateX(14px);
  }

  .switch:disabled {
    opacity: 0.5;
  }

  @media (max-width: 640px), (pointer: coarse) {
    .switch::before {
      content: '';
      position: absolute;
      /* Stay inside the gap between adjacent settings rows. */
      inset: -12px -5px;
    }
  }
</style>
