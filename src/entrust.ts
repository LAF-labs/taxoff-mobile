// 폰 발급 명령(cmd.run) 맡기기: 발급 작성 화면의 [발급 맡기기]와 대화 카드의 [발급하기]가 같이 쓴다.
// 보내기 전에 봉인 상태 파일(AppData.cmds)에 먼저 저장하고(다시 보낼 때 같은 cmdId), 저장하지 못하면 맡기지 않는다.
// 승인은 PC 승인 바(또는 폰 승인)에서 한다. 이 함수는 발급하지 않는다.
import { ulid } from '@sax/remote';
import { chatCopyOf } from './net/pcCopy';
import { offlineChat } from './offline/device';
import { issueRequest, type PhoneCmd } from './phoneCmd';
import { useQueue } from './queueStore';
import { useSession } from './session';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

interface EntrustInput {
  cp: { id: string; name: string };
  supply: number;
  total: number;
  item: string;
  /** 대화 카드에서 왔으면 그 카드 id(폰 대화가 같은 카드를 다시 고치지 않게 맡김으로 바꾼다) */
  draftId?: string;
}

/** 맡겼으면 true, 폰에 저장하지 못해 맡기지 않았으면 false */
export function useEntrust(): (x: EntrustInput) => Promise<boolean> {
  const s = useSession();
  const queue = useQueue();
  return async ({ cp, supply, total, item, draftId }) => {
    const cmd: PhoneCmd = { cmdId: ulid(), req: issueRequest({ ref: cp.id, supply, item }), cpName: cp.name, total, createdAt: Date.now() };
    try {
      await s.update((d) => ({ ...d, cmds: [...(d.cmds ?? []), cmd] }));
    } catch {
      // 메모리에 먼저 들어간 명령을 빼서, 다음 저장이 맡기지 않은 명령을 적지 않게 한다
      await s.update((d) => ({ ...d, cmds: (d.cmds ?? []).filter((c) => c.cmdId !== cmd.cmdId) })).catch(() => undefined);
      return false;
    }
    if (draftId && s.data.pair) void offlineChat(s.data.pair, s.keys, () => chatCopyOf(s.data.pcCopy))?.entrust(draftId).catch(() => undefined);
    queue.noteCmd(`cmd-${cmd.cmdId}`, s.pc === 'online' ? null : `${cp.name} 세금계산서 ${won(total)}을 맡겼어요. PC 켜지면 보내요`);
    void s.sync();
    return true;
  };
}
