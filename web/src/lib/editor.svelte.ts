// One mounted item editor owns the guard. All app navigation uses this boundary.
class EditorGuard {
  pending = $state<(() => void) | null>(null);
  saving = $state(false);
  check: (() => boolean) | null = null;
  save: (() => Promise<boolean>) | null = null;

  request(action: () => void) {
    if (this.saving) return;
    if (this.check?.()) this.pending = action;
    else action();
  }

  leave() {
    const action = this.pending;
    this.pending = null;
    this.check = null;
    action?.();
  }

  async saveAndLeave() {
    if (this.saving || !this.save) return;
    const action = this.pending;
    this.pending = null;
    if (await this.save()) action?.();
  }
}
export const editor = new EditorGuard();
