export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  message: string;
  detail?: string;
  tone: 'neutral' | 'success' | 'error';
  action?: ToastAction;
  duration: number;
}

let seq = 0;

class Toasts {
  items = $state<Toast[]>([]);
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): number {
    const toast: Toast = { id: ++seq, message, tone: 'neutral', duration: opts.action ? 6000 : 3200, ...opts };
    // Keep the stack short; the newest message matters most.
    this.items = [...this.items.slice(-2), toast];
    this.schedule(toast);
    return toast.id;
  }

  success(message: string, opts: Partial<Omit<Toast, 'id' | 'message' | 'tone'>> = {}) {
    return this.show(message, { ...opts, tone: 'success' });
  }

  error(message: string, opts: Partial<Omit<Toast, 'id' | 'message' | 'tone'>> = {}) {
    return this.show(message, { duration: 5000, ...opts, tone: 'error' });
  }

  dismiss(id: number) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.items = this.items.filter((t) => t.id !== id);
  }

  /** Hovering a toast holds it open. */
  pause(id: number) {
    clearTimeout(this.timers.get(id));
  }

  resume(id: number) {
    const toast = this.items.find((t) => t.id === id);
    if (toast) this.schedule({ ...toast, duration: Math.min(toast.duration, 2500) });
  }

  private schedule(toast: Toast) {
    clearTimeout(this.timers.get(toast.id));
    this.timers.set(
      toast.id,
      setTimeout(() => this.dismiss(toast.id), toast.duration),
    );
  }
}

export const toasts = new Toasts();
