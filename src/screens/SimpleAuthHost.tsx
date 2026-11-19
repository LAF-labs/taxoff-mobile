// 간편인증 시트를 지금 화면(채팅·진행) 맨 위에 띄운다. 진행 카드·진행 화면의 [간편인증으로 로그인]이 연다. 한 번에 하나.
import { useQueue } from '../queueStore';
import { useSession } from '../session';
import { SimpleAuthSheet } from './SimpleAuthSheet';

export function SimpleAuthHost() {
  const q = useQueue();
  const s = useSession();
  const job = q.simpleJob;
  const r = job?.run;
  // 차례가 끝났으면(PC가 다른 단계로 갔거나 요청 자리가 닫혔으면) 시트를 띄우지 않는다
  if (!job || !r || r.kind !== 'myTurn' || r.auth.method !== 'pc' || !r.auth.canSimple) return null;
  return <SimpleAuthSheet key={job.id} remembered={s.data.simpleId} failed={r.auth.failed} onSend={(v) => q.simpleAuth(job.id, v)} onClose={q.closeSimple} />;
}
