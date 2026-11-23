import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, it } from 'node:test';
import { denied, entries } from './fixtures/protected-files.ts';

registerHooks({
  resolve(spec, ctx, next) {
    if (spec === 'expo-file-system' || spec === '../../modules/sax-native/src/SaxNativeModule') {
      return next(new URL('./fixtures/protected-files.ts', import.meta.url).href, ctx);
    }
    return next(spec, ctx);
  },
});

const { ROOT, ProtectionError, writeInstallMarker, writeProtected } = await import('../src/storage/files.ts');
const { File, Paths } = await import('expo-file-system');

beforeEach(() => {
  entries.clear();
  denied.clear();
});

it('waits for the first-install marker to exist before protecting it', async () => {
  await writeInstallMarker({ installedAt: 1 });
  assert.equal(entries.get(`${Paths.document}/sax-install.json`), '{"installedAt":1}');
});

it('waits for sealed bytes to be written before protecting their file', async () => {
  const file = new File(ROOT, 'state.bin');
  const bytes = Uint8Array.of(1, 2, 3);
  await writeProtected(file, bytes);
  assert.deepEqual(entries.get(file.uri), bytes);
});

it('removes the completed write if protection is denied', async () => {
  const file = new File(ROOT, 'state.bin');
  denied.add(file.uri);
  await assert.rejects(writeProtected(file, Uint8Array.of(1)), ProtectionError);
  assert.equal(entries.has(file.uri), false);
});
