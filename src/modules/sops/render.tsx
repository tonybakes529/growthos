import type { ReactNode } from 'react';
import type { SopStep } from './actions';
import { parseVideoUrl, VIDEO_PROVIDER_LABEL } from '@/modules/programs/embeds';

/**
 * Minimal, dependency-free rendering of the markdown-ish bodies SOPs hold: headings, bullet and
 * numbered lists, paragraphs. Everything is emitted as text nodes, so nothing in a body can inject markup.
 */
export function SopBody({ body }: { body: string }) {
  const lines = body.replace(/\\n/g, '\n').split('\n');
  const out: ReactNode[] = [];
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}>{t}</li>);
    out.push(list.kind === 'ul' ? <ul key={out.length}>{items}</ul> : <ol key={out.length}>{items}</ol>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const number = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (bullet) { if (list?.kind !== 'ul') { flush(); list = { kind: 'ul', items: [] }; } list.items.push(bullet[1]!); continue; }
    if (number) { if (list?.kind !== 'ol') { flush(); list = { kind: 'ol', items: [] }; } list.items.push(number[1]!); continue; }
    flush();
    if (!line.trim()) continue;
    const video = /^https?:\/\/\S+$/.test(line.trim()) ? parseVideoUrl(line.trim()) : null;
    if (video) {
      out.push(<div className="video" key={out.length}><iframe src={video.embed_url} title={`${VIDEO_PROVIDER_LABEL[video.provider]} video`} allow="autoplay; fullscreen; picture-in-picture; clipboard-write" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" loading="lazy" /></div>);
      continue;
    }
    if (heading) { out.push(heading[1]!.length === 1 ? <h2 key={out.length}>{heading[2]}</h2> : <h3 key={out.length}>{heading[2]}</h3>); continue; }
    out.push(<p key={out.length}>{line}</p>);
  }
  flush();
  return <div className="sopbody">{out}</div>;
}

export function SopSteps({ steps }: { steps: unknown }) {
  if (!Array.isArray(steps) || !steps.length) return null;
  return (
    <ol className="sopsteps">
      {(steps as SopStep[]).map((s, i) => (
        <li key={i}><b>{s.title ?? `Step ${i + 1}`}</b>{(s.text || s.detail) && <div className="muted">{s.text ?? s.detail}</div>}</li>
      ))}
    </ol>
  );
}
