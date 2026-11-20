
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
  await s.deleteLegacy().catch(() => {});
  return { raw: old, migrated: true };
}
