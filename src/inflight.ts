
let running = 0;
let waiters: (() => void)[] = [];

export async function inflight<T>(f: () => Promise<T>): Promise<T> {
  running++;
  try {
    return await f();
  } finally {
    if (--running === 0) for (const w of waiters.splice(0)) w();
  }
}

export function drained(maxMs: number): Promise<void> {
  if (running === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(t);
      waiters = waiters.filter((w) => w !== done);
      resolve();
    };
    const t = setTimeout(done, maxMs);
    waiters.push(done);
  });
}

let epoch = 0;
export const currentEpoch = (): number => epoch;
export function endEpoch(): void {
  epoch++;
}
export function sameEpoch(e: number): void {
  if (e !== epoch) throw new Error('locked');
}

export function liveKey(k: Uint8Array): Uint8Array {
  let acc = 0;
  for (const b of k) acc |= b;
  if (acc === 0) throw new Error('locked');
  return k;
}
