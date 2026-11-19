// 승인 대기 카드로 가기(알림 누름, 새 승인 요청): 첫 화면 대화가 그 카드까지 스크롤한다. 받는 쪽이 없으면 기억했다가 붙을 때 준다.
let wanted: string | null = null;
const subs = new Set<(jobId: string) => void>();

export function showCard(jobId: string): void {
  wanted = jobId;
  for (const f of subs) f(jobId);
}

/** 첫 화면이 붙을 때 기다리던 카드가 있으면 바로 받는다 */
export function onShowCard(f: (jobId: string) => void): () => void {
  subs.add(f);
  if (wanted) f(wanted);
  return () => subs.delete(f);
}

/** 그 카드를 보였다(다시 열 때 또 스크롤하지 않게) */
export function shownCard(jobId: string): void {
  if (wanted === jobId) wanted = null;
}
