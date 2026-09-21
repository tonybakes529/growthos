/**
 * Shown the instant a link inside a workspace is clicked, while the page's data loads. Without a loading
 * boundary the old page simply sat there until the server had finished every query. It also lets Next prefetch
 * this state for links on screen, so navigation starts before the server answers.
 */
export default function WorkspaceLoading() {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="grid g2"><div className="card sk-card" /><div className="card sk-card" /></div>
      <div className="card sk-card tall" />
    </div>
  );
}
