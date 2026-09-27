'use client';

import { useEffect, useRef, useState } from 'react';
import type { ActionResult } from '@/lib/action';
import type { Template } from '@/modules/connections/templates';

type Issue = () => Promise<ActionResult<{ key: string; baseUrl: string }>>;
type Test = (templateKey: string) => Promise<ActionResult<{ status: number; targetHost: string }>>;
type FormAction = (f: FormData) => Promise<void>;

export type AppAuth = { app: string; label: string; confirmed: boolean; accountTitle: string | null };

/**
 * The key Zapier uses to reach this workspace.
 *
 * Only a hash of it is stored, so it genuinely cannot be shown again: the panel says so rather than
 * pretending the key can be looked up later. Issuing a new one revokes the old one, which would stop
 * any Zap that is already using it, so that is spelled out before the button is pressed.
 */
export function ApiKeyPanel({ issue, existing, canManage }: {
  issue: Issue;
  existing: { prefix: string; createdAt: string; lastUsedAt: string | null } | null;
  canManage: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function go() {
    setBusy(true);
    setErr(null);
    const res = await issue();
    setBusy(false);
    if (!res.ok) { setErr(res.error.message); return; }
    setKey(res.data.key);
  }

  return (
    <div className="card">
      <div className="head" style={{ marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Key for Zapier</h2>
          <p className="sub" style={{ margin: '4px 0 0' }}>
            When you add ScaledOS inside Zapier it asks for a key. This is that key. It identifies this
            workspace, and nothing else: a key issued here can only ever see this workspace&apos;s events.
          </p>
        </div>
      </div>

      {existing && !key && (
        <p className="muted" style={{ marginTop: 0 }}>
          A key was issued on {existing.createdAt.slice(0, 10)} and starts <code>{existing.prefix}</code>.
          {existing.lastUsedAt ? ` Zapier last used it on ${existing.lastUsedAt.slice(0, 10)}.` : ' Zapier has not used it yet.'}
          {' '}Only a hash of it is stored here, so the key itself cannot be shown again.
        </p>
      )}

      {key && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="flash" style={{ margin: 0, wordBreak: 'normal' }}>
            Copy this now. It is shown once and is not stored in a form that can be read back.
          </p>
          <div className="copy">{key}</div>
          <div className="row">
            <button type="button" className="btn small" onClick={() => {
              navigator.clipboard?.writeText(key).then(() => setCopied(true), () => setCopied(false));
            }}>{copied ? 'Copied' : 'Copy key'}</button>
          </div>
        </div>
      )}

      {err && <p className="flash err" style={{ wordBreak: 'normal' }}>{err}</p>}

      {canManage && !key && (
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="btn" disabled={busy} onClick={go}>
            {busy ? 'Issuing…' : existing ? 'Issue a new key' : 'Issue a key'}
          </button>
          {existing && <span className="sub">Issuing a new key revokes the old one, which stops any Zap already using it.</span>}
        </div>
      )}
    </div>
  );
}

const STEPS = ['Trigger', 'App', 'Authorise', 'Destination', 'Fields', 'Test', 'Activate'] as const;

/**
 * The guided setup: a ScaledOS event, an app and action, authorising that app, the destination, the
 * field mapping, a test, and activation.
 *
 * Two of those steps honestly do not happen here. Authorising Slack or Google Calendar happens inside
 * the customer's own Zapier account, and so does switching the Zap on, because that is what makes
 * Zapier subscribe to the trigger. The wizard says which step it can finish and which it cannot,
 * rather than showing a tick for something it has not done.
 */
export function GuidedSetup({ templates, save, test, listening, connected, ready, canManage, appsChecked, appsReason, apps }: {
  templates: Template[];
  save: FormAction;
  test: Test;
  /** Event types some Zap of theirs is currently subscribed to. */
  listening: string[];
  connected: boolean;
  ready: boolean;
  canManage: boolean;
  appsChecked: boolean;
  appsReason?: string;
  apps: AppAuth[];
}) {
  const [open, setOpen] = useState<Template | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && ref.current && !ref.current.open) ref.current.showModal();
    if (!open) ref.current?.close();
  }, [open]);

  return (
    <>
      <div className="assetgrid">
        {templates.map((t) => {
          const hot = listening.includes(t.eventType);
          return (
            <div key={t.key} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: t.available ? 1 : .72 }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="pill gray">{t.appLabel}</span>
                {t.available
                  ? <span className={`pill ${hot ? 'green' : 'gray'}`}>{hot ? 'a Zap is listening' : 'nothing listening yet'}</span>
                  : <span className="pill amber">unavailable</span>}
              </div>
              <b className="wrap">{t.title}</b>
              <p className="sub wrap" style={{ margin: 0 }}>{t.description}</p>
              {t.available
                ? <div className="row" style={{ marginTop: 'auto' }}>
                    <button type="button" className="btn small" disabled={!canManage} onClick={() => setOpen(t)}>Set up</button>
                  </div>
                : <p className="wrap" style={{ margin: 0, fontSize: 13 }}><b>Why not: </b>{t.unavailableReason}</p>}
            </div>
          );
        })}
      </div>

      <dialog ref={ref} className="modal" onClose={() => setOpen(null)}
              onClick={(e) => { if (e.target === ref.current) setOpen(null); }}>
        {open && (
          <Wizard key={open.key} template={open} save={save} test={test} close={() => setOpen(null)}
                  listening={listening.includes(open.eventType)} connected={connected} ready={ready}
                  appsChecked={appsChecked} appsReason={appsReason}
                  app={apps.find((a) => a.app === open.app) ?? null} />
        )}
      </dialog>
    </>
  );
}

