// 세션이 붙은 직후의 봉투를 버리지 않기. PC는 세션이 열리자마자 사본(phone.copy)과 함께 열린 승인 요청(gate.request)과
// 진행(run.event)을 보낸다. 폰은 먼저 사본을 기다리고 보관함을 비우는데, 그 둘은 자기 봉투가 아닌 것을 건너뛴다.
// 그 사이 온 발급 명령 봉투를 모아 두었다가 발급 명령 처리(issueLive.driveCmds)가 먼저 읽게 한다.
interface Recv<E> {
  recv(timeoutMs: number): Promise<E | null>;
}

/** 발급 명령 처리가 읽는 봉투 */
const CMD_TYPES: ReadonlySet<string> = new Set(['cmd.ack', 'run.event', 'gate.request']);

/** recv로 지나간 봉투 가운데 keep에 드는 것을 held에 모은다(지나가는 것은 그대로 돌려준다) */
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

/** 모아 둔 봉투를 먼저 돌려주고, 다 쓰면 원래 채널에서 읽는다 */
export function replaying<C extends Recv<E>, E>(ch: C, held: E[]): C {
  return new Proxy(ch, {
    get(t, p) {
      if (p === 'recv') return async (ms: number) => (held.length ? held.shift()! : t.recv(ms));
      const v = Reflect.get(t, p, t) as unknown;
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
}
