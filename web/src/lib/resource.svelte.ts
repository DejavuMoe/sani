/** Where an asynchronously loaded value stands. */
export type ResourcePhase = 'idle' | 'loading' | 'ready' | 'failed';

/** What a load settled with: the value, the error, or nothing (superseded). */
export type ResourceOutcome<T> =
  | { status: 'ready'; value: T }
  | { status: 'failed'; error: unknown }
  | { status: 'stale' };

/**
 * A tiny async state machine for "load it, then show it".
 *
 * Transitions: idle → loading; loading → ready | failed; ready | failed →
 * loading. Only the newest load may settle: every run takes a sequence
 * number, so a slower earlier response is ignored ("stale") and never
 * overwrites a newer value.
 */
export class Resource<T> {
  phase = $state<ResourcePhase>('idle');
  /** The last good value; it survives a reload and a failure. */
  value = $state<T | null>(null);
  private seq = 0;
  private ctrl: AbortController | null = null;

  get loading(): boolean {
    return this.phase === 'loading';
  }

  get failed(): boolean {
    return this.phase === 'failed';
  }

  /**
   * Loads a value. The signal aborts when a newer load starts, so a caller
   * can hand it to `fetch`. `isCurrent` is an extra guard for callers
   * whose own parameters change while the load runs: such a result is
   * dropped like a stale one.
   */
  async run(
    fn: (signal: AbortSignal) => Promise<T>,
    isCurrent?: () => boolean,
  ): Promise<ResourceOutcome<T>> {
    const prev = this.phase;
    const seq = ++this.seq;
    this.ctrl?.abort();
    const ctrl = (this.ctrl = new AbortController());
    this.phase = 'loading';
    try {
      const value = await fn(ctrl.signal);
      if (seq !== this.seq) return { status: 'stale' };
      if (isCurrent && !isCurrent()) {
        // The caller moved on: keep what is on screen.
        this.phase = prev === 'failed' ? 'failed' : this.value !== null ? 'ready' : 'idle';
        return { status: 'stale' };
      }
      this.value = value;
      this.phase = 'ready';
      return { status: 'ready', value };
    } catch (error) {
      if (seq !== this.seq) return { status: 'stale' };
      if (isCurrent && !isCurrent()) {
        this.phase = prev === 'failed' ? 'failed' : this.value !== null ? 'ready' : 'idle';
        return { status: 'stale' };
      }
      this.phase = 'failed';
      return { status: 'failed', error };
    }
  }

  /** Drops the load in flight: its result will not be applied. */
  invalidate(): void {
    ++this.seq;
    this.ctrl?.abort();
    this.ctrl = null;
    if (this.phase === 'loading') {
      this.phase = this.value !== null ? 'ready' : 'idle';
    }
  }
}
