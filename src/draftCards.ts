import type { ChatCard, ChatItem } from './chat';

export type Draft = NonNullable<ChatCard['draft']>;
export type DraftFields = Pick<Draft, 'amount' | 'vat' | 'item'>;

export function draftWithEdits(draft: Draft, confirmed?: DraftFields): Draft {
  return confirmed ? { ...draft, ...confirmed } : draft;
}

export function issuableDraftCards(items: readonly ChatItem[], openDrafts?: ReadonlySet<string>): ReadonlySet<string> {
  const seen = new Set<string>();
  const issuable = new Set<string>();
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it?.kind !== 'msg' || !it.card?.draft) continue;
    const { id, phone } = it.card.draft;
    if (seen.has(id)) continue;
    seen.add(id);
    if (phone ? !it.card.sent : !openDrafts || openDrafts.has(id)) issuable.add(it.id);
  }
  return issuable;
}
