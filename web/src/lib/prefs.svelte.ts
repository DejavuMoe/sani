export type ThemePref = 'system' | 'light' | 'dark';

const media = matchMedia('(prefers-color-scheme: dark)');

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem('sani.theme');
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable */
  }
  return 'system';
}

class Prefs {
  theme = $state<ThemePref>(readTheme());
  systemDark = $state(media.matches);
  resolved = $derived<'light' | 'dark'>(this.theme === 'system' ? (this.systemDark ? 'dark' : 'light') : this.theme);

  constructor() {
    media.addEventListener('change', (e) => {
      this.systemDark = e.matches;
      this.apply();
    });
  }

  setTheme(theme: ThemePref) {
    this.theme = theme;
    try {
      if (theme === 'system') localStorage.removeItem('sani.theme');
      else localStorage.setItem('sani.theme', theme);
    } catch {
      /* storage unavailable */
    }
    this.apply();
  }

  /** Cycle system → light → dark, for the header toggle. */
  cycleTheme() {
    const order: ThemePref[] = ['system', 'light', 'dark'];
    this.setTheme(order[(order.indexOf(this.theme) + 1) % order.length]);
  }

  apply() {
    const root = document.documentElement;
    const next = this.theme === 'system' ? (media.matches ? 'dark' : 'light') : this.theme;
    if (root.dataset.theme === next) return;
    // Swap colors in one frame instead of letting every transition animate.
    root.classList.add('theme-switching');
    root.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#111110' : '#f7f7f5');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
  }
}

export const prefs = new Prefs();
