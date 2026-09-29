<script lang="ts">
  import { qr } from '../lib/qr';

  let { value, size = 132, label }: { value: string; size?: number; label: string } = $props();

  const code = $derived(qr(value));
</script>

<svg
  class="qr"
  viewBox="0 0 {code.size} {code.size}"
  width={size}
  height={size}
  shape-rendering="crispEdges"
  role="img"
  aria-label={label}
>
  <path d={code.path} />
</svg>

<style>
  .qr {
    flex: none;
  }

  path {
    fill: #1c1b19;
  }
</style>
