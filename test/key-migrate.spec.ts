// 앱 진입 키 항목 마이그레이션(D08 §3.1 '앱 잠금'): 옛 생체 전용 항목 → 생체 또는 폰 암호 항목, 한 번만.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readWithMigration, type MigrateStores } from '../src/keyMigrate.ts';

function stores(init: { cur?: string | null; old?: string | null; writeFails?: boolean; legacyThrows?: Error }) {
  const st = { cur: init.cur ?? null, old: init.old ?? null, legacyReads: 0, writes: 0 };
  const s: MigrateStores = {
    readNew: async () => st.cur,
    readLegacy: async () => {
      st.legacyReads++;
      if (init.legacyThrows) throw init.legacyThrows;
      return st.old;
    },
    writeNew: async (v) => {
      st.writes++;
      if (init.writeFails) throw new Error('keychain_-25299');
      st.cur = v;
    },
    deleteLegacy: async () => {
      st.old = null;
    },
  };
  return { s, st };
}

describe('키 항목 마이그레이션', () => {
  it('새 항목이 있으면 옛 항목을 읽지 않는다', async () => {
    const { s, st } = stores({ cur: 'N', old: 'O' });
    assert.deepEqual(await readWithMigration(s), { raw: 'N', migrated: false });
    assert.equal(st.legacyReads, 0);
    assert.equal(st.writes, 0);
  });
  it('옛 항목만 있으면 새 정책으로 다시 저장하고 옛 항목을 지운다', async () => {
    const { s, st } = stores({ old: 'O' });
    assert.deepEqual(await readWithMigration(s), { raw: 'O', migrated: true });
    assert.equal(st.cur, 'O');
    assert.equal(st.old, null);
    // 두 번째 시작은 새 항목만 읽는다(한 번만)
    assert.deepEqual(await readWithMigration(s), { raw: 'O', migrated: false });
    assert.equal(st.legacyReads, 1);
  });
  it('새 항목 쓰기가 실패하면 옛 항목을 지우지 않는다', async () => {
    const { s, st } = stores({ old: 'O', writeFails: true });
    await assert.rejects(readWithMigration(s), /keychain/);
    assert.equal(st.old, 'O');
  });
  it('옛 항목 읽기를 취소하면 아무것도 바꾸지 않는다', async () => {
    const { s, st } = stores({ old: 'O', legacyThrows: new Error('User canceled') });
    await assert.rejects(readWithMigration(s), /cancel/);
    assert.equal(st.old, 'O');
    assert.equal(st.writes, 0);
  });
  it('둘 다 없으면 null', async () => {
    const { s } = stores({});
    assert.deepEqual(await readWithMigration(s), { raw: null, migrated: false });
  });
});
