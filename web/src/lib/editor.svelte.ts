type Registration = { check: () => boolean; save: () => Promise<boolean>; discard: () => void };
/** none → clean ⇄ dirty → confirming → saving; discard/unregister → none,
 * save failure → dirty, success → clean/none and the queued action runs once. */
type EditorPhase = 'none' | 'clean' | 'dirty' | 'confirming' | 'saving';

// One mounted item editor owns the guard. All app navigation uses this boundary.
export class EditorGuard {
  pending = $state<(() => void) | null>(null);
  // Teardown must see the current callbacks, not the outgoing render's state snapshot.
  private active: (Registration & { token: symbol }) | null = null;
  private owner = $state<symbol | null>(null);
  private busy = $state(false);
  private saveInFlight = $state(false);
  private afterSave: (() => void) | null = null;
  private listeners = new Set<() => void>();

  get check() { return this.active?.check ?? null; }
  get saving() { return this.saveInFlight || this.busy; }
  get phase(): EditorPhase {
    if (this.saving) return 'saving';
    if (!this.owner) return 'none';
    if (this.pending) return 'confirming';
    return this.check?.() ? 'dirty' : 'clean';
  }

  register(callbacks: Registration) {
    const token = Symbol();
    this.active = { ...callbacks, token };
    this.owner = token;
    this.busy = false;
    return token;
  }

  unregister(token: symbol) {
    if (this.active?.token !== token) return false;
    this.active = null;
    this.owner = null;
    this.busy = false;
    this.settle();
    return true;
  }

  setBusy(token: symbol, busy: boolean) {
    if (this.active?.token !== token) return;
    this.busy = busy;
    // Tag requests also lock navigation; completion still needs the dirty check.
    if (!busy && !this.saveInFlight && this.afterSave) {
      const action = this.afterSave;
      this.afterSave = null;
      this.request(action);
    }
  }

  onSettle(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  settle() {
    if (!this.saving && !this.check?.()) for (const listener of this.listeners) listener();
  }

  request(action: () => void) {
    if (this.saving && this.active) this.afterSave = action;
    else if (this.check?.()) this.pending = action;
    else action();
  }

  leave() {
    const action = this.pending;
    this.pending = null;
    const active = this.active;
    if (active) this.unregister(active.token);
    active?.discard();
    action?.();
  }

  async save() {
    if (this.saving || !this.active) return false;
    this.saveInFlight = true;
    let ok = false;
    try {
      ok = await this.active.save();
      return ok;
    } finally {
      this.saveInFlight = false;
      const action = this.afterSave;
      this.afterSave = null;
      if (ok) action?.();
      this.settle();
    }
  }

  async saveAndLeave() {
    if (this.saving || !this.active) return;
    this.afterSave = this.pending;
    this.pending = null;
    await this.save();
  }
}
export const editor = new EditorGuard();
