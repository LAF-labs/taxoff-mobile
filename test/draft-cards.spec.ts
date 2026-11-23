import assert from 'node:assert/strict';
import { it } from 'node:test';
import { draftWithEdits, issuableDraftCards, type Draft } from '../src/draftCards.ts';
import type { ChatItem } from '../src/chat.ts';

const first: Draft = { id: 'draft-1', counterpartyId: 'cp', amount: 320_000, vat: 'separate', item: '식자재' };
const confirmed = { amount: 855_554, vat: 'included', item: '수동 확인 품목' } as const;
const revised = { ...first, amount: 550_000, item: '설계 용역' };
const message = (id: string, draft: Draft): ChatItem => ({ kind: 'msg', id, from: 'pc', at: 1, card: { title: '세금계산서', rows: [], draft } });

it('restores the confirmed draft fields from the tab shell when Home mounts again', () => {
  const original = message('original', first);
  const edits = new Map([[original.id, confirmed]]);
  assert.deepEqual(draftWithEdits({ ...first }, edits.get(original.id)), { ...first, ...confirmed });
  assert.deepEqual(draftWithEdits(revised, edits.get('revision')), revised);
});

it('only the latest chat card for an open invoice draft can issue', () => {
  const older = message('original', first);
  const newest = message('revision', revised);
  const other = message('other', { ...first, id: 'draft-2' });
  const items = [older, other, newest];
  assert.deepEqual(issuableDraftCards(items, new Set(['draft-1', 'draft-2'])), new Set([newest.id, other.id]));
  assert.deepEqual(issuableDraftCards(items, new Set(['draft-2'])), new Set([other.id]));
});
