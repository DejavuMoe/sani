import { api, ApiError, setUnauthorizedHandler, type Config } from './api';
import { errorText } from './i18n.svelte';
import { toasts } from './toast.svelte';

export type SessionState = 'loading' | 'setup' | 'login' | 'ready' | 'offline';

class Session {
  state = $state<SessionState>('loading');
  config = $state<Config | null>(null);
  /** Set when the session ended on its own, so sign-in can say why. */
  expired = $state(false);

  constructor() {
    setUnauthorizedHandler(() => {
      if (this.state === 'ready') {
        this.expired = true;
        this.state = 'login';
      }
    });
  }

  async boot() {
    try {
      const s = await api.session();
      if (s.needsSetup) this.state = 'setup';
      else if (!s.authenticated) this.state = 'login';
      else await this.enter();
    } catch {
      this.state = 'offline';
    }
  }

  async enter() {
    this.config = await api.config();
    this.expired = false;
    this.state = 'ready';
  }

  async signOut() {
    try {
      await api.logout();
      this.state = 'login';
    } catch (error) {
      toasts.error(errorText(error instanceof ApiError ? error.code : 'unknown'));
    }
  }

  get origin(): string {
    return this.config?.baseUrl ?? location.origin;
  }
}

export const session = new Session();
