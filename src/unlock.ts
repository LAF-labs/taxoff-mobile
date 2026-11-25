import { CAP, b64, fromB64, unlockGrantAad, validPxPub, UNLOCK_E_LEN, UNLOCK_GRANT_CT_LEN, UNLOCK_N_LEN, type PxHw, type UnlockGrantBody, type UnlockScopeWire } from '../vendor/sax-remote/src/index.ts';

/**
 * PC 잠금 풀기(ADR-061 결정 3, 5)의 폰 쪽.
 * - 풀기 키 Ux: Secure Enclave P-256 키 합의 키. 승인 키 Px와 따로 둔다.
 * - PC가 보낸 풀기 요청(unlock.request)을 모아 두고, 사람이 Face ID로 답하면 PC에 보낼 답(unlock.grant)을 쌓는다.
 *   Z = ECDH(Ux, E)는 네이티브 안에서 바로 txPub로 봉인되고 JS에는 봉인문만 온다.
 */

export const UX_TAG = 'com.lafco.tex.ux.v1';
const UX_PROMPT = 'PC 잠금 풀기';
/** PC가 정한 유효 시간이 이보다 길어도 폰은 이만큼만 기다린다(스키마: 많아야 60초). */
export const UNLOCK_WAIT_MAX_MS = 60_000;

export interface UnlockAsk {
  unlockId: string;
  scope: UnlockScopeWire;
  pcName: string;
  pcDeviceId: string;
  phoneDeviceId: string;
  e: Uint8Array;
  txPub: Uint8Array;
  n: Uint8Array;
  /** 폰 시계로 이때까지 답할 수 있다. */
  until: number;
}

export type GrantResult = { ok: true; body: UnlockGrantBody } | { ok: false; why: 'cancel' | 'lockout' | 'changed' | 'failed' };

export interface UxNative {
  uxPublic(tag: string): Promise<string | null>;
  uxCreate(tag: string): Promise<string>;
  uxDelete(tag: string): Promise<void>;
  uxGrant(tag: string, eB64: string, txPubB64: string, aadB64: string, prompt: string): Promise<{ enc: string; ct: string } | null>;
}

export interface UxDevice {
  readonly hw: PxHw;
  /** 키가 없으면 만든다(생체를 묻지 않는다). 못 만들면 null. */
  ensure(): Promise<Uint8Array | null>;
  remove(): Promise<void>;
  grant(a: UnlockAsk): Promise<GrantResult>;
}

const pubOf = (s: string | null): Uint8Array | null => {
  if (!s) return null;
  try {
    const pub = fromB64(s);
    return validPxPub(pub) ? pub : null;
  } catch {
    return null;
  }
};

export function deviceUnlockKey(native: Partial<UxNative> | null | undefined, hw: PxHw = 'ios_se', tag = UX_TAG): UxDevice | null {
  if (!native?.uxPublic || !native.uxCreate || !native.uxDelete || !native.uxGrant) return null;
  const n = native as UxNative;
  return {
    hw,
    async ensure() {
      try {
        return pubOf((await n.uxPublic(tag)) ?? (await n.uxCreate(tag)));
      } catch {
        return null;
      }
    },
    async remove() {
      await n.uxDelete(tag).catch(() => undefined);
    },
    async grant(a) {
      const aad = unlockGrantAad(a.unlockId, a.n, a.pcDeviceId, a.phoneDeviceId, a.e);
      let r: { enc: string; ct: string } | null;
      try {
        r = await n.uxGrant(tag, b64(a.e), b64(a.txPub), b64(aad), UX_PROMPT);
      } catch (e) {
        const m = String((e as Error)?.message ?? e);
        if (/biometry_lockout/.test(m)) return { ok: false, why: 'lockout' };
        // 생체를 다시 등록해 키가 죽었다. 지우면 다음 연결 때 새 키를 알린다.
        if (/ux_missing|ux_failed/.test(m)) {
          await n.uxDelete(tag).catch(() => undefined);
          return { ok: false, why: 'changed' };
        }
        return { ok: false, why: 'failed' };
      }
      if (!r) return { ok: false, why: 'cancel' };
      try {
        if (fromB64(r.enc).length !== 32 || fromB64(r.ct).length !== UNLOCK_GRANT_CT_LEN) return { ok: false, why: 'failed' };
      } catch {
        return { ok: false, why: 'failed' };
      }
      return { ok: true, body: { unlockId: a.unlockId, decision: 'open', grantEnc: r.enc, grantCt: r.ct } };
    },
  };
}

const ID_RE = /^[A-Za-z0-9_-]{22}$/;

