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
    background: var(--line-2);
    transition: background-color var(--normal) var(--ease);
  }

  .switch[aria-checked='true'] {
    background: var(--accent);
  }

  .thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
    transition: transform var(--normal) var(--ease);
  }

  .switch[aria-checked='true'] .thumb {
    transform: translateX(14px);
  }

  .switch:disabled {
    opacity: 0.5;
  }

  @media (pointer: coarse) {
    .switch::before {
      content: '';
      position: absolute;
      /* Stay inside the gap between adjacent settings rows. */
      inset: -10px -3px;
    }
  }
</style>
