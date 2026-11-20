let wanted: string | null = null;
const subs = new Set<(jobId: string) => void>();

export function showCard(jobId: string): void {
  wanted = jobId;
  for (const f of subs) f(jobId);
}

export function onShowCard(f: (jobId: string) => void): () => void {
  subs.add(f);
  if (wanted) f(wanted);
  return () => subs.delete(f);
}

export function shownCard(jobId: string): void {
  if (wanted === jobId) wanted = null;
}
