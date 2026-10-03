/*
 * L2 — primitives, one per file in web/src/components, in every state they
 * have. Menus and dialogs use `staticOpen` to draw in place; everything else
 * is the live component, so hover, focus and keyboard can be tried here.
 */
const WEEKLY = FIX.links.find((l) => l.slug === 'weekly-42');

function ToastSpecimen() {
  const { t } = useI18n();
  const toasts = useToasts();
  React.useEffect(() => {
    toasts.success(t('act.copied'), { detail: 's.example.com/weekly-42', duration: 0 });
    toasts.show(t('detail.deleted', { slug: '/talk' }), { action: { label: t('act.undo'), run() {} }, duration: 0 });
    toasts.error(t('err.network'), { duration: 0 });
  }, []);
  return <Toaster toasts={toasts} isStatic />;
}

function SlugSpecimen({ theme, variant }) {
  const statuses = variant === 'inline' ? ['idle', 'checking', 'available', 'taken', 'reserved', 'invalid', 'tooLong'] : ['idle', 'available', 'taken'];
  const values = { idle: '', checking: 'launch', available: 'launch', taken: 'gh', reserved: 'admin', invalid: 'a b', tooLong: 'x'.repeat(65) };
  return (
    <div className="b-stack">
      {statuses.map((s) => (
        <div className="b-specimen" key={s}>
          <Cap>{s}</Cap>
          <SlugField id={`slug-${variant}-${s}-${theme}`} value={values[s]} onChange={() => {}} status={s} prefix={shortHost} variant={variant} placeholder={variant === 'boxed' ? 'k3x9p' : ''} />
        </div>
      ))}
    </div>
  );
}

