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

