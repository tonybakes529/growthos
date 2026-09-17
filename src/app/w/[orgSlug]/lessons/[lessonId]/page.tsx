import Link from 'next/link';
import { requireOrg, can } from '@/lib/auth/context';
import { getLesson, upsertLessonBlock } from '@/modules/programs/actions';
import { completeLesson } from '@/modules/enrollments/actions';
import { getQuiz, submitAssignment, submitQuizAttempt } from '@/modules/assignments/actions';
import { done } from '@/components/flash';
import { Flash, PageHead, Pill } from '@/components/ui';

type Option = { id: string; label: string };

export default async function LessonPage({ params, searchParams }: { params: Promise<{ orgSlug: string; lessonId: string }>; searchParams: Promise<{ msg?: string; err?: string }> }) {
  const [{ orgSlug, lessonId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireOrg(orgSlug);
  const path = `/w/${orgSlug}/lessons/${lessonId}`;
  const res = await getLesson({ lessonId });
  if (!res.ok) return <Flash err={res.error.message} />;
  const { lesson, blocks, resources, assignments, quizzes, locked } = res.data;
  const [quizData, subRes] = await Promise.all([
    Promise.all(quizzes.map((q) => getQuiz({ quizId: q.id }))),
    assignments.length
      ? ctx.sb.from('assignment_submissions').select('assignment_id, status, submitted_at')
          .in('assignment_id', assignments.map((a) => a.id)).eq('user_id', ctx.ctx.effective_user_id)
      : null,
  ]);
  const mySubs = subRes?.data ?? [];

  async function complete() {
    'use server';
    done(path, await completeLesson({ lessonId }), (d) => `Lesson complete (${d.progress_percent}%)`);
  }
  async function submit(form: FormData) {
    'use server';
    const link = String(form.get('link') || '');
    done(path, await submitAssignment({ assignmentId: String(form.get('assignment')), body: String(form.get('body') || '') || undefined,
      links: link ? [link] : [] }), 'Assignment submitted');
  }
  async function quiz(form: FormData) {
    'use server';
    const answers: Record<string, string> = {};
    for (const [k, v] of form.entries()) if (k.startsWith('q_')) answers[k.slice(2)] = String(v);
    done(path, await submitQuizAttempt({ quizId: String(form.get('quiz')), answers }),
      (d) => d.passed ? `Passed with ${d.score_percent}%` : `Scored ${d.score_percent}%. Try again.`);
  }
  async function addText(form: FormData) {
    'use server';
    done(path, await upsertLessonBlock({ orgSlug, lessonId, blockType: 'text', content: { html: String(form.get('text')) } }), 'Content added');
  }

  return (
    <>
      <p><Link href={`/w/${orgSlug}/programs/${lesson.program_id}`}>← Back to program</Link></p>
      <PageHead sub={ctx.name} title={lesson.title}>
        <form action={complete}><button className="btn primary" type="submit">Mark complete</button></form>
      </PageHead>
      <Flash msg={sp.msg} err={sp.err} />
      {locked && !blocks.length && <div className="card muted">This lesson is locked or has no content yet.</div>}

      <div className="card">
        {blocks.map((b) => {
          const c = b.content as Record<string, string>;
          return (
            <div key={b.id} className="block">
              {b.block_type === 'text' && <p style={{ whiteSpace: 'pre-wrap' }}>{(c.html ?? '').replace(/<[^>]+>/g, '')}</p>}
              {b.block_type === 'video' && (c.url
                ? <video src={c.url} controls style={{ width: '100%' }} />
                : <div className="muted">Video ({c.provider}{c.playback_id ? `: ${c.playback_id}` : ''})</div>)}
              {b.block_type === 'embed' && <div className="muted">Embedded content: <a href={c.embed_url} target="_blank" rel="noreferrer">{c.embed_url}</a></div>}
              {b.block_type === 'audio' && (c.url ? <audio src={c.url} controls /> : <div className="muted">Audio</div>)}
              {b.block_type === 'download' && <a className="btn small" href={c.url ?? '#'}>{c.label ?? 'Download'}</a>}
              {['document', 'image', 'callout'].includes(b.block_type) && <div className="muted">{b.block_type}: {c.label ?? c.alt ?? ''}</div>}
            </div>
          );
        })}
        {!!resources.length && <><h3>Resources</h3>{resources.map((r) => <div key={r.id}><a href={r.url ?? '#'}>{r.title}</a></div>)}</>}
        {can(ctx, 'programs.update') && (
          <form action={addText} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label className="f">Add text content<textarea name="text" required /></label>
            <div><button className="btn small">Add</button></div>
          </form>
        )}
      </div>

      {assignments.map((a) => {
        const sub = mySubs.filter((s) => s.assignment_id === a.id).at(-1);
        return (
          <form key={a.id} className="card" action={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Assignment: {a.title}</h2>{sub && <Pill value={sub.status} />}</div>
            <p>{a.instructions}</p>
            <input type="hidden" name="assignment" value={a.id} />
            <label className="f">Your answer<textarea name="body" /></label>
            <label className="f">Link (optional)<input name="link" type="url" /></label>
            <div><button className="btn" type="submit">{sub ? 'Resubmit' : 'Submit'}</button></div>
          </form>
        );
      })}

      {quizData.map((q) => q.ok && (
        <form key={q.data.quiz.id} className="card" action={quiz} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>Quiz: {q.data.quiz.title} <span className="muted">(pass {q.data.quiz.pass_percent}%)</span></h2>
          <input type="hidden" name="quiz" value={q.data.quiz.id} />
          {q.data.questions.map((qq) => (
            <fieldset key={qq.id} style={{ border: 0, padding: 0 }}>
              <legend><b>{qq.prompt}</b></legend>
              {qq.question_type === 'short_answer'
                ? <input name={`q_${qq.id}`} aria-label={qq.prompt} />
                : (qq.options as Option[]).map((o) => (
                  <label key={o.id} className="row"><input type="radio" name={`q_${qq.id}`} value={o.id} required /> {o.label}</label>
                ))}
            </fieldset>
          ))}
          {!!q.data.attempts.length && <div className="muted">Last attempt: {q.data.attempts.at(-1)?.score_percent}% {q.data.attempts.at(-1)?.passed ? '(passed)' : ''}</div>}
          <div><button className="btn" type="submit">Submit quiz</button></div>
        </form>
      ))}
    </>
  );
}
