import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { File } from 'expo-file-system';
import SaxNative from '../../modules/sax-native/src/SaxNativeModule';
import { deviceAuthFor } from '../net/devauth';
import { DocsError } from '../net/docs';
import { shareSetOf } from '../net/shareKey';
import { dropTemp, fetchDoc, kindOf, loadIndex, saveIndex, syncIndex, writeTemp, type DocIndex, type DocItem, type DocKind } from '../docs/box';
import { fullDay, md } from '../money';
import { useSession } from '../session';
import { space, usePalette } from '../theme';
import { ConfirmSheet, Empty, Group, Ring, Row, Screen, SearchField, Seg } from '../ui/kit';
import { Glyph, type GlyphKind } from '../ui/glyph';

/** 갤러리와 시험 화면이 실제 계정 없이 그리는 상태. */
export interface DocsPreview {
  items: DocItem[];
  busy?: string;
  failed?: boolean;
}

type Filter = 'all' | 'invoice' | 'cert';
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'invoice', label: '세금계산서' },
  { key: 'cert', label: '증명서' },
];
const GLYPH: Record<DocKind, GlyphKind> = { invoice: 'doc', cert: 'cert', other: 'paper' };

const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const shownName = (name: string) => name.replace(/\.pdf$/i, '');

/** 줄 아래 글: 발급일, 기한이 있으면 기한(지났으면 지났다고). */
function lineOf(it: DocItem, today: string): { text?: string; late: boolean } {
  const day = it.issuedOn ? fullDay(it.issuedOn) : null;
  if (!it.expiresOn) return { text: day ?? undefined, late: false };
  const late = it.expiresOn < today;
  const due = late ? '기한이 지났어요' : `${md(it.expiresOn)}까지`;
  return { text: day ? `${day}, ${due}` : due, late };
}

/** 발급일의 달로 묶는다. 올해가 아니면 해를 붙인다. 날짜가 없는 문서는 맨 아래 제목 없는 묶음. */
function groups(items: DocItem[]): Array<{ title?: string; items: DocItem[] }> {
  const year = String(new Date().getFullYear());
  const sorted = [...items].sort((a, b) => (b.issuedOn ?? '').localeCompare(a.issuedOn ?? '') || a.name.localeCompare(b.name, 'ko'));
  const out: Array<{ key: string; title?: string; items: DocItem[] }> = [];
  for (const it of sorted) {
    const key = it.issuedOn ? it.issuedOn.slice(0, 7) : '';
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      const m = Number(key.slice(5, 7));
      g = { key, title: key ? (key.startsWith(year) ? `${m}월` : `${key.slice(0, 4)}년 ${m}월`) : undefined, items: [] };
      out.push(g);
    }
    g.items.push(it);
  }
  return out;
}

/**
 * 문서함(ADR-064, 2026-11-24 대표 승인 시안): PC 문서함과 같은 문서를 계정 사본에서 받아 보여 준다.
 * 누르면 그 줄에서 받고, 애플 기본 미리보기로 연다(공유와 파일에 저장은 미리보기 도구 막대). 못 받으면 시트 하나.
 */
