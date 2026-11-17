// 앱 진입 키 항목을 새 정책(생체 또는 폰 암호, D08 §3.1 '앱 잠금')으로 옮기는 한 번짜리 마이그레이션. 순수 로직(시험용).
// 순서: 새 항목이 있으면 그것만 읽는다 → 없으면 옛 항목(생체 전용)을 읽어 새 항목에 쓰고, 쓰기가 성공한 뒤에만 옛 항목을 지운다.
// 쓰기가 실패하면 옛 항목을 그대로 두고 오류를 던진다(열쇠를 잃지 않는다). 값은 로그에 넣지 않는다.

export interface MigrateStores {
  readNew: () => Promise<string | null>;
  readLegacy: () => Promise<string | null>;
  writeNew: (v: string) => Promise<void>;
  deleteLegacy: () => Promise<void>;
}

export async function readWithMigration(s: MigrateStores): Promise<{ raw: string | null; migrated: boolean }> {
  const cur = await s.readNew();
  if (cur) return { raw: cur, migrated: false };
  const old = await s.readLegacy();
  if (!old) return { raw: null, migrated: false };
  await s.writeNew(old);
  // 지우기 실패는 다음 시작에 다시 시도된다(새 항목이 먼저 읽히므로 옛 항목은 더 쓰이지 않는다)
  await s.deleteLegacy().catch(() => {});
  return { raw: old, migrated: true };
}
