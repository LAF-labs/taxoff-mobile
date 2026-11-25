import { amendCardOriginal, amendCardPlan, type AmendCard } from '@sax/chat-core';
import { ulid } from '@sax/remote';
import { chatCopyOf } from './net/pcCopy';
import { entrustNote } from './net/pcWhy';
import { offlineChat } from './offline/device';
import { issueRequest, type IssueTarget, type PhoneCmd } from './phoneCmd';
import { useQueue } from './queueStore';
import { useSession } from './session';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

interface EntrustInput {
  cp: { name: string };
  target: IssueTarget;
  supply: number;
  total: number;
  item: string;
  draftId?: string;
}

export function useEntrust(): (x: EntrustInput) => Promise<boolean> {
  const s = useSession();
  const queue = useQueue();
  return async ({ cp, target, supply, total, item, draftId }) => {
    const cmd: PhoneCmd = { cmdId: ulid(), req: issueRequest({ target, supply, item }), cpName: cp.name, total, createdAt: Date.now() };
    try {
      await s.update((d) => ({ ...d, cmds: [...(d.cmds ?? []), cmd] }));
    } catch {
      await s.update((d) => ({ ...d, cmds: (d.cmds ?? []).filter((c) => c.cmdId !== cmd.cmdId) })).catch(() => undefined);
      return false;
    }
    if (draftId && s.data.pair) void offlineChat(s.data.pair, s.keys, () => chatCopyOf(s.data.pcCopy))?.entrust(draftId).catch(() => undefined);
    queue.noteCmd(`cmd-${cmd.cmdId}`, entrustNote(s.pc, `${cp.name} 세금계산서 ${won(total)}`));
    void s.sync();
    return true;
  };
}

/**
 * 수정세금계산서(ADR-058 결정 8): 카드에서 고른 사유와 고친 뒤 값을 PC에 맡긴다. PC는 원래 계산서를 승인번호로 찾아
 * 같은 카드를 다시 계산하고, 승인은 발급과 같이 폰이나 PC 승인 바에서 받는다.
 */
export function useEntrustAmend(): (card: AmendCard) => Promise<boolean> {
  const s = useSession();
  const queue = useQueue();
  return async (card) => {
    const o = amendCardOriginal(card);
    const plan = amendCardPlan(card);
    if (!o || !card.what || !card.values || !plan || !card.view.ready) return false;
    const total = plan.sheets.reduce((n, x) => n + x.total, 0);
    const cmd: PhoneCmd = {
      cmdId: ulid(),
      req: issueRequest({ ref: o.counterpartyId, supply: Math.abs(plan.main.supply), item: card.values.item || o.item }),
      amend: { original: o.approvalNo, what: card.what, values: { ...card.values } },
      title: card.view.title,
      cpName: o.counterpartName,
      total,
      createdAt: Date.now(),
    };
    try {
      await s.update((d) => ({ ...d, cmds: [...(d.cmds ?? []), cmd] }));
    } catch {
      await s.update((d) => ({ ...d, cmds: (d.cmds ?? []).filter((c) => c.cmdId !== cmd.cmdId) })).catch(() => undefined);
      return false;
    }
    queue.noteCmd(`cmd-${cmd.cmdId}`, entrustNote(s.pc, `${o.counterpartName} 수정세금계산서`));
    void s.sync();
    return true;
  };
}
