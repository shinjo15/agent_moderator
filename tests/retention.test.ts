import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createBoundedQueue, createTransientMap, MAX_TRANSIENT_ENTRIES } from '../src/retention';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });

it('容量0も維持し、上限で既存処理IDを追い出さず拒否する', () => {
  const zero = createTransientMap({ limit: 0 });
  expect(zero.set('id', 0)).toBe(false);
  expect(zero.size).toBe(0);
  const map = createTransientMap<number>({ limit: 2 });
  expect(map.set('first', 0)).toBe(true); map.set('second', 1);
  expect(map.set('overflow', 2)).toBe(false);
  expect(map.get('first')).toBe(0);
  expect(map.size).toBe(2); map.clear();
  expect(vi.getTimerCount()).toBe(0);
});

it('同IDへのアクセス・再書込はidle期限を延長せず削除callbackを1回だけ実行する', async () => {
  const onDelete = vi.fn();
  const map = createTransientMap<number>({ onDelete });
  map.set('id', 0); await vi.advanceTimersByTimeAsync(50000);
  expect(map.get('id')).toBe(0); map.set('id', 1);
  await vi.advanceTimersByTimeAsync(10000); expect(map.get('id')).toBe(1);
  await vi.advanceTimersByTimeAsync(1); expect(map.size).toBe(0);
  expect(onDelete).toHaveBeenCalledExactlyOnceWith('id', 1);
  expect(vi.getTimerCount()).toBe(0);
});

it('長時間・大量inputでも上限とidle解放を繰り返し維持する', async () => {
  const map = createTransientMap<number>();
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let i = 0; i < MAX_TRANSIENT_ENTRIES + 1000; i++) map.set(`${cycle}-${i}`, i);
    expect(map.size).toBe(MAX_TRANSIENT_ENTRIES);
    await vi.advanceTimersByTimeAsync(3600000);
    expect(map.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  }
});

it('FIFO順を維持し失敗後も後続を処理、期限切れ待機は実行せずrejectする', async () => {
  const exclusive = createBoundedQueue();
  let finish!: () => void;
  const first = exclusive(() => new Promise<void>(resolve => { finish = resolve; }));
  const work = vi.fn(async () => 0);
  const expired = exclusive(work).catch(() => 'expired');
  await vi.advanceTimersByTimeAsync(60001);
  expect(await expired).toBe('expired'); expect(work).not.toHaveBeenCalled();
  finish(); await first; await vi.advanceTimersByTimeAsync(0);
  expect(await exclusive(async () => { throw new Error('fixture'); }).catch(() => 'failed')).toBe('failed');
  expect(await exclusive(work)).toBe(0);
  expect(work).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
