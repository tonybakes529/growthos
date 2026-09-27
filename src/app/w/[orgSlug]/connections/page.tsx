import { requireOrgPage, can } from '@/lib/auth/context';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill, dayTime } from '@/components/ui';
import { ApiKeyPanel, GuidedSetup, type AppAuth } from '@/components/zapier-connections';
import {
  checkAppAuthorizations, disconnectZapier, getConnections, issueZapierKey,
  removeWorkflow, saveWorkflow, sendTestEvent,
} from '@/modules/connections/actions';
import { TEMPLATES } from '@/modules/connections/templates';

type Status = { tone: string; label: string; says: string };

const NOT_CONNECTED: Status = {
  tone: 'paused', label: 'not connected',
  says: 'No Zapier account has been authorised for this workspace yet.',
};

/** What each connection status means, in words, so nobody has to guess what "expired" implies. */
const STATUS: Record<string, Status> = {
  connected: { tone: 'active', label: 'connected', says: 'This workspace has authorised its own Zapier account. Zaps built with it live in that account and run on its plan.' },
  disconnected: NOT_CONNECTED,
  expired: { tone: 'overdue', label: 'expired', says: 'The authorisation has lapsed and could not be renewed. Reconnect to carry on.' },
  revoked: { tone: 'overdue', label: 'revoked', says: 'The authorisation was withdrawn from inside Zapier. Reconnect to carry on.' },
  error: { tone: 'overdue', label: 'error', says: 'The last attempt to use the authorisation failed. The reason is below.' },
};

const DELIVERY: Record<string, string> = {
  delivered: 'Zapier accepted it', pending: 'waiting to be sent', failed: 'gave up after retrying', dropped: 'the Zap was gone',
};