/** unlock.request 본문을 읽는다. 모양이 틀리거나 이미 지났으면 null. */
export function readAsk(body: unknown, ctx: { pcDeviceId: string; phoneDeviceId: string; pcName: string }, now: number): UnlockAsk | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b.unlockId !== 'string' || !ID_RE.test(b.unlockId)) return null;
  if (b.scope !== 'screen' && b.scope !== 'remote') return null;
  if (typeof b.exp !== 'number' || !Number.isFinite(b.exp)) return null;
  let e: Uint8Array, txPub: Uint8Array, n: Uint8Array;
  try {
    e = fromB64(String(b.unlockE));
    txPub = fromB64(String(b.txPub));
    n = fromB64(String(b.unlockN));
  } catch {
    return null;
  }
  if (e.length !== UNLOCK_E_LEN || e[0] !== 4 || txPub.length !== 32 || n.length !== UNLOCK_N_LEN) return null;
  const left = Math.min(b.exp - now, UNLOCK_WAIT_MAX_MS);
  if (left <= 0) return null;
  return { unlockId: b.unlockId, scope: b.scope, pcName: ctx.pcName, pcDeviceId: ctx.pcDeviceId, phoneDeviceId: ctx.phoneDeviceId, e, txPub, n, until: now + left };
}

/** 이 폰이 hello에 unlock.v1을 싣는가: 풀기 키를 쓸 수 있고 설정에서 끄지 않았다. */
export const unlockCaps = (ux: UxDevice | null | undefined, off: boolean | undefined): string[] => (ux && !off ? [CAP.unlock] : []);

/**
 * 풀기 요청과 답을 잇는 곳. 연결(세션)은 요청을 넣고 답을 꺼내 보내고, 화면은 요청을 보여 주고 답을 넣는다.
 * 세션이 닫힌 뒤에 넣은 답은 다음 세션에서 보낸다(요청이 아직 살아 있을 때만).
 */
export class UnlockDesk {
  private readonly asks = new Map<string, UnlockAsk>();
  private readonly hidden = new Set<string>();
  private readonly done = new Set<string>();
  private out: Array<{ body: UnlockGrantBody; until: number }> = [];
  private readonly subs = new Set<() => void>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private ver = 0;

  /** 바뀔 때마다 올라간다(화면이 다시 그릴 때를 안다). */
  get version(): number {
    return this.ver;
  }

  private emit(): void {
    this.ver += 1;
    for (const f of this.subs) f();
  }

  subscribe(f: () => void): () => void {
    this.subs.add(f);
    return () => this.subs.delete(f);
  }

  offer(a: UnlockAsk): void {
    if (this.done.has(a.unlockId) || this.asks.has(a.unlockId)) return;
    // 같은 PC가 새로 청하면 앞의 것은 버린다(PC도 마지막 것만 기다린다).
    for (const [id, x] of this.asks) if (x.pcDeviceId === a.pcDeviceId) this.asks.delete(id);
    this.asks.set(a.unlockId, a);
    this.emit();
  }

  /** 아직 답하지 않은 가장 새 요청. */
  current(): UnlockAsk | null {
    const t = this.now();
    let best: UnlockAsk | null = null;
    for (const a of this.asks.values()) if (a.until > t && (!best || a.until > best.until)) best = a;
    return best;
  }

  /** 사람이 바깥을 눌러 시트를 닫았다. 거절은 아니다(PC는 그대로 기다리다 시간이 지난다). */
  isHidden(id: string): boolean {
    return this.hidden.has(id);
  }

  hide(id: string, on = true): void {
    if (on) this.hidden.add(id);
    else this.hidden.delete(id);
    this.emit();
  }

  /** 답을 넣는다. 열기면 봉인문, 거절이면 deny. */
  answer(body: UnlockGrantBody): void {
    const a = this.asks.get(body.unlockId);
    if (!a) return;
    this.asks.delete(body.unlockId);
    this.done.add(body.unlockId);
    this.out.push({ body, until: a.until });
    this.emit();
  }

  /** 답하지 않고 내려놓는다(이 폰으로는 열 수 없게 됐다). */
  drop(id: string): void {
    if (!this.asks.delete(id)) return;
    this.done.add(id);
    this.emit();
  }

  /** 기다릴 것이 있는가: 답할 요청이나 보낼 답이 살아 있다. */
  waiting(): boolean {
    const t = this.now();
    return [...this.asks.values()].some((a) => a.until > t) || this.out.some((o) => o.until > t);
  }

  /** 보낼 답을 꺼낸다. 시간이 지난 답은 버린다. */
  take(): Array<{ body: UnlockGrantBody; until: number }> {
    const t = this.now();
    const live = this.out.filter((o) => o.until > t);
    this.out = [];
    return live;
  }

  /** 보내지 못한 답을 다시 넣는다(세션이 닫혀 있었다). */
  putBack(items: Array<{ body: UnlockGrantBody; until: number }>): void {
    this.out.push(...items);
  }
}

export const unlockDesk = new UnlockDesk();
