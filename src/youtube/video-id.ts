export function videoIdFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://www.youtube.com') return undefined;
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/live\/([^/]+)$/.exec(url.pathname)?.[1];
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined;
  } catch { return undefined; }
}
