import { expect, it, vi } from 'vitest';

it('配信別local永続を再起動後も読み、解除で古い判定を無効化し新規観測だけ再登録できる', async () => {
  const module = await import('../src/hidden-authors/store').catch(() => ({}));
  expect(module).toHaveProperty('createHiddenAuthors');
  if (!('createHiddenAuthors' in module)) return;
  const values: Record<string, unknown> = {};
  const storage = {
    get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(values[key])]))),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); }),
  };
  const initialize = vi.fn(async () => {});
  const store = module.createHiddenAuthors({ storage, initialize });
  const video = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
  const revision = await store.revision(video, author);
  await store.add(video, author, revision);
  expect(await store.list(video)).toEqual([author]);
  expect(await store.list('zyxwvutsrqp')).toEqual([]);
  const restarted = module.createHiddenAuthors({ storage, initialize });
  expect(await restarted.list(video)).toEqual([author]);
  await restarted.remove(video, author);
  expect(await restarted.list(video)).toEqual([]);
  await restarted.add(video, author, revision);
  expect(await restarted.list(video)).toEqual([]);
  await restarted.add(video, author, await restarted.revision(video, author));
  expect(await restarted.list(video)).toEqual([author]);
  expect(initialize).toHaveBeenCalled();
});
