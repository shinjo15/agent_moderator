import { expect, it, vi } from 'vitest';
import { createModeration } from '../src/jev/moderation';
import { createJevClient } from '../src/jev/client';
import { apiResponse, chatPost } from './fixtures/jev';
it.each([429, 401])('観測期限切れ後のHTTP%iでもcurrent失敗を通知し期限切れ記録は復元しない', async status => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  try {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockImplementation(async () => new Response(JSON.stringify(apiResponse())));
    const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
    await moderation.enable(); moderation.observe([{ ...chatPost('expired'), authorDisplayName: '期限切れ名前fixture' }]);
    await vi.advanceTimersByTimeAsync(50000);
    const pending = moderation.evaluate('expired');
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10001);
    finish(new Response('{}', { status, headers: { 'Retry-After': '30' } }));
    const failure = await pending;
    expect(failure).toMatchObject({ ok: true, value: { jev: 'failed', reasons: [], error: { code: status === 429 ? 'rateLimited' : 'auth' } } });
    if (failure.ok) {
      expect(failure.value.malicious).toBeUndefined(); expect(failure.value.evaluation).toBeUndefined();
    }
    expect(JSON.stringify(failure)).not.toMatch(/日本語本文expired|期限切れ名前fixture/);
    expect(await moderation.evaluate('expired')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    moderation.observe([chatPost('fresh', 60001)]);
    expect(await moderation.evaluate('fresh')).toMatchObject({ ok: true, value: { jev: 'disabled' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    if (status === 429) {
      expect(await moderation.enable()).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMillis: 30000 } });
      await vi.advanceTimersByTimeAsync(30000);
    }
    expect(await moderation.enable()).toEqual({ ok: true });
    moderation.observe([chatPost('resumed', 90001)]);
    expect(await moderation.evaluate('resumed')).toMatchObject({ ok: true, value: { jev: 'evaluated' } });
    expect(fetcher.mock.calls[1][1].body).not.toMatch(/日本語本文expired|期限切れ名前fixture/);
    expect(fetcher).toHaveBeenCalledTimes(2); moderation.reset();
  } finally { vi.useRealTimers(); }
});
it('旧世代429は新世代を直接停止せず通信直前にcooldownを抑止し期限後だけ明示再開する', async () => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  try {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
      .mockImplementation(async () => new Response(JSON.stringify(apiResponse())));
    const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
    await moderation.enable(); moderation.observe([chatPost('old')]);
    await vi.advanceTimersByTimeAsync(50000);
    const pending = moderation.evaluate('old'); await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10001);
    moderation.stop(); expect(await moderation.enable()).toEqual({ ok: true });
    moderation.observe([chatPost('new', 60001)]);
    finish(new Response('{}', { status: 429, headers: { 'Retry-After': '30' } }));
    expect(await pending).toMatchObject({ ok: false, error: { code: 'aborted' } });
    const suppressed = await moderation.evaluate('new');
    expect(suppressed).toMatchObject({ ok: true, value: { jev: 'failed', reasons: [], error: { code: 'rateLimited', retryAfterMillis: 30000 } } });
    if (suppressed.ok) {
      expect(suppressed.value.malicious).toBeUndefined(); expect(suppressed.value.evaluation).toBeUndefined();
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await moderation.evaluate('new')).toEqual(suppressed);
    expect(await moderation.enable()).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMillis: 30000 } });
    await vi.advanceTimersByTimeAsync(29999);
    expect(await moderation.enable()).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMillis: 1 } });
    moderation.observe([chatPost('still-stopped', 90000)]);
    expect(await moderation.evaluate('still-stopped')).toMatchObject({ ok: true, value: { jev: 'disabled' } });
    await vi.advanceTimersByTimeAsync(1);
    moderation.observe([chatPost('no-auto-resume', 90001)]);
    expect(await moderation.evaluate('no-auto-resume')).toMatchObject({ ok: true, value: { jev: 'disabled' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await moderation.enable()).toEqual({ ok: true });
    moderation.observe([chatPost('resumed', 90001)]);
    expect(await moderation.evaluate('resumed')).toMatchObject({ ok: true, value: { jev: 'evaluated' } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    moderation.reset();
  } finally { vi.useRealTimers(); }
});
it('新評価開始時の閾値snapshotをin-flight/cachedに保持しqueued次評価だけ新設定を使う', async () => {
  let threshold = 0.65;
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockImplementation(async () => new Response(JSON.stringify(apiResponse({ attack: 0.7 }))));
  const readThreshold = vi.fn(async () => threshold);
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic', readThreshold });
  await moderation.enable(); moderation.observe([chatPost('snapshot'), chatPost('next', 1)]);
  const first = moderation.evaluate('snapshot'); const next = moderation.evaluate('next');
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  threshold = 0.9; finish(new Response(JSON.stringify(apiResponse({ attack: 0.7 }))));
  const result = await first;
  expect(result).toMatchObject({ ok: true, value: { threshold: 0.65, malicious: true, reasons: ['attack'] } });
  expect(await next).toMatchObject({ ok: true, value: { threshold: 0.9, malicious: false, reasons: [] } });
  expect(await moderation.evaluate('snapshot')).toEqual(result);
  expect(readThreshold).toHaveBeenCalledTimes(2); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(JSON.parse(fetcher.mock.calls[0][1].body))).not.toContain('threshold');
  moderation.reset();
});
it.each([0, 1, 0.731])('custom閾値%sは数値0を欠落扱いせず結果に保持する', async threshold => {
  const moderation = createModeration({ client: createJevClient(async () => new Response(JSON.stringify(apiResponse()))),
    readKey: async () => 'synthetic', readThreshold: async () => threshold });
  await moderation.enable(); moderation.observe([chatPost('custom')]);
  expect(await moderation.evaluate('custom')).toMatchObject({ ok: true, value: { threshold, malicious: threshold === 0 } });
  moderation.reset();
});
it('閾値読取失敗はAPIを呼ばず悪質/安全にも確定しない', async () => {
  const fetcher = vi.fn();
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic',
    readThreshold: async () => { throw new Error('fixture storage'); } });
  await moderation.enable(); moderation.observe([chatPost('failed-setting')]);
  const result = await moderation.evaluate('failed-setting');
  expect(result).toMatchObject({ ok: true, value: { jev: 'failed', error: { code: 'network' } } });
  if (result.ok) expect(result.value.malicious).toBeUndefined();
  expect(fetcher).not.toHaveBeenCalled(); moderation.reset();
});
it('大量観測の判定記録も10000件までで、保持外IDを正常判定にしない', async () => {
  const moderation = createModeration({ client: createJevClient(vi.fn()), readKey: async () => undefined });
  moderation.observe(Array.from({ length: 10001 }, (_, i) => ({ ...chatPost(`many-${i}`, 0, `author-${i}`), publishedAt: undefined })));
  expect(await moderation.evaluate('many-9999')).toMatchObject({ ok: true, value: { jev: 'disabled' } });
  expect(await moderation.evaluate('many-10000')).toMatchObject({ ok: false });
  moderation.reset();
});
it('処理中が長くてもidleで未評価queueを解放し遅延結果で新しい同IDを評価しない', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: Awaited<ReturnType<ReturnType<typeof createJevClient>['evaluate']>>) => void;
    const client = { evaluate: vi.fn(() => new Promise<Awaited<ReturnType<ReturnType<typeof createJevClient>['evaluate']>>>(resolve => { finish = resolve; })) };
    const moderation = createModeration({ client, readKey: async () => 'synthetic' });
    await moderation.enable(); moderation.observe([chatPost('active'), chatPost('waiting', 1)]);
    const active = moderation.evaluate('active'); const waiting = moderation.evaluate('waiting');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60001);
    let resolved = false;
    void waiting.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(0);
    const expiredWhileActive = resolved;
    moderation.observe([chatPost('active', 2, 'new-author')]);
    finish({ ok: false, error: { code: 'network' } });
    expect(await active).toMatchObject({ ok: true, value: { authorChannelId: 'fixture-author', jev: 'failed', error: { code: 'network' } } }); await waiting;
    expect(await moderation.evaluate('active')).toMatchObject({ ok: true, value: { authorChannelId: 'new-author', jev: 'disabled' } });
    expect(expiredWhileActive).toBe(true);
    expect(client.evaluate).toHaveBeenCalledTimes(1);
    moderation.reset();
  } finally { vi.useRealTimers(); }
});
it('idleで判定記録を破棄し遅延悪質応答も期限切れIDへ返さない', async () => {
  vi.useFakeTimers();
  try {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
    await moderation.enable(); moderation.observe([chatPost('old')]);
    await vi.advanceTimersByTimeAsync(50000);
    const pending = moderation.evaluate('old');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10001);
    finish(new Response(JSON.stringify(apiResponse({ attack: 1 }))));
    expect(await pending).toMatchObject({ ok: false });
    expect(await moderation.evaluate('old')).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    moderation.reset();
  } finally { vi.useRealTimers(); }
});
it('判定待ち200件を超えた要求は即時拒否し正常判定にしない', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockImplementation(async () => new Response(JSON.stringify(apiResponse())));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
  await moderation.enable();
  moderation.observe(Array.from({ length: 201 }, (_, i) => chatPost(`q-${i}`, i, `author-${i}`)));
  const queued = Array.from({ length: 200 }, (_, i) => moderation.evaluate(`q-${i}`));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const overflow = moderation.evaluate('q-200');
  const result = await Promise.race([overflow, new Promise(resolve => setTimeout(() => resolve('blocked'), 20))]);
  moderation.stop(); finish(new Response(JSON.stringify(apiResponse())));
  await Promise.all(queued); await overflow; moderation.reset();
  expect(result).toMatchObject({ ok: false });
});
it('storage変更通知より先にキー差替えを検出しても停止し同IDを再送信しない', async () => {
  const readKey = vi.fn().mockResolvedValueOnce('synthetic').mockResolvedValueOnce('synthetic').mockResolvedValue('replacement');
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(apiResponse({ attack: 1 }))));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey });
  await moderation.enable(); moderation.observe([chatPost('one'), chatPost('two', 1)]);
  expect(await moderation.evaluate('one')).toMatchObject({ ok: false, error: { code: 'aborted' } });
  await moderation.evaluate('one'); await moderation.evaluate('two');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['stop', 'reset', 'keyChange'] as const)('%sが応答後のキー再確認中に起きても旧悪質結果を返さない', async action => {
  let finishRead!: (key: string | undefined) => void;
  const readKey = vi.fn().mockResolvedValue('synthetic');
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(apiResponse({ attack: 1 }))));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey });
  await moderation.enable(); moderation.observe([chatPost('late')]);
  readKey.mockResolvedValueOnce('synthetic').mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
  const pending = moderation.evaluate('late');
  await vi.waitFor(() => expect(finishRead).toBeTypeOf('function'));
  if (action === 'reset') moderation.reset(); else moderation.stop();
  finishRead(action === 'keyChange' ? 'replacement' : 'synthetic');
  expect(await pending).toEqual({ ok: false, error: { code: 'aborted' } });
});
it('529 RetryAfterはworker再作成/動画再選択でもsessionから継承し本文・キーは永続化しない', async () => {
  const values: Record<string, unknown> = {};
  const session = { get: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, values[key]])), set: async (data: Record<string, unknown>) => { Object.assign(values, data); } };
  const fetcher = vi.fn().mockImplementation(async () => new Response('{}', { status: 529, headers: { 'Retry-After': '60' } }));
  const deps = { client: createJevClient(fetcher), readKey: async () => 'synthetic', now: () => 0, session };
  const moderation = createModeration(deps);
  await moderation.enable(); moderation.observe([chatPost('one')]); await moderation.evaluate('one');
  moderation.reset();
  expect(await createModeration(deps).enable()).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMillis: 60000 } });
  expect(JSON.stringify(values)).not.toMatch(/synthetic|日本語|author|one/);
});
it.each([401, 422, 429, 529, 200])('HTTP%iの失敗/不正応答は悪質にも該当なしにもせず停止する', async status => {
  const fetcher = vi.fn().mockImplementation(async () => new Response('{}', { status }));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
  await moderation.enable(); moderation.observe([chatPost('one'), chatPost('two', 1)]);
  const result = await moderation.evaluate('one');
  expect(result).toMatchObject({ ok: true, value: { jev: 'failed', reasons: [] } });
  if (result.ok) expect(result.value.malicious).toBeUndefined();
  await moderation.evaluate('two'); expect(fetcher).toHaveBeenCalledTimes(1);
});
it('並行要求も直列化し同IDは通信しない、停止/キー変更/新sessionの遅延結果を隔離する', async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockImplementation(async () => new Response(JSON.stringify(apiResponse())));
  const readKey = vi.fn(async () => 'synthetic-jev');
  const moderation = createModeration({ client: createJevClient(fetcher), readKey });
  await moderation.enable(); moderation.observe([chatPost('a'), chatPost('b', 1)]);
  const first = moderation.evaluate('a');
  const duplicate = moderation.evaluate('a');
  const second = moderation.evaluate('b');
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  moderation.stop();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  finish(new Response(JSON.stringify(apiResponse({ attack: 1 }))));
  expect(await first).toMatchObject({ ok: false, error: { code: 'aborted' } });
  await duplicate; await second;
  expect(fetcher).toHaveBeenCalledTimes(1);
  await moderation.enable(); moderation.observe([chatPost('a')]); await moderation.evaluate('a');
  expect(fetcher).toHaveBeenCalledTimes(1);
  moderation.reset();
  await moderation.enable(); moderation.observe([chatPost('a')]);
  expect(await moderation.evaluate('a')).toMatchObject({ ok: true, value: { malicious: false } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('429 RetryAfterで停止、明示再開も期限前は拒否し自動retryしない', async () => {
  let now = 0;
  const fetcher = vi.fn().mockImplementation(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '10' } }));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic', now: () => now });
  await moderation.enable(); moderation.observe([chatPost('a'), chatPost('b', 1)]);
  expect(await moderation.evaluate('a')).toMatchObject({ ok: true, value: { jev: 'failed', error: { code: 'rateLimited' } } });
  expect(await moderation.evaluate('b')).toMatchObject({ ok: true, value: { jev: 'disabled' } });
  expect(await moderation.enable()).toMatchObject({ ok: false, error: { code: 'rateLimited', retryAfterMillis: 10000 } });
  now = 10000;
  expect(await moderation.enable()).toEqual({ ok: true });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('連投確定はJev未有効化/失敗とは独立の正の根拠、キーなしで通信しない', async () => {
  const fetcher = vi.fn();
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => undefined });
  expect(await moderation.enable()).toMatchObject({ ok: false, error: { code: 'missingKey' } });
  moderation.observe(Array.from({ length: 10 }, (_, i) => chatPost(`${i}`, i === 9 ? 10000 : i * 1000)));
  expect(await moderation.evaluate('9')).toMatchObject({ ok: true, value: { malicious: true, reasons: ['burst'], jev: 'disabled', burst: 'confirmed' } });
  expect(fetcher).not.toHaveBeenCalled();
});
it('Jev通信失敗/キー変更/判定だけの停止はローカル連投の時刻根拠を消さない、取得停止は文脈を解放', async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response('{}', { status: 401 }));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
  await moderation.enable();
  moderation.observe(Array.from({ length: 9 }, (_, i) => chatPost(`${i}`, i * 1000)));
  await moderation.evaluate('0'); // Jev failure stops only external evaluation.
  moderation.stop();
  moderation.observe([chatPost('9', 10000)]);
  expect(await moderation.evaluate('9')).toMatchObject({ ok: true, value: { malicious: true, reasons: ['burst'] } });
  moderation.stopCollection();
  moderation.observe([chatPost('fresh', 10001)]);
  expect(await moderation.evaluate('fresh')).toMatchObject({ ok: true, value: { burst: 'notObserved' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('実取得コメントだけを有効化後1件ずつ評価しIDはローカルで対応付ける', async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(apiResponse({ attack: 0.8 }))));
  const readKey = vi.fn(async () => 'synthetic-jev');
  const moderation = createModeration({ client: createJevClient(fetcher), readKey });
  moderation.observe([chatPost('one'), chatPost('other', 1, 'other-author')]);
  expect(await moderation.evaluate('forged')).toMatchObject({ ok: false });
  expect(await moderation.evaluate('one')).toMatchObject({ ok: true, value: { id: 'one', jev: 'disabled' } });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await moderation.enable()).toEqual({ ok: true });
  moderation.observe([chatPost('two', 1000)]);
  expect(await moderation.evaluate('two')).toMatchObject({ ok: true, value: { id: 'two', authorChannelId: 'fixture-author', malicious: true, reasons: ['attack'], jev: 'evaluated', burst: 'notObserved' } });
  const state = JSON.parse(fetcher.mock.calls[0][1].body).state;
  expect(state).toEqual({ target: { text: '日本語本文two', publishedAt: chatPost('two', 1000).publishedAt }, history: [{ text: '日本語本文one', publishedAt: chatPost('one').publishedAt }] });
  expect(JSON.stringify(state)).not.toMatch(/author|"id"|synthetic|other/);
  await moderation.evaluate('two');
  moderation.observe([chatPost('two', 1000)]);
  await moderation.evaluate('two');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
