import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { File } from 'expo-file-system';
import SaxNative from '../../modules/sax-native/src/SaxNativeModule';
import { dropTemp, kindOf, loadIndex, onIndex, readDoc, removeDoc, saveIndex, writeTemp, type DocIndex, type DocItem, type DocKind } from '../docs/box';
import { fullDay, md } from '../money';
import { useSession } from '../session';
import { space, usePalette } from '../theme';
import { Empty, Group, Ring, Row, Screen, Seg } from '../ui/kit';
import { SearchField } from '../ui/form';
import { ConfirmSheet } from '../ui/sheet';
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
 * 문서함(2026-11-24 대표 승인 시안, ADR-070): PC가 라이브 연결로 보낸 원본을 이 폰에서 연다. PC가 꺼져 있어도 열린다.
 * 누르면 애플 기본 미리보기로 연다(공유와 파일에 저장은 미리보기 도구 막대). 열리지 않으면 그 문서를 지우고 다음 연결 때 다시 받는다.
 */
export function DocsScreen({ preview }: { preview?: DocsPreview }) {
  const p = usePalette();
  const s = useSession();
  const pairId = s.data.pair?.pairId ?? null;
  const [index, setIndex] = useState<DocIndex | null>(preview ? { v: 2, pairId: '', items: preview.items } : null);
  const [loading, setLoading] = useState(!preview);
  const [busy, setBusy] = useState<string | null>(preview?.busy ?? null);
  const [failed, setFailed] = useState<DocItem | null>(preview?.failed ? (preview.items[0] ?? null) : null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  useEffect(() => {
    if (preview) return;
    const mine = (d: DocIndex | null) => (d && d.pairId === pairId ? d : null);
    void loadIndex(s.keys.fileKey).then((d) => {
      if (!alive.current) return;
      setIndex(mine(d));
      setLoading(false);
    });
    return onIndex((d) => alive.current && setIndex(mine(d)));
  }, [preview, pairId, s.keys.fileKey]);

  const open = async (it: DocItem) => {
    if (busy || preview) return;
    setBusy(it.docId);
    let file: File | null = null;
    try {
      const bytes = await readDoc(s.keys.fileKey, it.docId);
      file = await writeTemp(it, bytes);
      if (!alive.current) return;
      setBusy(null);
      if (SaxNative?.previewFile) await SaxNative.previewFile(file.uri, shownName(it.name));
      else await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: shownName(it.name) });
    } catch {
      // 열리지 않는 사본은 지우고 목록에서 뺀다. 다음 연결에서 PC 목록과 견주어 다시 받는다.
      removeDoc(it.docId);
      const cur = await loadIndex(s.keys.fileKey);
      if (cur) await saveIndex(s.keys.fileKey, { ...cur, items: cur.items.filter((x) => x.docId !== it.docId) }).catch(() => undefined);
      if (!alive.current) return;
      setBusy(null);
      setFailed(it);
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
        <SearchField value={query} onChange={setQuery} placeholder="문서 찾기" label="문서 찾기" testID="docs-search" />
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
          body="다음 연결 때 다시 받아 둘게요."
          yes="확인"
          onYes={() => setFailed(null)}
          onClose={() => setFailed(null)}
        />
      )}
    </Screen>
  );
}
