import { bizNoDashed, checkCounterpartySave, counterpartySaveCmd, type CmdAckBody, type CmdRejectReason, type CmdRunBody, type CopyCounterparty, type PhoneCopyBody, type PhoneCounterpartySave, type PhoneIssueRequest } from '@sax/remote';

/**
 * 폰에서 넣거나 고친 거래처 하나(tex ADR-066). PC 장부가 원본이라 폰은 이 명령을 PC에 보내고,
 * PC가 답(saved)하고 새 사본(phone.copy)에 실을 때까지 폰 목록에 겹쳐 보인다.
 */
export interface BookCmd {
  cmdId: string;
  save: PhoneCounterpartySave;
  createdAt: number;
  sentAt?: number;
  /** PC가 꺼져 있어 릴레이 큐에 맡긴 때. */
  queuedAt?: number;
  /** PC가 저장하고 돌려준 거래처 ID와 그때. */
  ref?: string;
  savedAt?: number;
  failed?: CmdRejectReason | 'pc_old';
  /** 이미 보낸 넣기 명령을 고친 것. 그 명령에 PC가 ID를 돌려주면 그 ID로 보낸다. */
  after?: string;
}

/** 거래처 화면이 보는 한 곳: PC 사본에 폰에서 넣고 고친 것을 겹친 값. */
export interface Customer {
  /** 화면 안 ID. PC 거래처는 PC ID, 아직 PC가 받지 않은 것은 `new-<cmdId>`. */
  id: string;
  /** PC 거래처 ID. PC가 아직 받지 않았으면 null이고, 발급은 등록번호로 보낸다. */
  ref: string | null;
  name: string;
  bizNo: string;
  rep?: string;
  emailHint?: string;
  item?: string;
  state?: CopyCounterparty['state'];
  stateOn?: string;
  last?: CopyCounterparty['last'];
  /** 폰이 넣고 PC가 아직 사본에 싣지 않았다. */
  pending: boolean;
}

export const BOOK_KEEP = 50;

/** PC 사본의 받는 이메일과 같은 모양(앞 두 글자 + ***@도메인). */
export function maskEmail(v: string): string | undefined {
  const at = v.lastIndexOf('@');
  if (at < 1 || at === v.length - 1) return undefined;
  return `${v.slice(0, Math.min(2, at))}***@${v.slice(at + 1)}`;
}
const FAILED_KEEP_MS = 7 * 86_400_000;

const digits = (v: string) => v.replace(/\D/g, '');
const sameBiz = (a: string, b: string) => digits(a).length === 10 && digits(a) === digits(b);

export const newId = (cmdId: string) => `new-${cmdId}`;

export function customerOf(c: CopyCounterparty): Customer {
  const out: Customer = { id: c.ref, ref: c.ref, name: c.name, bizNo: c.bizNo ?? '', pending: false };
  if (c.rep) out.rep = c.rep;
  if (c.emailHint) out.emailHint = c.emailHint;
  if (c.item) out.item = c.item;
  if (c.state) {
    out.state = c.state;
    if (c.stateOn) out.stateOn = c.stateOn;
  }
  if (c.last) out.last = c.last;
  return out;
}

/** 폰이 고친 칸을 겹친다. 보내지 않은 칸(undefined)은 그대로, 빈 글은 지운다. */
function overlay(c: Customer, s: PhoneCounterpartySave): Customer {
  const out: Customer = { ...c, name: s.name.trim() };
  if (s.rep !== undefined) out.rep = s.rep.trim() || undefined;
  if (s.item !== undefined) out.item = s.item.trim() || undefined;
  if (s.email !== undefined) out.emailHint = s.email.trim() ? maskEmail(s.email.trim()) : undefined;
  return out;
}

/** 사본의 그 거래처가 이 명령이 보낸 칸의 값을 담고 있는가. */
function shows(c: CopyCounterparty, s: PhoneCounterpartySave): boolean {
  if (c.name !== s.name.trim()) return false;
  if (s.rep !== undefined && (c.rep ?? '') !== s.rep.trim()) return false;
  if (s.item !== undefined && (c.item ?? '') !== s.item.trim()) return false;
  if (s.email !== undefined && (c.emailHint ?? '') !== (s.email.trim() ? maskEmail(s.email.trim()) : '')) return false;
  return true;
}