export default async function Connections({ params, searchParams }: {
  params: Promise<{ orgSlug: string }>; searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const [{ orgSlug }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrgPage(orgSlug);
  const path = `/w/${orgSlug}/connections`;
  if (!can(ctx, 'connections.read')) {
    return (<><PageHead sub={ctx.name} title="Connections" /><div className="card muted">You don&apos;t have access to connections.</div></>);
  }
  const manage = can(ctx, 'connections.manage');

  const res = await getConnections({ orgSlug });
  if (!res.ok) {
    return (<><PageHead sub={ctx.name} title="Connections" /><Flash err={res.error.message} /></>);
  }
  const { setup, connection, apiKey, subscriptions, recentDeliveries, workflows } = res.data;
  const status = STATUS[connection?.status ?? 'disconnected'] ?? NOT_CONNECTED;
  const live = connection?.status === 'connected';

  // only worth asking their Zapier account once there is an authorisation to ask with
  const authRes = live ? await checkAppAuthorizations({ orgSlug }) : null;
  const auth = authRes?.ok ? authRes.data : null;
  const apps: AppAuth[] = auth?.apps ?? [
    { app: 'slack', label: 'Slack', confirmed: false, accountTitle: null },
    { app: 'google_calendar', label: 'Google Calendar', confirmed: false, accountTitle: null },
  ];
  const appsReason = auth?.reason
    ?? (authRes && !authRes.ok ? authRes.error.message : undefined)
    ?? (live ? undefined : 'No Zapier account is connected to this workspace yet.');

  const listening = subscriptions.filter((s) => s.isActive).map((s) => s.eventType);

  async function issue() {
    'use server';
    const r = await issueZapierKey({ orgSlug });
    return r;
  }
  async function test(templateKey: string) {
    'use server';
    return sendTestEvent({ orgSlug, templateKey });
  }
  async function disconnect() {
    'use server';
    done(path, await disconnectZapier({ orgSlug }),
      (d) => `Zapier disconnected. ${d.subscriptionsStopped} ${d.subscriptionsStopped === 1 ? 'trigger' : 'triggers'} stopped. Any Zaps you built stay in your own Zapier account and simply stop receiving events.`);
  }
  async function saveSetup(f: FormData) {
    'use server';
    const template = String(f.get('template') ?? '');
    const config: Record<string, string> = {};
    for (const [k, v] of f.entries()) if (k.startsWith('cfg_')) config[k.slice(4)] = String(v);
    done(path, await saveWorkflow({ orgSlug, templateKey: template, title: String(f.get('title') ?? ''), config }),
      'Setup saved. Nothing has been switched on: a Zap is switched on in your own Zapier account.');
  }
  async function remove(f: FormData) {
    'use server';
    done(path, await removeWorkflow({ orgSlug, workflowId: String(f.get('id')) }), 'Setup removed');
  }

  return (
    <>
      <PageHead sub={ctx.name} title="Connections" />
      <Flash msg={sp.msg} err={sp.err} />

      {!setup.ready && (
        <div className="card" style={{ borderColor: 'var(--amber)' }}>
          <h2 style={{ marginTop: 0 }}>Setup required</h2>
          <p style={{ marginTop: 0 }}>
            Connecting a Zapier account is not possible on this deployment yet, so the button below is off.
            This is the honest state of it, not a temporary glitch: two things are outstanding.
          </p>
          <ol style={{ margin: '0 0 10px', paddingLeft: 22, lineHeight: 1.6 }}>
            <li>The ScaledOS integration has to be registered with Zapier and published to their App
              Directory. Zapier only issues OAuth credentials, and only allows the API that creates Zaps,
              for a published integration.</li>
            <li>These environment variables have to be set on the deployment:{' '}
              {setup.missing.map((m, i) => <span key={m}>{i ? ', ' : ''}<code>{m}</code></span>)}.</li>
          </ol>
          <p className="sub" style={{ margin: 0 }}>
            Until both are done, no account can be connected here. Nothing on this page will claim otherwise.
          </p>
        </div>
      )}

      <div className="card">
        <div className="head">
          <div>
            <h2 style={{ margin: 0 }}>Your Zapier account</h2>
            <p className="sub" style={{ margin: '4px 0 0', maxWidth: '62ch' }}>
              This workspace connects its own Zapier account. Every Zap you build belongs to that account
              and runs on its plan and its task allowance. ScaledOS never runs your automations on someone
              else&apos;s account, and there is no shared account to fall back to.
            </p>
          </div>
          <Pill value={status.tone} label={status.label} />
        </div>

        <p style={{ marginBottom: 4 }}>{status.says}</p>
        <dl style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '4px 12px', margin: '10px 0 0', fontSize: 14 }}>
          <dt className="muted">Account</dt>
          <dd style={{ margin: 0 }}>{connection?.accountLabel ?? <span className="muted">Zapier did not give us a name for it</span>}</dd>
          <dt className="muted">Connected</dt>
          <dd style={{ margin: 0 }}>{connection?.connectedAt ? dayTime(connection.connectedAt) : '—'}</dd>
          <dt className="muted">Access renews</dt>
          <dd style={{ margin: 0 }}>{connection?.expiresAt ? dayTime(connection.expiresAt) : '—'}</dd>
          <dt className="muted">Permissions asked for</dt>
          <dd style={{ margin: 0 }} className="wrap">{connection?.scopes.length ? connection.scopes.join(', ') : '—'}</dd>
        </dl>
        {connection?.lastError && <p className="flash err" style={{ wordBreak: 'normal' }}>{connection.lastError}</p>}

        {manage && (
          <div className="row" style={{ marginTop: 12 }}>
            {setup.ready
              ? <a className="btn primary" href={`/api/zapier/oauth/start?workspace=${orgSlug}`}>{live ? 'Reconnect' : 'Connect Zapier'}</a>
              : <button className="btn primary" type="button" disabled>Connect Zapier</button>}
            {connection && connection.status !== 'disconnected' && (
              <form action={disconnect}>
                <button className="btn" type="submit">Disconnect</button>
              </form>
            )}
          </div>
        )}
        {manage && connection && connection.status !== 'disconnected' && (
          <p className="sub" style={{ margin: '8px 0 0' }}>
            Disconnecting forgets the tokens here and stops sending events. It cannot delete Zaps in your
            Zapier account, because they are yours: they stay, and stop receiving anything from here.
          </p>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Apps</h2>
        <p className="sub" style={{ marginTop: 0, maxWidth: '62ch' }}>
          Connecting Zapier is not the same as authorising Slack or Google Calendar. Those are authorised
          inside Zapier, in your account, which is where the tokens for them live. Nothing is shown as
          connected here unless your Zapier account has told us it is.
        </p>
        <ul className="attn">
          {apps.map((a) => (
            <li key={a.app}>
              <span>
                <b>{a.label}</b>
                {a.confirmed
                  ? <span className="sub"> authorised in your Zapier account{a.accountTitle ? ` as ${a.accountTitle}` : ''}</span>
                  : <span className="sub"> not confirmed{auth?.checked === false || !live ? ` — ${appsReason ?? 'we could not ask your Zapier account'}` : ' — your Zapier account does not list it'}</span>}
              </span>
              <span className="row" style={{ gap: 8 }}>
                <Pill value={a.confirmed ? 'active' : 'paused'} label={a.confirmed ? 'authorised' : 'not confirmed'} />
                <a className="btn small" href="https://zapier.com/app/connections" target="_blank" rel="noreferrer noopener">Authorise in Zapier</a>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <ApiKeyPanel issue={issue} canManage={manage}
                   existing={apiKey ? { prefix: apiKey.prefix, createdAt: apiKey.createdAt, lastUsedAt: apiKey.lastUsedAt } : null} />

      <div>
        <div className="head" style={{ marginBottom: 10 }}>
          <div>
            <h2 style={{ margin: 0 }}>Automations you can set up</h2>
            <p className="sub" style={{ margin: '4px 0 0', maxWidth: '62ch' }}>
              A ScaledOS event, an app, the destination and the fields, step by step. A template that
              cannot be built honestly on the data we hold is marked unavailable, with the reason.
            </p>
          </div>
        </div>
        <GuidedSetup templates={TEMPLATES} save={saveSetup} test={test} listening={listening}
                     connected={live} ready={setup.ready} canManage={manage}
                     appsChecked={!!auth?.checked} appsReason={appsReason} apps={apps} />
      </div>

      {!!workflows.length && (
        <div className="card tablewrap">
          <h2 style={{ marginTop: 0 }}>Setups saved here</h2>
          <table>
            <thead><tr><th>Name</th><th>App</th><th>Trigger</th><th>State</th><th /></tr></thead>
            <tbody>
              {workflows.map((w) => (
                <tr key={w.id}>
                  <td className="wrap"><b>{w.title}</b>{w.lastError && <div className="sub wrap">{w.lastError}</div>}</td>
                  <td>{w.app.replace(/_/g, ' ')}</td>
                  <td><code>{TEMPLATES.find((t) => t.key === w.templateKey)?.eventType ?? w.templateKey}</code></td>
                  <td><Pill value={w.status === 'on' ? 'active' : w.status === 'error' ? 'overdue' : 'paused'}
                            label={w.status === 'needs_setup' ? 'setup required' : w.status} /></td>
                  <td>{manage && (
                    <form action={remove}><input type="hidden" name="id" value={w.id} />
                      <button className="btn small" type="submit">Remove</button></form>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="sub" style={{ marginBottom: 0 }}>
            A saved setup is a written-down configuration, not a running Zap. It reads <b>on</b> only when
            Zapier has told us a Zap of yours is switched on for that trigger.
          </p>
        </div>
      )}

      <div className="card tablewrap">
        <h2 style={{ marginTop: 0 }}>Zaps listening</h2>
        <p className="sub" style={{ marginTop: 0 }}>
          Zapier subscribes when you switch a Zap on and unsubscribes when you switch it off. This is
          what it has told us.
        </p>
        <table>
          <thead><tr><th>Trigger</th><th>Zap</th><th>State</th><th>Last sent</th><th>Failures</th></tr></thead>
          <tbody>
            {subscriptions.map((s) => (
              <tr key={s.id}>
                <td><code>{s.eventType}</code></td>
                <td>{s.zapId ?? <span className="muted">not named</span>}</td>
                <td><Pill value={s.isActive ? 'active' : 'paused'} label={s.isActive ? 'on' : 'off'} /></td>
                <td>{dayTime(s.lastDeliveryAt)}</td>
                <td>{s.failureCount || '—'}</td>
              </tr>
            ))}
            {!subscriptions.length && <tr><td colSpan={5} className="muted">Nothing is listening yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card tablewrap">
        <h2 style={{ marginTop: 0 }}>Handed to Zapier</h2>
        <p className="sub" style={{ marginTop: 0, maxWidth: '62ch' }}>
          Every row below means ScaledOS handed the event to Zapier and Zapier accepted it. It does not
          mean a Slack message was posted or a calendar entry created: that happens inside your Zap, and
          your own Zap history is the only honest record of it. Each event carries a stable id, so a
          retry is the same event again rather than a second one.
        </p>
        <table>
          <thead><tr><th>Event</th><th>State</th><th>Tries</th><th>Reply</th><th>Queued</th><th>Accepted</th></tr></thead>
          <tbody>
            {recentDeliveries.map((d) => (
              <tr key={d.eventKey + d.createdAt}>
                <td><code>{d.eventKey}</code></td>
                <td><Pill value={d.status === 'delivered' ? 'active' : d.status === 'pending' ? 'paused' : 'overdue'}
                          label={DELIVERY[d.status] ?? d.status} /></td>
                <td>{d.attempts}</td>
                <td>{d.responseCode ?? '—'}</td>
                <td>{dayTime(d.createdAt)}</td>
                <td>{dayTime(d.deliveredAt)}</td>
              </tr>
            ))}
            {!recentDeliveries.length && <tr><td colSpan={6} className="muted">Nothing has been handed over yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
