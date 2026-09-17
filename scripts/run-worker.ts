// Local helper: drain domain events once (automations + delayed steps) and run the scheduled checks.
// Usage: npx tsx --conditions react-server scripts/run-worker.ts [limit]   (env as in .env.example)
import { emitScheduledEvents, processDomainEvents } from '../src/modules/automations/worker';

async function main() {
  const limit = Number(process.argv[2] ?? 500);
  console.log('scheduled', await emitScheduledEvents());
  console.log('events', await processDomainEvents(limit));
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