export function DocsScreen({ preview }: { preview?: DocsPreview }) {
  const p = usePalette();
  const s = useSession();
  const pair = s.data.pair;
  const set = useMemo(() => (pair ? shareSetOf(s.data.share, pair.pairId) : null), [pair?.pairId, s.data.share]);
  const auth = useMemo(() => (pair ? deviceAuthFor(pair.pairId, pair.cert, s.keys.vm) : null), [pair?.pairId, pair?.cert, s.keys.vm]);
  const [index, setIndex] = useState<DocIndex | null>(preview ? { v: 1, pairId: '', signPub: '', cursor: 0, items: preview.items } : null);
  const [loading, setLoading] = useState(!preview);
  const [busy, setBusy] = useState<string | null>(preview?.busy ?? null);
  const [failed, setFailed] = useState<DocItem | null>(preview?.failed ? (preview.items[0] ?? null) : null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const alive = useRef(true);
  const syncing = useRef<Promise<void> | null>(null);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const refresh = useCallback((): Promise<void> => {
    if (preview || !pair || !auth || !set) {
      setLoading(false);
      return Promise.resolve();
    }
    if (syncing.current) return syncing.current;
    const signPub = s.data.share!.signPub;
    const run = (async () => {
      const have = await loadIndex(s.keys.fileKey);
      if (have && alive.current) setIndex(have);
      try {
        const r = await syncIndex({ auth, set, pairId: pair.pairId, signPub, have });
        await saveIndex(s.keys.fileKey, r.index).catch(() => undefined);
        if (alive.current) setIndex(r.index);
      } catch {
        // 받지 못하면 가진 목록을 그대로 보인다. 다음에 화면을 열 때 다시 받는다.
      } finally {
        if (alive.current) setLoading(false);
        syncing.current = null;
      }
    })();
    syncing.current = run;
    return run;
  }, [preview, pair?.pairId, auth, set]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = async (it: DocItem) => {
    if (busy || preview || !auth) return;
    setBusy(it.docId);
    let file: File | null = null;
    try {
      const bytes = await fetchDoc(auth, it);
      file = await writeTemp(it, bytes);
      if (!alive.current) return;
      setBusy(null);
      if (SaxNative?.previewFile) await SaxNative.previewFile(file.uri, shownName(it.name));
      else await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: shownName(it.name) });
    } catch (e) {
      if (!alive.current) return;
      setBusy(null);
      setFailed(it);
      // 이미 지운 문서면 목록을 다시 받아 줄을 뺀다.
      if (e instanceof DocsError && e.code === 'account.doc_not_found') void refresh();
    } finally {
      dropTemp(file);
    }
  };

  const today = kstToday();
  const all = index?.items ?? [];
  const q = query.trim().toLowerCase();
  const shown = all.filter((it) => (filter === 'all' || kindOf(it.docType) === filter) && (!q || it.name.toLowerCase().includes(q)));

  if (!all.length) {
    return (
      <Screen title="문서함" shell scroll={false} testID="docs">
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} testID="docs-loading">
            <ActivityIndicator color={p.ink3} />
          </View>
        ) : (
          <Empty testID="docs-empty" icon={<Glyph kind="folder" size={32} color={p.ink3} />} title="아직 문서가 없어요" />
        )}
      </Screen>
    );
  }

  return (
    <Screen title="문서함" shell testID="docs">
      <View style={{ gap: space.s3 }}>
        <SearchField value={query} onChange={setQuery} placeholder="문서 찾기" testID="docs-search" />
        <Seg options={FILTERS} value={filter} onChange={setFilter} testID="docs-filter" />
      </View>
      {shown.length ? (
        groups(shown).map((g) => (
          <Group key={g.title ?? 'none'} title={g.title} testID="docs-group">
            {g.items.map((it) => {
              const line = lineOf(it, today);
              const on = busy === it.docId;
              return (
                <Row
                  key={it.docId}
                  testID={`doc-${it.docId}`}
                  icon={<Glyph kind={GLYPH[kindOf(it.docType)]} size={22} color={p.ink2} />}
                  label={shownName(it.name)}
                  lines={2}
                  sub={line.text}
                  subInk={line.late ? 'attention' : 'ink3'}
                  active={on}
                  chevron={!on}
                  accessory={on ? <Ring label="여는 중" testID="doc-opening" /> : undefined}
                  onPress={() => void open(it)}
                />
              );
            })}
          </Group>
        ))
      ) : (
        <Empty testID="docs-none" title="찾는 문서가 없어요" />
      )}
      {failed && (
        <ConfirmSheet
          title="문서를 열지 못했어요"
          body="인터넷에 연결되면 다시 열어 주세요."
          yes="다시 열기"
          no="닫기"
          onYes={() => {
            const it = failed;
            setFailed(null);
            void open(it);
          }}
          onNo={() => setFailed(null)}
        />
      )}
    </Screen>
  );
}
