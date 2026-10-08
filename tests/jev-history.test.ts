import { expect, it, vi } from 'vitest';
import { createHistory } from '../src/jev/history';
import type { ChatMessage } from '../src/youtube/contracts';
const post = (id: string, ms: number, authorChannelId = 'a'): ChatMessage => ({ id, authorChannelId, type: 'textMessageEvent', text: `本文${id}`, publishedAt: new Date(Date.UTC(2026, 0, 1) + ms).toISOString() });
it('ページをまたぐ同一author10件/10秒ちょうどは連投、重複IDと他authorを除く', () => {
  const history = createHistory();
  for (let i = 0; i < 9; i++) history.add(post(`${i}`, i * 1000));
  expect(history.add(post('0', 0))).toBeUndefined();
  history.add(post('other', 9000, 'b'));
  const context = history.add(post('9', 10000))!;
  expect(context.burst).toBe('confirmed');
  expect(context.state.history).toHaveLength(9);
  expect(JSON.stringify(context.state)).not.toMatch(/authorChannelId|"id"|other/);
});
export { post };
it('大量の異なる投稿者と時刻不明inputでも本文・IDを上限以上保持せずidleで再利用可能になる', async () => {
  vi.useFakeTimers();
  try {
    const history = createHistory();
    for (let i = 0; i < 12000; i++) history.add({ ...post(`many-${i}`, 0, `author-${i}`), publishedAt: undefined });
    expect(history.context('many-0')).toBeDefined();
    expect(history.context('many-9999')).toBeDefined();
    expect(history.context('many-10000')).toBeUndefined();
    expect(history.context('many-11999')).toBeUndefined();
    await vi.advanceTimersByTimeAsync(60001);
    expect(history.context('many-0')).toBeUndefined();
    expect(history.add(post('many-0', 0))).toMatchObject({ burst: 'notObserved', state: { history: [] } });
    history.clear();
  } finally { vi.useRealTimers(); }
});
it('実経過60秒ちょうども投稿日ルールのinclusive履歴を保持する', async () => {
  vi.useFakeTimers();
  try {
    const history = createHistory();
    history.add(post('edge-received', 0));
    await vi.advanceTimersByTimeAsync(60000);
    expect(history.add(post('target-received', 60000))!.state.history.map(entry => entry.text)).toEqual(['本文edge-received']);
    history.clear();
  } finally { vi.useRealTimers(); }
});
it('idle中も未来時刻・時刻不明の本文を受信後60秒で解放する', async () => {
  vi.useFakeTimers();
  try {
    const history = createHistory();
    history.add(post('future', 864000000));
    history.add({ ...post('unknown', 0, 'b'), publishedAt: undefined });
    expect(history.context('future')).toBeDefined();
    await vi.advanceTimersByTimeAsync(60001);
    expect(history.context('future')).toBeUndefined();
    expect(history.context('unknown')).toBeUndefined();
    history.clear();
  } finally { vi.useRealTimers(); }
});
it('IDから保持中の対象だけを最小stateへ対応付け、失われた本文は復元しない', () => {
  const history = createHistory();
  history.add(post('a', 0)); history.add(post('b', 10000));
  expect(history.context('b')).toEqual({ target: { text: '本文b', publishedAt: post('b', 10000).publishedAt }, history: [{ text: '本文a', publishedAt: post('a', 0).publishedAt }] });
  history.add(post('new', 70001));
  expect(history.context('b')).toBeUndefined();
  history.add({ ...post('missing-time', 70001), publishedAt: undefined });
  expect(history.context('missing-time')).toEqual({ target: { text: '本文missing-time' }, history: [] });
  history.clearBodies();
  expect(history.context('new')).toBeUndefined();
  expect(history.add(post('new', 70001))).toBeUndefined();
});
it.each([[9, 9000, 'notObserved'], [10, 10001, 'notObserved'], [10, 10000, 'confirmed']])('%i件/%ims境界は%s', (count, last, expected) => {
  const history = createHistory();
  for (let i = 0; i < count - 1; i++) history.add(post(`${i}`, i * 1000));
  expect(history.add(post('last', last))!.burst).toBe(expected);
});
it('一括受信でも投稿時刻が離れていれば連投ではない、未来/60秒超は履歴外、対象込み20件', () => {
  const history = createHistory();
  history.add(post('old', -60001)); history.add(post('edge', -60000));
  expect(history.add(post('now', 0))!.state.history.map(p => p.text)).toEqual(['本文edge']);
  const batch = createHistory();
  for (let i = 0; i < 25; i++) batch.add(post(`${i}`, i * 2000));
  const result = batch.add(post('last', 60000))!;
  expect(result.state.history).toHaveLength(19);
  expect(result.burst).toBe('notObserved');
  expect(new Set([...result.state.history, result.state.target].map(p => p.text)).size).toBe(20);
});
it('欠落/不正/非実在日時は時間判定不能で偽日時や不明履歴をstateへ入れない', () => {
  for (const publishedAt of [undefined, 'bad', '2026-02-30T00:00:00Z']) {
    const history = createHistory();
    const context = history.add({ ...post('missing', 0), publishedAt })!;
    expect(context).toEqual({ burst: 'unavailable', state: { target: { text: '本文missing' }, history: [] } });
    expect(history.add(post('valid', 1))!.burst).toBe('notObserved');
  }
});
it('古い本文と20件を超えた本文を解放しclearでsessionを分離する', () => {
  const history = createHistory();
  history.add(post('old-body', 0));
  history.add(post('new-body', 60001));
  const stale = history.add(post('late-arrival', 0))!;
  expect(stale.state.history).toEqual([]);
  expect(stale.burst).toBe('unavailable');
  const crowded = createHistory();
  for (let i = 0; i < 40; i++) crowded.add(post(`crowd-${i}`, i));
  expect(crowded.add(post('out-of-order', 0))!.state.history).toEqual([]);
  history.clear();
  expect(history.add(post('old-body', 0))!.state.history).toEqual([]);
});
it('本文20件から解放した投稿も時刻だけで順不同targetの10秒10件判定に使う', () => {
  const history = createHistory();
  for (let i = 0; i < 40; i++) history.add(post(`many-${i}`, i * 1000));
  const result = history.add(post('late-ten', 10000))!;
  expect(result.burst).toBe('confirmed');
  expect(result.state.history).toEqual([]);
});
it('RFC3339 offset/小数秒も捏造せず扱い10秒を1ナノ秒超える投稿は連投に含めない', () => {
  for (const [publishedAt, expected] of [['2026-01-01T09:00:10+09:00', 'confirmed'], ['2026-01-01T00:00:10.000000001Z', 'notObserved']] as const) {
    const history = createHistory();
    for (let i = 0; i < 9; i++) history.add(post(`${i}`, i * 1000));
    const result = history.add({ ...post('last', 10000), publishedAt })!;
    expect(result.burst).toBe(expected);
    expect(result.state.target.publishedAt).toBe(publishedAt);
  }
});
