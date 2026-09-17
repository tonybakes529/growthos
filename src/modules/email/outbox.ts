import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { getEnv } from '@/lib/env';

export interface EmailProvider {
  send(msg: { to: string; subject: string; html: string; text?: string }): Promise<{ id: string }>;
}

/** Resend over plain fetch (no SDK dependency). Swap for Postmark/SES by implementing EmailProvider. */
export const resendProvider: EmailProvider = {
  async send(msg) {
    const env = getEnv();
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error('Email provider not configured');
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    return (await res.json()) as { id: string };
  },
};

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const fill = (tpl: string, vars: Record<string, unknown>, html: boolean) =>
  tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k] === undefined || vars[k] === null ? '' : String(vars[k]);
    return html ? escape(v) : v;
  });

/** Drains email_outbox. Org-specific templates override platform defaults by key. */
export async function drainEmailOutbox(provider: EmailProvider = resendProvider, limit = 50) {
  const admin = createAdminClient();
  const { data: queue } = await admin.from('email_outbox').select('*')
    .eq('status', 'queued').lte('send_after', new Date().toISOString()).order('id').limit(limit);
  let sent = 0, failed = 0;
  for (const m of queue ?? []) {
    const { data: claimed } = await admin.from('email_outbox').update({ status: 'sending', attempts: m.attempts + 1 })
      .eq('id', m.id).eq('status', 'queued').select('id').maybeSingle();
    if (!claimed) continue;
    try {
      const { data: templates } = await admin.from('email_templates').select('organization_id, subject, body_html, body_text')
        .eq('key', m.template_key).eq('is_active', true)
        .or(m.organization_id ? `organization_id.eq.${m.organization_id},organization_id.is.null` : 'organization_id.is.null');
      const tpl = templates?.find((t) => t.organization_id === m.organization_id) ?? templates?.find((t) => t.organization_id === null);
      if (!tpl) throw new Error(`no template for ${m.template_key}`);
      const vars = { app_url: getEnv().NEXT_PUBLIC_APP_URL, ...(m.variables as Record<string, unknown>) };
      const res = await provider.send({
        to: m.to_email, subject: fill(tpl.subject, vars, false), html: fill(tpl.body_html, vars, true),
        text: tpl.body_text ? fill(tpl.body_text, vars, false) : undefined,
      });
      // strip one-time secrets (invitation links) once delivered
      await admin.from('email_outbox').update({
        status: 'sent', sent_at: new Date().toISOString(), provider_message_id: res.id, variables: {},
      }).eq('id', m.id);
      sent++;
    } catch (e) {
      failed++;
      await admin.from('email_outbox').update({
        status: m.attempts + 1 >= 5 ? 'failed' : 'queued', last_error: String(e),
        send_after: new Date(Date.now() + 2 ** (m.attempts + 1) * 60_000).toISOString(),
      }).eq('id', m.id);
    }
  }
  return { sent, failed };
}
