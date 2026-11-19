// 홈 대화에서 쓰는 폰 대화 훅. PC가 켜져 있든 꺼져 있든 폰 대화는 이 폰이 게이트웨이로 직접 부른다(ADR-047 결정 6: 대화는 기기마다 따로).
// 대화 줄은 코어 기록(봉인 파일)에서 읽고, 카드·표는 답이 온 턴의 결과로 더한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem } from '../chat';
import { useSession } from '../session';
import type { OfflineReply } from './chat';
import { offlineChat, setPcOnline } from './device';
import { chatCopyOf } from '../net/pcCopy';

export interface OfflineChatView {
  /** 페어링 전이거나 게이트웨이를 정할 수 없으면 거짓 */
  available: boolean;
  items: ChatItem[];
  busy: boolean;
  chips: OfflineReply['chips'];
  /** 아직 맡기지 않은 카드 id(이 카드에만 [발급 맡기기]가 붙는다). 없으면 모든 카드를 연 것으로 본다(갤러리). */
  openDrafts?: ReadonlySet<string>;
  send(text: string): Promise<void>;
  /** 못 보낸 말을 다시 보낸다(그 말과 이유 줄은 지우고 새로 보낸다) */
  retry(noteId: string): Promise<void>;
}

/** 연결이 끊기는 등 코어가 답을 주지 못하고 던졌을 때 보이는 한 줄 */
export const SEND_FAILED_TEXT = '연결이 잠깐 끊겨서 보내지 못했어요. 다시 보내 주세요.';

export function useOfflineChat(): OfflineChatView {
  const s = useSession();
  const pair = s.data.pair;
  // 폰 사본(거래처·최근 발급): PC가 라이브 세션마다 넘긴 마지막 phone.copy. 대화를 다시 만들지 않고 물을 때마다 최신 값을 읽는다.
  const copyRef = useRef(s.data.pcCopy);
  copyRef.current = s.data.pcCopy;
  const pcRef = useRef(s.pc);
  pcRef.current = s.pc;
  useEffect(() => setPcOnline(() => pcRef.current === 'online'), []);
  const chat = useMemo(() => (pair ? offlineChat(pair, s.keys, () => chatCopyOf(copyRef.current)) : null), [pair, s.keys]);
  const [log, setLog] = useState<ChatItem[]>([]);
  const [openDrafts, setOpenDrafts] = useState<ReadonlySet<string>>(new Set());
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
    const read = () => {
      void chat.items().then((x) => live && setLog(x), () => undefined);
      void chat.core.drafts().then((ds) => live && setOpenDrafts(new Set(ds.filter((d) => d.state === 'open').map((d) => d.id))), () => undefined);
    };
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
      setPending({ kind: 'msg', id: 'off-pending', from: 'me', at: Date.now(), text, state: 'sending' });
      // 모델을 부르지 못한 턴은 코어가 기록하지 않는다: 내가 쓴 말은 화면에 남기고 이유 한 줄과 [다시 보내기]를 붙인다
      const fail = (why: string, retry: boolean): ChatItem[] => {
        const at = Date.now();
        return [
          { kind: 'msg', id: `off-me-${at}`, from: 'me', at, text, state: 'failed' },
          { kind: 'note', id: `off-${at}`, at: at + 1, text: why, failed: retry ? { retry: text } : {} },
        ];
      };
      try {
        const r = await chat.send(text);
        setExtra((x) => [...x, ...r.items, ...(r.unavailable ? fail(r.unavailable.text, r.unavailable.retry) : [])]);
        setChips(r.chips);
        if (r.drafts.length) setOpenDrafts((o) => new Set([...o, ...r.drafts.filter((d) => d.state === 'open').map((d) => d.id)]));
      } catch {
        setExtra((x) => [...x, ...fail(SEND_FAILED_TEXT, true)]);
      } finally {
        setPending(null);
        sending.current = false;
        setBusy(false);
      }
    },
    [chat],
  );

  const retry = useCallback(
    async (noteId: string) => {
      const i = extra.findIndex((x) => x.id === noteId);
      const n = extra[i];
      if (!n || n.kind !== 'note' || !n.failed?.retry || sending.current) return;
      const text = n.failed.retry;
      // 이유 줄과 바로 앞의 못 보낸 내 말을 지운다
      setExtra((x) => x.filter((y, j) => y.id !== noteId && !(j === i - 1 && y.kind === 'msg' && y.state === 'failed')));
      await send(text);
    },
    [extra, send],
  );

  return { available: !!chat, items: [...log, ...extra, ...(pending ? [pending] : [])], busy, chips, openDrafts, send, retry };
}
