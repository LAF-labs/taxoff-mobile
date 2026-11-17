// 홈 대화에서 쓰는 폰 대화 훅. PC가 꺼져 있을 때만 쓴다(켜져 있으면 PC 에이전트가 답한다).
// 대화 줄은 코어 기록(봉인 파일)에서 읽고, 카드·표는 답이 온 턴의 결과로 더한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem } from '../chat';
import { useSession } from '../session';
import type { OfflineReply } from './chat';
import { offlineChat } from './device';

export interface OfflineChatView {
  /** 페어링 전이거나 게이트웨이를 정할 수 없으면 거짓 */
  available: boolean;
  items: ChatItem[];
  busy: boolean;
  chips: OfflineReply['chips'];
  send(text: string): Promise<void>;
}

export function useOfflineChat(): OfflineChatView {
  const s = useSession();
  const pair = s.data.pair;
  // 폰 사본(거래처·최근 발급)은 PC가 넘기는 봉투가 생기면 여기서 phoneCopyFrom으로 넣는다. 지금은 없음(사본: none).
  const chat = useMemo(() => (pair ? offlineChat(pair, s.keys, () => null) : null), [pair, s.keys]);
  const [log, setLog] = useState<ChatItem[]>([]);
  const [extra, setExtra] = useState<ChatItem[]>([]);
  const [chips, setChips] = useState<OfflineReply['chips']>([]);
  const [busy, setBusy] = useState(false);
  /** 지금 보내는 중인지(화면이 다시 그려지기 전에 두 번 눌려도 한 번만 보낸다) */
  const sending = useRef(false);
  /** 답을 기다리는 동안 보이는 내 말(턴이 끝나면 코어 기록의 줄로 바뀐다) */
  const [pending, setPending] = useState<ChatItem | null>(null);

  useEffect(() => {
    if (!chat) return;
    let live = true;
    const read = () => void chat.items().then((x) => live && setLog(x), () => undefined);
    read();
    const off = chat.subscribe(read);
    return () => {
      live = false;
      off();
    };
  }, [chat]);

  const send = useCallback(
    async (text: string) => {
      if (!chat || sending.current) return;
      sending.current = true;
      setBusy(true);
      setChips([]);
      setPending({ kind: 'msg', id: 'off-pending', from: 'me', at: Date.now(), text, state: 'waiting' });
      try {
        const r = await chat.send(text);
        const at = Date.now();
        // 모델을 부르지 못한 턴은 코어가 기록하지 않는다: 내가 쓴 말은 화면에 남기고 이유를 한 줄 붙인다
        const failed: ChatItem[] = r.unavailable
          ? [
              { kind: 'msg', id: `off-me-${at}`, from: 'me', at, text, state: 'waiting' },
              { kind: 'note', id: `off-${at}`, at: at + 1, text: r.unavailable.text },
            ]
          : [];
        setExtra((x) => [...x, ...r.items, ...failed]);
        setChips(r.chips);
      } finally {
        setPending(null);
        sending.current = false;
        setBusy(false);
      }
    },
    [chat],
  );

  return { available: !!chat, items: [...log, ...extra, ...(pending ? [pending] : [])], busy, chips, send };
}
