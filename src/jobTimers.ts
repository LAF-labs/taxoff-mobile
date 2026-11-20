// 일(job)별 타이머 묶음. 시연 저장소가 단계를 넘길 때 쓴다: 같은 일의 흐름을 다시 시작하면 앞 흐름의 남은 타이머를 지워
// 두 흐름이 겹치지 않게 한다. 일이 끝나거나 지워질 때, 저장소가 사라질 때도 지운다.
type Handle = ReturnType<typeof setTimeout>;

interface JobTimers {
  /** id의 흐름에 타이머 하나를 더한다. */
  at(id: string, ms: number, f: () => void): void;
  /** id의 남은 타이머를 모두 지운다. */
  clear(id: string): void;
  clearAll(): void;
  /** 남은 타이머 수(시험용) */
  pending(id: string): number;
}

export function jobTimers(set: (f: () => void, ms: number) => Handle = setTimeout, clear: (h: Handle) => void = clearTimeout): JobTimers {
  const byJob = new Map<string, Set<Handle>>();
  return {
    at(id, ms, f) {
      const hs = byJob.get(id) ?? new Set<Handle>();
      byJob.set(id, hs);
      const h = set(() => {
        hs.delete(h);
        f();
      }, ms);
      hs.add(h);
    },
    clear(id) {
      for (const h of byJob.get(id) ?? []) clear(h);
      byJob.delete(id);
    },
    clearAll() {
      for (const id of [...byJob.keys()]) this.clear(id);
    },
    pending(id) {
      return byJob.get(id)?.size ?? 0;
    },
  };
}