function Components() {
  const t = (k, p) => makeI18n(BOARD.lang, BOARD_NOW).t(k, p);
  const variants = ['primary', 'accent', 'secondary', 'ghost', 'danger'];
  return (
    <BoardShell
      page="components.html"
      title="L2 · Components"
      intro={
        <p>
          Ports of <code>web/src/components/*.svelte</code>. Props match the Svelte props; class names carry a per-component prefix (Button <code>.primary</code> →{' '}
          <code>.btn-primary</code>) because the prototype has no style scoping.
        </p>
      }
      toc={[
        ['button', 'Button'],
        ['segmented', 'Segmented'],
        ['switch', 'Switch'],
        ['menu', 'Menu'],
        ['dialog', 'Dialog'],
        ['toaster', 'Toaster'],
        ['slug', 'SlugField'],
        ['expiry', 'ExpiryPicker'],
        ['favicon', 'Favicon'],
        ['charts', 'Charts'],
        ['qr', 'QRCode'],
      ]}
    >
      <Spec id="button" title="Button" source="Button.svelte" note="Variants × sizes; with icon, icon only (square), loading (spinner, aria-busy) and disabled.">
        {() => (
          <div className="b-stack">
            {variants.map((v) => (
              <div className="b-row" key={v}>
                <span className="b-cap" style={{ width: 72 }}>
                  {v}
                </span>
                <Button variant={v} size="sm">
                  {t('act.save')}
                </Button>
                <Button variant={v}>{t('act.save')}</Button>
                <Button variant={v} size="lg">
                  {t('act.save')}
                </Button>
                <Button variant={v} icon="copy">
                  {t('act.copy')}
                </Button>
                <Button variant={v} icon="more" aria-label={t('act.more')} />
                <Button variant={v} loading>
                  {t('act.saving')}
                </Button>
                <Button variant={v} disabled>
                  {t('act.save')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Spec>

      <Spec id="segmented" title="Segmented" source="Segmented.svelte" note="A radio group; arrow keys move the selection.">
        {() => <SegmentedSpecimen />}
      </Spec>

      <Spec id="switch" title="Switch" source="Switch.svelte">
        {() => (
          <div className="b-row" style={{ gap: 20 }}>
            <Switch checked onChange={() => {}} label={t('detail.enabled')} />
            <Switch checked={false} onChange={() => {}} label={t('detail.enabled')} />
            <Switch checked disabled onChange={() => {}} label={t('detail.enabled')} />
            <Switch checked={false} disabled onChange={() => {}} label={t('detail.enabled')} />
            <Cap>on · off · disabled on · disabled off</Cap>
          </div>
        )}
      </Spec>

      <Spec id="menu" title="Menu + MenuItem" source={['Menu.svelte', 'MenuItem.svelte']} note="Popover API. The first trigger opens a live menu; the second draws the same menu in place. Items: icon, radio (checked), hint, danger.">
        {() => (
          <div className="b-row" style={{ alignItems: 'flex-start', gap: 32 }}>
            <MenuSpecimen />
            <div className="b-specimen">
              <MenuSpecimen staticOpen />
            </div>
          </div>
        )}
      </Spec>

      <Spec id="dialog" title="Dialog" source={['Dialog.svelte', 'ShortcutsDialog.svelte']} note="A modal <dialog>, drawn in place here. Its only use in production is the shortcuts dialog (?).">
        {() => <ShortcutsDialog staticOpen open onClose={() => {}} />}
      </Spec>

      <Spec id="toaster" title="Toaster" source={['Toaster.svelte', 'lib/toast.svelte.ts']} note="Success with detail, neutral with an action (6 s), error (5 s). At most three; hovering pauses the timer.">
        {() => <ToastSpecimen />}
      </Spec>

      <Spec id="slug" title="SlugField" source="SlugField.svelte" note="Inline (composer) and boxed (editor) variants in each availability status. Availability here is checked against the fixture links.">
        {(theme) => (
          <div className="b-row" style={{ alignItems: 'flex-start', gap: 40 }}>
            <div className="b-surface" style={{ minWidth: 300 }}>
              <SlugSpecimen theme={theme} variant="inline" />
            </div>
            <div style={{ minWidth: 300 }}>
              <SlugSpecimen theme={theme} variant="boxed" />
            </div>
          </div>
        )}
      </Spec>

      <Spec id="expiry" title="ExpiryPicker" source="ExpiryPicker.svelte" note="A preset, a custom time (adds a datetime field), and the menu drawn in place.">
        {(theme) => <ExpirySpecimen theme={theme} />}
      </Spec>

      <Spec id="favicon" title="Favicon" source="Favicon.svelte" note="A fetched icon; a letter tile tinted from the host when there is none; a blank tile when there is no host.">
        {() => (
          <div className="b-row" style={{ gap: 18 }}>
            {[14, 16, 20].map((size) => (
              <React.Fragment key={size}>
                <Favicon host="github.com" icon size={size} />
                <Favicon host="weibo.com" icon={false} size={size} />
                <Favicon host="example.org" icon={false} size={size} />
                <Favicon host="" icon={false} size={size} />
              </React.Fragment>
            ))}
            <Cap>icon · letter · letter · blank, at 14 / 16 / 20</Cap>
          </div>
        )}
      </Spec>

      <Spec id="charts" title="Sparkline · MiniBars · BarChart" source={['Sparkline.svelte', 'MiniBars.svelte', 'BarChart.svelte']} note="Row sparkline (14 days), summary bars (30 days), detail chart (30 days) with a bar picked, and the empty chart.">
        {() => <ChartSpecimen />}
      </Spec>

      <Spec id="qr" title="QRCode" source={['QRCode.svelte', 'lib/qr.ts']} note="uqr, ECC M, merged into one path; the same encoder production bundles. Modules are always dark (#1c1b19), so every use sets it on white: the detail panel and the new-link page.">
        {() => (
          <div className="b-row" style={{ gap: 24 }}>
            <div style={{ padding: 6, borderRadius: 'var(--radius-sm)', background: '#fff' }}>
              <QRCode value={WEEKLY.shortUrl} label={t('detail.qrLabel', { url: stripScheme(WEEKLY.shortUrl) })} />
            </div>
            <Cap>{WEEKLY.shortUrl}</Cap>
          </div>
        )}
      </Spec>
    </BoardShell>
  );
}

function SegmentedSpecimen() {
  const { t } = useI18n();
  const [theme, setTheme] = React.useState('system');
  const [range, setRange] = React.useState(30);
  return (
    <div className="b-row" style={{ gap: 24 }}>
      <Segmented
        label={t('settings.theme')}
        value={theme}
        onChange={setTheme}
        options={['system', 'light', 'dark'].map((v) => ({ value: v, label: t(`theme.${v}`), icon: themeIcon[v] }))}
      />
      <Segmented label={t('detail.chart')} size="sm" value={range} onChange={setRange} options={[7, 30, 90].map((v) => ({ value: v, label: t('detail.days', { n: v }) }))} />
    </div>
  );
}

function MenuSpecimen({ staticOpen = false }) {
  const { t } = useI18n();
  const [sort, setSort] = React.useState('created');
  return (
    <span style={{ display: 'inline-grid', gap: 8, justifyItems: 'start' }}>
      <Menu
        staticOpen={staticOpen}
        triggerClass="btn btn-secondary btn-md"
        label={t('act.more')}
        button={() => (
          <>
            <Icon name="more" />
            <span className="btn-text">{t('act.more')}</span>
          </>
        )}
      >
        {(close) => (
          <>
            <MenuItem icon="copy" hint="C" onClick={close}>
              {t('act.copy')}
            </MenuItem>
            <MenuItem icon="edit" hint="E" onClick={close}>
              {t('act.edit')}
            </MenuItem>
            <MenuItem icon="refresh" onClick={close}>
              {t('detail.refetch')}
            </MenuItem>
            <div className="expiry-sep" role="separator"></div>
            {['created', 'clicks', 'visited'].map((x) => (
              <MenuItem key={x} checked={sort === x} onClick={() => (setSort(x), close())}>
                {t(`sort.${x}`)}
              </MenuItem>
            ))}
            <div className="expiry-sep" role="separator"></div>
            <MenuItem icon="trash" danger onClick={close}>
              {t('act.delete')}
            </MenuItem>
          </>
        )}
      </Menu>
    </span>
  );
}

function ExpirySpecimen({ theme }) {
  const [a, setA] = React.useState({ preset: '7d' });
  const [b, setB] = React.useState({ at: toLocalInput(new Date(BOARD_NOW + 3 * 864e5)) });
  return (
    <div className="b-row" style={{ alignItems: 'flex-start', gap: 32 }}>
      <div className="b-surface">
        <ExpiryPicker id={`exp-a-${theme}`} value={a} onChange={setA} />
      </div>
      <div className="b-surface">
        <ExpiryPicker id={`exp-b-${theme}`} value={b} onChange={setB} />
      </div>
      <div className="b-surface">
        <ExpiryPicker id={`exp-c-${theme}`} value={{ preset: '1d' }} onChange={() => {}} staticOpen />
      </div>
    </div>
  );
}

function ChartSpecimen() {
  const { t } = useI18n();
  const stats = FIX.stats[WEEKLY.id]['30'];
  return (
    <div className="b-stack">
      <div className="b-row" style={{ gap: 32 }}>
        <div className="b-specimen">
          <Sparkline values={WEEKLY.spark} label={t('list.spark', { n: WEEKLY.spark.reduce((x, y) => x + y, 0) })} />
          <Cap>Sparkline</Cap>
        </div>
        <div className="b-specimen">
          <MiniBars days={FIX.overview.days} label={t('summary.chart')} />
          <Cap>MiniBars</Cap>
        </div>
      </div>
      <div className="b-surface">
        <BarChart days={stats.days} label={t('detail.chart')} initialActive={stats.days.length - 3} />
      </div>
      <div className="b-surface">
        <BarChart days={zeroDays(30, BOARD_NOW)} label={t('detail.chart')} dim empty={t('detail.noVisits')} />
      </div>
    </div>
  );
}

mountBoard(<Components />);
