<script lang="ts">
  import { formatNumber, t } from '../lib/i18n.svelte';
  import { links } from '../lib/links.svelte';
  import Button from './Button.svelte';
  import MiniBars from './MiniBars.svelte';

  const o = $derived(links.overview);
</script>

{#if !o || o.links > 0 || links.overviewFailed}
<section class="summary" aria-label={t('summary.chart')}>
  <dl>
    <div>
      <dt>{t('summary.links')}</dt>
      <dd>{o ? formatNumber(o.links) : '–'}</dd>
    </div>
    <div>
      <dt>{t('summary.clicks')}</dt>
      <dd>{o ? formatNumber(o.clicks) : '–'}</dd>
    </div>
    <div>
      <dt>{t('summary.today')}</dt>
      <dd>{o ? formatNumber(o.today) : '–'}</dd>
    </div>
    {#if o && o.clicks > 0}
      <div class="trend">
        <dt>{t('summary.last30')}</dt>
        <dd><MiniBars days={o.days} label={t('summary.chart')} /></dd>
      </div>
    {/if}
  </dl>
  <details class="scope"><summary>{t('summary.scope')}</summary><p>{t('summary.scopeHint')}</p></details>
  {#if links.overviewFailed}<div class="state-notice error" role="alert"><span>{t('summary.failed')}</span><Button size="sm" onclick={()=>links.refreshOverview()}>{t('act.retry')}</Button></div>{/if}
</section>
{/if}

<style>
  .scope { margin-top:12px; color:var(--text-3); font-size:11px; }
  .scope summary { cursor:pointer; width:fit-content; }
  .scope p { max-width:560px; margin-top:6px; line-height:1.7; }
  .summary {
    padding: 0 4px;
  }

  dl {
    display: flex;
    align-items: flex-start;
    gap: 36px;
    margin: 0;
  }

  dt {
    color: var(--text-3);
    font-size: 12px;
    line-height: 16px;
  }

  dd {
    display: flex;
    align-items: flex-end;
    height: 28px;
    margin: 4px 0 0;
    color: var(--text);
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1;
    padding-bottom: 3px;
  }

  .trend {
    margin-left: auto;
  }

  .trend dt {
    text-align: right;
  }

  .trend dd {
    padding-bottom: 2px;
  }

  @media (max-width: 640px) {
    dl {
      gap: 24px;
    }

    dd {
      font-size: 18px;
    }

    .trend {
      display: none;
    }
  }
</style>
