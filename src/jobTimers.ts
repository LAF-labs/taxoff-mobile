type Handle = ReturnType<typeof setTimeout>;

interface JobTimers {
  at(id: string, ms: number, f: () => void): void;
  clear(id: string): void;
  clearAll(): void;
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
