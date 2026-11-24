import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatItem } from '../chat';
import { useSession } from '../session';
import type { OfflineReply } from './chat';
import type { PhoneScreen } from '@sax/chat-core';
import { offlineChat, setPcOnline } from './device';
import { chatCopyOf } from '../net/pcCopy';

export interface ReplyTo {
  id: string;
  text: string;
  mine: boolean;
}

export interface OfflineChatView {
  available: boolean;
  items: ChatItem[];
  busy: boolean;
  chips: OfflineReply['chips'];
  openDrafts?: ReadonlySet<string>;
  screens?: PhoneScreen[];
  send(text: string, reply?: ReplyTo | null): Promise<void>;
  react?(id: string, emoji: string | null): Promise<void>;
  retry(noteId: string): Promise<void>;
  /** 보인 항목을 바꾸거나 더해 남긴다(수정 카드에서 고친 값, 맡긴 표시, 기록 화면에서 연 수정 카드). */
  update?(item: ChatItem): Promise<void>;
}

const SEND_FAILED_TEXT = '연결이 잠깐 끊겨서 보내지 못했어요. 다시 보내 주세요.';

export function useOfflineChat(): OfflineChatView {
  const s = useSession();
  const pair = s.data.pair;
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
  const [screens, setScreens] = useState<PhoneScreen[]>([]);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [pending, setPending] = useState<ChatItem | null>(null);

  useEffect(() => {
    if (!chat) return;
    chat.reactionSink = (reaction) => setPending((p) => (p && p.kind === 'msg' ? { ...p, reaction } : p));
    return () => void (chat.reactionSink = null);
  }, [chat]);

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
    async (text: string, reply: ReplyTo | null = null) => {
      if (!chat || sending.current) return;
      const replyTo = reply ? { replyTo: { text: reply.text, mine: reply.mine } } : {};
      sending.current = true;
      setBusy(true);
      setChips([]);
      setScreens([]);
      setPending({ kind: 'msg', id: 'off-pending', from: 'me', at: Date.now(), text, state: 'sending', ...replyTo });
      const fail = (why: string, retry: boolean): ChatItem[] => {
        const at = Date.now();
        return [
          { kind: 'msg', id: `off-me-${at}`, from: 'me', at, text, state: 'failed', ...replyTo },
          { kind: 'note', id: `off-${at}`, at: at + 1, text: why, failed: retry ? { retry: text } : {} },
        ];
      };
      try {
        const r = await chat.send(text, reply?.id ?? null);
        const failed = r.unavailable ? fail(r.unavailable.text, r.unavailable.retry) : [];
        if (failed.length) void chat.keep(failed);
        setExtra((x) => [...x, ...r.items, ...failed]);
        setChips(r.chips);
        setScreens(r.screens);
        if (r.drafts.length) setOpenDrafts((o) => new Set([...o, ...r.drafts.filter((d) => d.state === 'open').map((d) => d.id)]));
      } catch {
        const failed = fail(SEND_FAILED_TEXT, true);
        void chat.keep(failed);
        setExtra((x) => [...x, ...failed]);
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
      const all = [...log, ...extra.filter((x) => !log.some((l) => l.id === x.id))];
      const i = all.findIndex((x) => x.id === noteId);
      const n = all[i];
      if (!chat || !n || n.kind !== 'note' || !n.failed?.retry || sending.current) return;
      const text = n.failed.retry;
      const prev = all[i - 1];
      const gone = [noteId, ...(prev && prev.kind === 'msg' && prev.state === 'failed' ? [prev.id] : [])];
      setExtra((x) => x.filter((y) => !gone.includes(y.id)));
      setLog((l) => l.filter((y) => !gone.includes(y.id)));
      await chat.forget(gone);
      await send(text);
    },
    [chat, log, extra, send],
  );

  const react = useCallback(
    async (id: string, emoji: string | null) => {
      if (!chat) return;
      setLog((l) => l.map((x) => (x.kind === 'msg' && x.id === id ? { ...x, myReaction: emoji ?? undefined } : x)));
      await chat.react(id, emoji);
    },
    [chat],
  );

  const update = useCallback(
    async (item: ChatItem) => {
      if (!chat) return;
      const swap = (xs: ChatItem[]) => xs.map((x) => (x.id === item.id ? item : x));
      setLog(swap);
      setExtra((xs) => (xs.some((x) => x.id === item.id) ? swap(xs) : [...xs, item]));
      await chat.keep([item]);
    },
    [chat],
  );

  const shownIds = new Set(log.map((x) => x.id));
  return { available: !!chat, items: [...log, ...extra.filter((x) => !shownIds.has(x.id)), ...(pending ? [pending] : [])], busy, chips, openDrafts, screens, send, retry, react, update };
}
