import { describe, expect, it } from 'vitest';
import { Resource } from './resource.svelte';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('resource phases', () => {
  it('starts idle and empty', () => {
    const res = new Resource<string>();
    expect(res.phase).toBe('idle');
    expect(res.value).toBeNull();
    expect(res.loading).toBe(false);
    expect(res.failed).toBe(false);
  });

  it('moves to ready and keeps the value', async () => {
    const res = new Resource<string>();
    const outcome = await res.run(async () => 'first');
    expect(outcome).toEqual({ status: 'ready', value: 'first' });
    expect(res.phase).toBe('ready');
    expect(res.value).toBe('first');
    expect(res.loading).toBe(false);
    expect(res.failed).toBe(false);
  });

  it('reports a failure and keeps the last good value', async () => {
    const res = new Resource<string>();
    await res.run(async () => 'first');
    const error = new Error('offline');
    const outcome = await res.run(async () => {
      throw error;
    });
    expect(outcome).toEqual({ status: 'failed', error });
    expect(res.phase).toBe('failed');
    expect(res.failed).toBe(true);
    expect(res.loading).toBe(false);
    expect(res.value).toBe('first');
  });

  it('keeps the last good value while reloading', async () => {
    const res = new Resource<string>();
    await res.run(async () => 'first');
    const next = deferred<string>();
    const running = res.run(() => next.promise);
    expect(res.phase).toBe('loading');
    expect(res.loading).toBe(true);
    expect(res.value).toBe('first');
    next.resolve('second');
    await running;
    expect(res.value).toBe('second');
  });

  it('ignores a slower response from an earlier load', async () => {
    const res = new Resource<string>();
    const slow = deferred<string>();
    const first = res.run(() => slow.promise);
    const second = await res.run(async () => 'second');
    expect(second.status).toBe('ready');
    slow.resolve('first');
    expect((await first).status).toBe('stale');
    expect(res.value).toBe('second');
    expect(res.phase).toBe('ready');
  });

  it('drops a result the caller no longer wants', async () => {
    const res = new Resource<string>();
    const outcome = await res.run(async () => 'value', () => false);
    expect(outcome.status).toBe('stale');
    expect(res.value).toBeNull();
    expect(res.phase).toBe('ready');
  });

  it('drops the result of an invalidated load', async () => {
    const res = new Resource<string>();
    const pending = deferred<string>();
    const running = res.run(() => pending.promise);
    res.invalidate();
    pending.resolve('late');
    expect((await running).status).toBe('stale');
    expect(res.value).toBeNull();
  });
});
