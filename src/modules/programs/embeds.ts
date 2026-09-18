// Turns a pasted share link into something an <iframe> can show. Pure, so the lesson page can render
// blocks from it and the action can validate with it. Anything that is not one of these three is rejected.

export type VideoProvider = 'youtube' | 'loom' | 'tella';
export type VideoEmbed = { provider: VideoProvider; id: string; url: string; embed_url: string };

const ID = /^[A-Za-z0-9_-]{4,128}$/;

export function parseVideoUrl(input: string): VideoEmbed | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const parts = u.pathname.split('/').filter(Boolean);
  const pick = (id: string | undefined | null, provider: VideoProvider, embed: (id: string) => string): VideoEmbed | null =>
    id && ID.test(id) ? { provider, id, url: u.toString(), embed_url: embed(id) } : null;

  if (host === 'youtu.be') return pick(parts[0], 'youtube', (id) => `https://www.youtube-nocookie.com/embed/${id}`);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = parts[0] === 'watch' ? u.searchParams.get('v') : ['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '') ? parts[1] : null;
    return pick(id, 'youtube', (v) => `https://www.youtube-nocookie.com/embed/${v}`);
  }
  if (host === 'loom.com') {
    const id = parts[0] === 'share' || parts[0] === 'embed' ? parts[1] : null;
    return pick(id, 'loom', (v) => `https://www.loom.com/embed/${v}`);
  }
  if (host === 'tella.tv') {
    const id = parts[0] === 'video' ? parts[1] : null;
    return pick(id, 'tella', (v) => `https://www.tella.tv/video/${v}/embed`);
  }
  return null;
}

export const VIDEO_PROVIDER_LABEL: Record<VideoProvider, string> = { youtube: 'YouTube', loom: 'Loom', tella: 'Tella' };