/**
 * 사본이 이 명령을 이미 담았는가. PC가 저장한 명령은 사본에 그 거래처가 실제로 있어야 한다(사본은 거래처를 100곳까지만 담아
 * 새 거래처가 빠질 수 있다). 있으면 값이 같거나, 저장한 뒤에 만든 사본일 때 PC 값이 맞다. savedAt은 폰 시계, asOf는 PC 시계라
 * 시각만으로는 PC 시계가 늦을 때 폰의 옛 값이 남으므로 값으로도 본다.
 * 큐로 맡긴 넣기는 답이 폰에 오지 않으니, 사본에 같은 등록번호가 보이면 PC가 받은 것이다.
 */
function inCopy(b: BookCmd, copy: PhoneCopyBody | null): boolean {
  if (!copy) return false;
  if (b.savedAt) {
    const ref = b.ref ?? b.save.ref;
    const c = ref ? copy.counterparties.find((x) => x.ref === ref) : undefined;
    return !!c && (shows(c, b.save) || copy.asOf >= b.savedAt);
  }
  return !b.save.ref && !b.after && !!b.queuedAt && copy.counterparties.some((c) => !!c.bizNo && sameBiz(c.bizNo, b.save.bizNo));
}

export function customersOf(copy: PhoneCopyBody | null | undefined, book: readonly BookCmd[] = []): Customer[] {
  const list = (copy?.counterparties ?? []).map(customerOf);
  for (const b of [...book].sort((x, y) => x.createdAt - y.createdAt)) {
    if (b.failed || inCopy(b, copy ?? null)) continue;
    if (b.save.ref) {
      const i = list.findIndex((c) => c.ref === b.save.ref);
      if (i >= 0) list[i] = overlay(list[i]!, b.save);
      continue;
    }
    const i = list.findIndex((c) => sameBiz(c.bizNo, b.save.bizNo));
    if (i >= 0) {
      if (list[i]!.pending) list[i] = overlay(list[i]!, b.save);
      continue;
    }
    list.push(overlay({ id: b.ref ?? newId(b.cmdId), ref: b.ref ?? null, name: b.save.name, bizNo: bizNoDashed(b.save.bizNo), pending: !b.savedAt }, b.save));
  }
  return list;
}

/** 최근 발급 순, 같으면 이름 순(PC 사본 순서와 같은 기준). */
export function byRecent(list: readonly Customer[]): Customer[] {
  const day = (c: Customer) => c.last?.day ?? '';
  return [...list].sort((a, b) => (day(a) !== day(b) ? (day(a) < day(b) ? 1 : -1) : a.name.localeCompare(b.name, 'ko')));
}

export const byName = (list: readonly Customer[]): Customer[] => [...list].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

export function searchCustomers(list: readonly Customer[], q: string): Customer[] {
  const t = q.trim().toLowerCase();
  if (!t) return [];
  const d = digits(t);
  return byName(list.filter((c) => c.name.toLowerCase().includes(t) || !!c.rep?.toLowerCase().includes(t) || (d.length >= 3 && digits(c.bizNo).includes(d))));
}

export const findCustomer = (list: readonly Customer[], bizNo: string): Customer | null => list.find((c) => sameBiz(c.bizNo, bizNo)) ?? null;

/** 새로 넣기. 등록번호는 000-00-00000 꼴로 맞춘다. 맞지 않으면 null. */
export function addCmd(cmdId: string, f: { bizNo: string; name: string; rep?: string; email?: string; item?: string }, now = Date.now()): BookCmd | null {
  const save: PhoneCounterpartySave = { bizNo: bizNoDashed(f.bizNo), name: f.name.trim() };
  for (const k of ['rep', 'email', 'item'] as const) if (f[k]?.trim()) save[k] = f[k]!.trim();
  return checkCounterpartySave(save) ? null : { cmdId, save, createdAt: now };
}

/**
 * 고치기. PC가 이미 받은 거래처는 ref로 고치고, 아직 받지 않은 거래처는 기다리는 넣기 명령을 고쳐 다시 보낸다.
 * 바뀐 칸만 싣는다. 메일 칸을 비워 두면 지금 주소를 그대로 둔다(폰은 가린 주소만 안다).
 */
