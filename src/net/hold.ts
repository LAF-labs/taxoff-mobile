interface Recv<E> {
  recv(timeoutMs: number): Promise<E | null>;
}

const CMD_TYPES: ReadonlySet<string> = new Set(['cmd.ack', 'run.event', 'human.request', 'gate.request', 'gate.resolved']);

export function tapping<C extends Recv<E>, E extends { type: string }>(ch: C, held: E[], keep: ReadonlySet<string> = CMD_TYPES): C {
  return new Proxy(ch, {
    get(t, p) {
      if (p === 'recv') {
        return async (ms: number) => {
          const e = await t.recv(ms);
          if (e && keep.has(e.type)) held.push(e);
          return e;
        };
      }
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}

export function replaying<C extends Recv<E>, E>(ch: C, held: E[]): C {
  return new Proxy(ch, {
    get(t, p) {
      if (p === 'recv') return async (ms: number) => (held.length ? held.shift()! : t.recv(ms));
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}