function Wizard({ template, save, test, close, listening, connected, ready, appsChecked, appsReason, app }: {
  template: Template; save: FormAction; test: Test; close: () => void;
  listening: boolean; connected: boolean; ready: boolean;
  appsChecked: boolean; appsReason?: string; app: AppAuth | null;
}) {
  const [step, setStep] = useState(0);
  const [cfg, setCfg] = useState<Record<string, string>>(() =>
    Object.fromEntries(template.setupFields.map((f) => [f.key, ''])));
  const [title, setTitle] = useState(template.title);
  const [agreed, setAgreed] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const body = useRef<HTMLTextAreaElement>(null);

  // the free-text field the event fields get mapped into; the rest are the destination
  const mapKey = template.setupFields.find((f) => f.key === 'message' || f.key === 'title')?.key ?? null;
  const destination = template.setupFields.filter((f) => f.key !== mapKey);
  const set = (k: string, v: string) => setCfg((c) => ({ ...c, [k]: v }));

  function insert(token: string) {
    const el = body.current;
    const text = `{{${token}}}`;
    if (!el || !mapKey) return;
    const at = el.selectionStart ?? el.value.length;
    const next = `${el.value.slice(0, at)}${text}${el.value.slice(el.selectionEnd ?? at)}`;
    set(mapKey, next);
    el.focus();
    // the value only lands on the next render, so the caret has to be placed after it
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + text.length, at + text.length); });
  }

  async function runTest() {
    setTesting(true); setTestError(null); setTestResult(null);
    const res = await test(template.key);
    setTesting(false);
    if (!res.ok) { setTestError(res.error.message); return; }
    setTestResult(`Zapier answered ${res.data.status} from ${res.data.targetHost}. That means your Zap received the `
      + `sample event. Whether ${template.appLabel} then did anything is in your own Zap history — it is not `
      + 'something this page can see.');
  }

  return (
    <div className="modal-body">
      <div className="head" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>{template.title}</h2>
        <button type="button" className="btn small" onClick={close} aria-label="Close">✕</button>
      </div>

      <div className="steps" style={{ marginBottom: 14 }}>
        {STEPS.map((s, i) => (
          <span key={s} className={`pill ${i === step ? 'accent' : 'gray'}`}>{i + 1}. {s}</span>
        ))}
      </div>

      {step === 0 && (
        <div className="grid">
          <p style={{ margin: 0 }}>{template.description}</p>
          <p className="sub" style={{ margin: 0 }}>
            The trigger is <code>{template.eventType}</code>. ScaledOS already records this event when it
            happens, so there is nothing to switch on here for it to exist.
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="grid">
          <p style={{ margin: 0 }}>The action runs in <b>{template.appLabel}</b>.</p>
          <p className="sub" style={{ margin: 0 }}>
            It runs inside your own Zapier account, on your plan, and each run uses one task from your
            allowance. ScaledOS does not hold the Zap and does not pay for the tasks.
          </p>
        </div>
      )}

      {step === 2 && (
        <div className="grid">
          <p style={{ margin: 0 }}>
            <b>{template.appLabel}: </b>
            {app?.confirmed
              ? <>authorised in your Zapier account{app.accountTitle ? ` as ${app.accountTitle}` : ''}.</>
              : <>not confirmed.</>}
          </p>
          {!app?.confirmed && (
            <p className="sub" style={{ margin: 0 }}>
              Connecting Zapier and authorising {template.appLabel} are two different things, and one does
              not imply the other. {appsChecked
                ? `We asked your Zapier account and ${template.appLabel} was not among the apps you have authorised.`
                : `We could not ask your Zapier account${appsReason ? `: ${appsReason.replace(/[.\s]+$/, '')}` : ''}, so this is shown as unconfirmed rather than guessed.`}
            </p>
          )}
          <p className="sub" style={{ margin: 0 }}>
            {template.appLabel} is authorised inside Zapier, in your own account, where it holds the token.
            {' '}<a href="https://zapier.com/app/connections" target="_blank" rel="noreferrer noopener">Your Zapier connections</a>{' '}
            is where that is done.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="grid">
          {destination.map((f) => (
            <label key={f.key} className="f">{f.label}{f.required ? <span className="req"> *</span> : null}
              <input value={cfg[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} />
              {f.hint && <span className="qhelp">{f.hint}</span>}
            </label>
          ))}
          <p className="sub" style={{ margin: 0 }}>
            These are recorded here so the setup is written down in one place. Zapier asks for them again
            when you build the Zap, because it is Zapier that talks to {template.appLabel}.
          </p>
        </div>
      )}

      {step === 4 && mapKey && (
        <div className="grid">
          <label className="f">{template.setupFields.find((f) => f.key === mapKey)?.label}
            <textarea ref={body} rows={5} value={cfg[mapKey] ?? ''} onChange={(e) => set(mapKey, e.target.value)} />
          </label>
          <div>
            <p className="sub" style={{ margin: '0 0 6px' }}>Fields this event carries. Click one to drop it in.</p>
            <div className="chips">
              {template.eventFields.map((f) => (
                <button key={f} type="button" className="chip" onClick={() => insert(f)}>{f}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="grid">
          {!listening ? (
            <p className="flash" style={{ margin: 0, wordBreak: 'normal' }}>
              Nothing is listening for <code>{template.eventType}</code> yet. Zapier subscribes when you
              switch the Zap on in your account; once it has, a test can be sent from here.
            </p>
          ) : (
            <>
              <p className="flash err" style={{ margin: 0, wordBreak: 'normal' }}>
                A test sends one sample event straight to your Zap. Your Zap will run: that uses a task
                from your Zapier allowance and, if the Zap is switched on, {template.appLabel} will
                really do what the Zap says. The sample is marked <code>test: true</code>.
              </p>
              <label className="row" style={{ gap: 8, fontWeight: 400 }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                <span>I want to run my Zap now and use a task from my allowance.</span>
              </label>
              <div className="row">
                <button type="button" className="btn" disabled={!agreed || testing} onClick={runTest}>
                  {testing ? 'Sending…' : 'Send a test event'}
                </button>
              </div>
            </>
          )}
          {testResult && <p className="flash" style={{ margin: 0, wordBreak: 'normal' }}>{testResult}</p>}
          {testError && <p className="flash err" style={{ margin: 0, wordBreak: 'normal' }}>{testError}</p>}
        </div>
      )}

      {step === 6 && (
        <form action={save} className="grid">
          <input type="hidden" name="template" value={template.key} />
          {template.setupFields.map((f) => <input key={f.key} type="hidden" name={`cfg_${f.key}`} value={cfg[f.key] ?? ''} />)}
          <label className="f">Name this automation
            <input name="title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />
          </label>
          <p className="sub" style={{ margin: 0 }}>
            Saving writes this setup down here. It does not switch anything on: a Zap is switched on in
            your own Zapier account, and switching it on is exactly what makes Zapier subscribe to the
            trigger. {!ready
              ? 'This deployment is not finished connecting to Zapier yet, so it will be saved as “setup required”.'
              : connected
                ? 'Your Zapier account is connected, so it will be saved as a draft.'
                : 'No Zapier account is connected to this workspace yet, so connect one first.'}
          </p>
          <div className="row">
            <button className="btn primary" type="submit">Save this setup</button>
            <button type="button" className="btn" onClick={close}>Cancel</button>
          </div>
        </form>
      )}

      <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
        <button type="button" className="btn small" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>Back</button>
        <span className="sub">Step {step + 1} of {STEPS.length}</span>
        <button type="button" className="btn small" disabled={step === STEPS.length - 1}
                onClick={() => setStep((s) => s + 1)}>Next</button>
      </div>
    </div>
  );
}
