/**
 * Shown the instant an operator page is opened, while its data loads (see the workspace loading state).
 */
export default function AdminLoading() {
  return (
    <div className="skeleton" role="status" aria-live="polite" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="grid g2"><div className="card sk-card" /><div className="card sk-card" /></div>
      <div className="card sk-card tall" />
    </div>
  );
}