export function editCmd(book: readonly BookCmd[], c: Customer, f: { name: string; rep: string; email: string; item: string }, cmdId: string, now = Date.now()): BookCmd[] | null {
  const save: PhoneCounterpartySave = { bizNo: bizNoDashed(c.bizNo), name: f.name.trim() };
  if (f.rep.trim() !== (c.rep ?? '')) save.rep = f.rep.trim();
  if (f.item.trim() !== (c.item ?? '')) save.item = f.item.trim();
  if (f.email.trim()) save.email = f.email.trim();
  if (c.ref) {
    const s = { ...save, ref: c.ref };
    return checkCounterpartySave(s) ? null : [...book, { cmdId, save: s, createdAt: now }];
  }
  const i = book.findIndex((b) => !b.save.ref && !b.after && !b.failed && sameBiz(b.save.bizNo, c.bizNo));
  if (i < 0) return null;
  const sent = book[i]!;
  if (sent.sentAt || sent.queuedAt) {
    // PC가 이미 받았을 수 있다. 같은 등록번호로 다시 넣으면 PC는 있는 거래처를 그대로 두므로, ID를 받은 뒤 고친다.
    return checkCounterpartySave(save) ? null : [...book, { cmdId, save, createdAt: now, after: sent.cmdId }];
  }
  const merged: PhoneCounterpartySave = { ...book[i]!.save, ...save };
  for (const k of ['rep', 'email', 'item'] as const) if (merged[k] === '') delete merged[k];
  if (checkCounterpartySave(merged)) return null;
  const next = [...book];
  next[i] = { cmdId, save: merged, createdAt: book[i]!.createdAt };
  return next;
}

export const bookOpen = (b: BookCmd) => !b.ref && !b.failed;
/** 지금 보낼 수 있는 명령: 기다리는 넣기가 없는 것. */
export const bookReady = (b: BookCmd) => bookOpen(b) && !b.after;

/**
 * 넣기 뒤에 고친 명령을 그 거래처 ID에 잇는다. ID는 넣기 답에서, 큐로 맡겨 답이 없으면 사본의 같은 등록번호에서 찾는다.
 * 넣기가 실패했으면 고치기도 같은 이유로 실패한다.
 */
export function linkBook(book: readonly BookCmd[], copy: PhoneCopyBody | null | undefined): BookCmd[] {
  return book.map((b) => {
    if (!b.after) return b;
    const add = book.find((x) => x.cmdId === b.after);
    if (add?.failed) return { ...b, after: undefined, failed: add.failed };
    const ref = add?.ref ?? copy?.counterparties.find((c) => !!c.bizNo && sameBiz(c.bizNo, b.save.bizNo))?.ref;
    if (!ref) return add ? b : { ...b, after: undefined, failed: 'input_invalid' };
    const { after: _, ...rest } = b;
    return { ...rest, save: { ...b.save, ref } };
  });
}

/** 실시간 연결에서 보낼 명령. */
export const bookRun = (b: BookCmd): CmdRunBody => counterpartySaveCmd(b.cmdId, b.save);

/** PC가 꺼져 있을 때 큐에 맡길 명령: 아직 답이 없고 큐에도 없는 것(큐가 24시간 뒤 지우면 다시 넣는다). */
export function bookToQueue(book: readonly BookCmd[], ttlMs: number, now = Date.now()): BookCmd[] {
  return book.filter((b) => bookReady(b) && !b.sentAt && (!b.queuedAt || now - b.queuedAt >= ttlMs));
}

export function applyBookAck(b: BookCmd, a: CmdAckBody, now = Date.now()): BookCmd {
  if (a.cmdId !== b.cmdId || !bookOpen(b)) return b;
  if (a.state === 'saved' && a.ref) return { ...b, ref: a.ref, savedAt: now };
  if (a.state === 'rejected') return { ...b, failed: a.reason ?? 'input_invalid' };
  return b;
}

/** 사본에 담긴 것과 오래된 실패를 덜어 낸다. */
export function trimBook(book: readonly BookCmd[], copy: PhoneCopyBody | null | undefined, now = Date.now()): BookCmd[] {
  return linkBook(book, copy).filter((b) => !inCopy(b, copy ?? null) && !(b.failed && now - b.createdAt > FAILED_KEEP_MS)).slice(-BOOK_KEEP);
}

/** 발급 요청의 거래처: PC가 아는 거래처는 ID로, 아직 모르는 거래처는 등록번호와 상호로(PC가 먼저 장부에 넣는다). */
export function issueTarget(c: Pick<Customer, 'ref' | 'name' | 'bizNo'>, copy: PhoneCopyBody | null | undefined): Pick<PhoneIssueRequest, 'counterpartyRef' | 'newCounterparty'> | null {
  if (c.ref && copy?.counterparties.some((x) => x.ref === c.ref)) return { counterpartyRef: c.ref };
  const save = { bizNo: bizNoDashed(c.bizNo), name: c.name.trim() };
  return checkCounterpartySave(save) ? null : { newCounterparty: save };
}
