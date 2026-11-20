import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { SimpleAuthSheet } from './SimpleAuthSheet';

export function SimpleAuthHost() {
  const q = useQueue();
  const s = useSession();
  const job = q.simpleJob;
  const r = job?.run;
  if (!job || !r || r.kind !== 'myTurn' || r.auth.method !== 'pc' || !r.auth.canSimple) return null;
  return <SimpleAuthSheet key={job.id} remembered={s.data.simpleId} failed={r.auth.failed} onSend={(v) => q.simpleAuth(job.id, v)} onClose={q.closeSimple} />;
}
