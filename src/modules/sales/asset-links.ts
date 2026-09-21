/** A link on a setter asset. The label is optional; without one the link shows as its address. */
export type AssetLink = { label: string | null; url: string };

export const MAX_ASSET_LINKS = 50;

const URL_IN_LINE = /(https?:\/\/\S+|www\.\S+)/i;
const BARE_DOMAIN = /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i;
const EDGE_PUNCTUATION = /^[\s:|•–—-]+|[\s:|•–—-]+$/g;

/**
 * One link per line. Anything on the same line before or after the link becomes its label, so
 * "Smith roof job: https://..." and a bare "https://..." both work, as does "calendly.com/acme".
 */
export function parseAssetLinks(text: string): { links: AssetLink[]; error: string | null } {
  const links: AssetLink[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const [n, line] of lines.entries()) {
    const raw = line.match(URL_IN_LINE)?.[0] ?? (BARE_DOMAIN.test(line) ? line : null);
    if (!raw) return { links: [], error: `Line ${n + 1} has no link in it: "${line.slice(0, 60)}"` };
    // a link pasted from a sentence often carries the sentence's full stop or comma
    const cleaned = raw.replace(/[.,;]+$/, '');
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`);
    } catch {
      return { links: [], error: `Line ${n + 1} is not a valid link: "${cleaned.slice(0, 60)}"` };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { links: [], error: `Line ${n + 1} must be a web link (http or https)` };
    if (url.href.length > 2000) return { links: [], error: `Line ${n + 1} is too long` };
    const label = line.replace(raw, ' ').replace(/\s+/g, ' ').replace(EDGE_PUNCTUATION, '').trim();
    links.push({ label: label ? label.slice(0, 120) : null, url: url.href });
  }
  if (links.length > MAX_ASSET_LINKS) return { links: [], error: `Up to ${MAX_ASSET_LINKS} links per asset` };
  return { links, error: null };
}

/** The inverse of parseAssetLinks, for the edit box. */
export const formatAssetLinks = (links: AssetLink[]) => links.map((l) => (l.label ? `${l.label}: ${l.url}` : l.url)).join('\n');

/** "example.com/case-study" for a link without a label. */
export function linkText(l: AssetLink): string {
  if (l.label) return l.label;
  try {
    const u = new URL(l.url);
    const text = `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
    return text.length > 70 ? `${text.slice(0, 67)}…` : text;
  } catch {
    return l.url;
  }
}
