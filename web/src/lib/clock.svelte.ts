/** A shared "now" that ticks every 30 s so relative times stay honest. */
class Clock {
  now = $state(Date.now());

  constructor() {
    setInterval(() => (this.now = Date.now()), 30_000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.now = Date.now();
    });
  }
}

export const clock = new Clock();
