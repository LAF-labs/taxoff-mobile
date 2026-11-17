// PC가 라이브 세션을 열 때 보내는 폰 사본(remote-envelope v1.8 phone.copy, ADR-046 결정 5)을 받고 폰 쪽 모양으로 바꾼다.
// - 폰이 hello에 copy.v1을 알리고 PC도 copy.v1을 알렸을 때만 기다린다. PC는 세션을 열자마자 한 번 보낸다.
// - 받은 사본은 봉인 상태 파일(AppData.pcCopy)에 날짜와 함께 둔다. 더 오래된 사본으로 덮지 않는다.
// - 폰은 숫자를 다시 계산하지 않는다(PC가 거래내역을 가진다). 화면과 PC가 꺼졌을 때 대화에 그대로 쓴다.
// - 사본에 없는 것(이메일 원문, 계좌번호, 내 사업장)은 지어내지 않는다.
import { CAP, type Channel, type PhoneCopyBody } from '@sax/remote';
import type { PhoneCopy } from '@sax/chat-core';
import type { Counterparty } from '../issue.ts';
import { phoneCopyFrom } from '../offline/copy.ts';

/** 폰이 hello에 알리는 v1.8 기능: 사본(copy.v1)과 발급 명령·진행(issue.v1, src/net/issueLive.ts) */
export const PHONE_CAPS: readonly string[] = [CAP.copy, CAP.issue];

const COPY_WAIT_MS = 2000;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * 세션을 연 직후 phone.copy 하나를 기다린다. PC가 copy.v1을 알리지 않았거나 시간 안에 오지 않으면 null.
 * 이 창 안에 다른 봉투가 오면 버린다(이 폰은 아직 다른 PC 발신을 알리지 않았다).
 */
export async function receiveCopy(ch: Channel, peerCaps: readonly string[], ms = COPY_WAIT_MS): Promise<PhoneCopyBody | null> {
  if (!peerCaps.includes(CAP.copy)) return null;
  const deadline = Date.now() + ms;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0 || ch.closed) return null;
    const e = await ch.recv(left);
    if (!e) return null;
    if (e.type === 'phone.copy') return e.body as PhoneCopyBody;
  }
}

/** 새 사본이 더 새로울 때만 바꾼다(늦게 도착한 옛 사본이 덮지 않게) */
export function newerCopy(have: PhoneCopyBody | null | undefined, got: PhoneCopyBody): PhoneCopyBody {
  return have && have.asOf >= got.asOf ? have : got;
}

/** KST 날짜 → 그날 정오(ms). 폰 Counterparty.lastAt이 ms라 바꾼다. */
const noonOf = (day: string) => Date.parse(`${day}T12:00:00+09:00`);

/** 사본 거래처 → 발급 화면·대화가 쓰는 거래처(issue.ts). 이메일은 가린 힌트뿐이라 넣지 않는다. */
export function counterpartiesOf(body: PhoneCopyBody): Counterparty[] {
  return body.counterparties.map((c) => {
    const row: Counterparty = { id: c.ref, name: c.name, bizNo: c.bizNo ?? '', issued: c.last ? 1 : 0 };
    if (c.last && DAY.test(c.last.day)) {
      row.lastSupply = c.last.supply;
      row.lastItem = c.last.item;
      row.lastAt = noonOf(c.last.day);
    }
    return row;
  });
}

/** 사본 → PC가 꺼졌을 때 대화 코어의 사본. 받을 돈 목록은 사본에 없다(요약만 있다). */
export function chatCopyOf(body: PhoneCopyBody | null | undefined): PhoneCopy | null {
  if (!body) return null;
  const copy = phoneCopyFrom({ asOf: body.asOf, profile: null, counterparties: counterpartiesOf(body), receivables: null });
  return { ...copy, counterparties: copy.counterparties.map((c) => ({ ...c, bizNo: c.bizNo || null })) };
}
