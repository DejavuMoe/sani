import { describe, expect, it, vi } from 'vitest';
import { EditorGuard } from './editor.svelte';

function setup() {
  const guard = new EditorGuard();
  let dirty = false;
  const save = vi.fn(async () => { dirty = false; return true; });
  const discard = vi.fn();
  const token = guard.register({ check: () => dirty, save, discard });
  return { guard, token, save, discard, dirty: (value: boolean) => { dirty = value; } };
}

describe('editor guard', () => {
  it('derives clean, dirty, confirming and none, and discards exactly once', () => {
    const { guard, token, dirty, discard } = setup();
    const action = vi.fn();
    expect(guard.phase).toBe('clean');
    guard.request(action);
    expect(action).toHaveBeenCalledTimes(1);
    dirty(true);
    expect(guard.phase).toBe('dirty');
    guard.request(action);
    expect(guard.phase).toBe('confirming');
    guard.pending = null;
    expect(guard.phase).toBe('dirty');
    guard.request(action);
    guard.leave();
    expect(discard).toHaveBeenCalledTimes(1);
    expect(action).toHaveBeenCalledTimes(2);
    expect(guard.phase).toBe('none');
    expect(guard.unregister(token)).toBe(false);
  });

  it.each([true, false])('queues a click during a direct save; success=%s', async success => {
    const { guard, dirty, save } = setup();
    dirty(true);
    let finish!: (ok: boolean) => void;
    save.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const action = vi.fn();
    const pending = guard.save();
    expect(guard.phase).toBe('saving');
    guard.request(action);
    expect(guard.pending).toBeNull();
    expect(action).not.toHaveBeenCalled();
    dirty(!success);
    finish(success);
    expect(await pending).toBe(success);
    expect(action).toHaveBeenCalledTimes(success ? 1 : 0);
    save.mockResolvedValue(true);
    await guard.save(); // A failed save must not replay its queued action later.
    expect(action).toHaveBeenCalledTimes(success ? 1 : 0);
  });

  it('saves and leaves once, including when the editor unregisters during save', async () => {
    const { guard, token, dirty, save } = setup();
    dirty(true);
    save.mockImplementation(async () => { guard.unregister(token); return true; });
    const action = vi.fn();
    guard.request(action);
    await guard.saveAndLeave();
    expect(action).toHaveBeenCalledTimes(1);
    expect(guard.phase).toBe('none');
  });

  it('drops queued navigation if a save throws', async () => {
    const { guard, save } = setup();
    save.mockImplementation(async () => { guard.request(action); throw new Error('offline'); });
    const action = vi.fn();
    await expect(guard.save()).rejects.toThrow('offline');
    save.mockResolvedValue(true);
    await guard.save();
    expect(action).not.toHaveBeenCalled();
    expect(guard.saving).toBe(false);
  });

  it('keeps save-and-leave navigation when the editor closes itself after a failed attempt', async () => {
    const { guard, token, dirty, save } = setup();
    dirty(true);
    const close = vi.fn();
    guard.request(close);
    save.mockResolvedValueOnce(false);
    await guard.saveAndLeave();
    expect(close).not.toHaveBeenCalled();
    const navigate = vi.fn();
    guard.request(navigate);
    save.mockImplementation(async () => {
      guard.unregister(token);
      guard.request(close);
      return true;
    });
    await guard.saveAndLeave();
    expect(close).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('keeps the new owner when the previous editor is destroyed', () => {
    const { guard, token } = setup();
    const current = guard.register({ check: () => true, save: async () => false, discard: () => {} });
    expect(guard.unregister(token)).toBe(false);
    expect(guard.phase).toBe('dirty');
    expect(guard.unregister(current)).toBe(true);
    expect(guard.phase).toBe('none');
  });

  it('notifies only when clean or unregistered and supports unsubscribing', () => {
    const { guard, token, dirty } = setup();
    const settled = vi.fn();
    const unsubscribe = guard.onSettle(settled);
    dirty(true);
    guard.settle();
    expect(settled).not.toHaveBeenCalled();
    dirty(false);
    guard.settle();
    expect(settled).toHaveBeenCalledTimes(1);
    guard.unregister(token);
    expect(settled).toHaveBeenCalledTimes(2);
    unsubscribe();
    guard.settle();
    expect(settled).toHaveBeenCalledTimes(2);
  });

  it('rechecks queued navigation when a tag request completes', () => {
    const { guard, token, dirty } = setup();
    dirty(true);
    guard.setBusy(token, true);
    const action = vi.fn();
    guard.request(action);
    guard.setBusy(token, false);
    expect(guard.phase).toBe('confirming');
    expect(action).not.toHaveBeenCalled();
    guard.leave();
    expect(action).toHaveBeenCalledTimes(1);
  });
});
