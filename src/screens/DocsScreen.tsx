import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { File } from 'expo-file-system';
import SaxNative from '../../modules/sax-native/src/SaxNativeModule';
import { dropTemp, kindOf, loadIndex, onIndex, readDoc, removeDoc, saveIndex, writeTemp, type DocIndex, type DocItem, type DocKind } from '../docs/box';
import { fullDay, md } from '../money';
import { useSession } from '../session';
import { radius, space, usePalette } from '../theme';
import { Button, Empty, Group, Ring, Row, Screen, Seg, T } from '../ui/kit';
import { Actions, Card } from '../ui/card';
import hometaxLogo from '../../assets/issuer-hometax.png';
import wetaxLogo from '../../assets/issuer-wetax.png';
import { SearchField } from '../ui/form';
import { ConfirmSheet } from '../ui/sheet';
import { Glyph } from '../ui/glyph';

/** 갤러리와 시험 화면이 실제 계정 없이 그리는 상태. */
export interface DocsPreview {
  items: DocItem[];
  busy?: string;
  failed?: boolean;
}

type Filter = 'all' | DocKind;
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'cert', label: '증명서' },
  { key: 'invoice', label: '세금계산서' },
  { key: 'other', label: '직접 올린 서류' },
];
const KIND_GROUP: Array<{ kind: DocKind; title: string }> = [
  { kind: 'cert', title: '증명서' },
  { kind: 'other', title: '직접 올린 서류' },
  { kind: 'invoice', title: '세금계산서' },
];
const LOGO: Record<string, number> = { 홈택스: hometaxLogo, 위택스: wetaxLogo };
const SOON_DAYS = 7;

/** 증명서를 낸 곳. 지방세는 위택스, 나머지 앱이 떼는 증명서는 홈택스다. */
const issuerOf = (it: DocItem): string => (/지방세/.test(it.name) ? '위택스' : '홈택스');

function Mark({ it }: { it: DocItem }) {
  const p = usePalette();
  const kind = kindOf(it.docType);
  const tile = { width: 34, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' } as const;
  if (kind !== 'cert') return <View style={[tile, { backgroundColor: p.sunken }]}><Glyph kind={kind === 'invoice' ? 'receipt' : 'contract'} size={20} color={p.ink} /></View>;
  return (
    <View style={[tile, { backgroundColor: p.overlay }]}>
      <Image source={LOGO[issuerOf(it)]} style={{ width: 22, height: 22 }} accessibilityIgnoresInvertColors />
    </View>
  );
}

const daysLeft = (until: string, today: string) => Math.round((Date.parse(until) - Date.parse(today)) / 86_400_000);

const kstToday = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const shownName = (name: string) => name.replace(/\.pdf$/i, '');
const josaGa = (s: string) => {
  const c = s.charCodeAt(s.length - 1) - 0xac00;
  return c >= 0 && c < 11172 && c % 28 ? '이' : '가';
};
const syncedText = (iso: string) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat('ko-KR', today ? { hour: 'numeric', minute: '2-digit' } : { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
};

/** 줄 아래 글: 낸 곳, 발급일, 기한(이레 안이면 남은 날, 지났으면 지났다고). */
function lineOf(it: DocItem, today: string): { text?: string; late: boolean } {
  const parts = [kindOf(it.docType) === 'other' ? '직접 올림' : issuerOf(it), it.issuedOn ? fullDay(it.issuedOn) : null];
  if (!it.expiresOn) return { text: parts.filter(Boolean).join(', '), late: false };
  const n = daysLeft(it.expiresOn, today);
  const late = n <= SOON_DAYS;
  parts.push(n < 0 ? '기한이 지났어요' : n === 0 ? '오늘까지' : late ? `${n}일 남음` : `${md(it.expiresOn)}까지`);
  return { text: parts.filter(Boolean).join(', '), late };
}

/** 발급일의 달로 묶는다. 올해가 아니면 해를 붙인다. 날짜가 없는 문서는 맨 아래 제목 없는 묶음. */
function groups(items: DocItem[], filter: Filter): Array<{ title?: string; items: DocItem[] }> {
  if (filter === 'all') {
    const byDay = (a: DocItem, b: DocItem) => (b.issuedOn ?? '').localeCompare(a.issuedOn ?? '') || a.name.localeCompare(b.name, 'ko');
    return KIND_GROUP.map((g) => ({ title: g.title, items: items.filter((it) => kindOf(it.docType) === g.kind).sort(byDay) })).filter((g) => g.items.length > 0);
  }
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

export function DocsScreen({ preview, onAsk }: { preview?: DocsPreview; onAsk: (text: string) => void }) {
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
  const soon = all
    .filter((it) => kindOf(it.docType) === 'cert' && it.expiresOn && daysLeft(it.expiresOn, today) >= 0 && daysLeft(it.expiresOn, today) <= SOON_DAYS)
    .sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''))[0];
  const soonLeft = soon?.expiresOn ? daysLeft(soon.expiresOn, today) : 0;
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
      {soon && (
        <Card kind="check" tone="attention" title={`${shownName(soon.name)}${josaGa(shownName(soon.name))} ${soonLeft === 0 ? '오늘' : `${soonLeft}일 뒤`} 끝나요`} testID="docs-soon">
          <Actions>
            <Button label="다시 떼기" onPress={() => onAsk(`${shownName(soon.name)} 떼 줘`)} testID="docs-soon-again" />
          </Actions>
        </Card>
      )}
      {index?.syncedAt && (
        <T v="label" c="ink3" style={{ alignSelf: 'flex-end', paddingHorizontal: space.s1 }} testID="docs-synced">
          {syncedText(index.syncedAt)}에 받음
        </T>
      )}
      {shown.length ? (
        groups(shown, filter).map((g) => (
          <Group key={g.title ?? 'none'} title={g.title} testID="docs-group">
            {g.items.map((it) => {
              const line = lineOf(it, today);
              const on = busy === it.docId;
              return (
                <Row
                  key={it.docId}
                  testID={`doc-${it.docId}`}
                  icon={<Mark it={it} />}
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
