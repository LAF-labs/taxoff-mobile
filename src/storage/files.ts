import { Directory, File, Paths } from 'expo-file-system';
import SaxNative, { type PathProtection } from '../../modules/sax-native/src/SaxNativeModule';

export const ROOT = new Directory(Paths.document, 'sax');
const MARKER = new File(Paths.document, 'sax-install.json');

export class ProtectionError extends Error {
  constructor() {
    super('files: protection unavailable');
  }
}

interface InstallMarker {
  installedAt: number;
  deviceId?: string;
  onboardedAt?: number;
}

export function installMarker(): InstallMarker | null {
  try {
    if (!MARKER.exists) return null;
    return JSON.parse(MARKER.textSync()) as InstallMarker;
  } catch {
    return null;
  }
}

export async function writeInstallMarker(m: InstallMarker): Promise<void> {
  await MARKER.write(JSON.stringify(m));
  await protect(MARKER.uri);
}

export function wipeAppData(): void {
  if (ROOT.exists) ROOT.delete();
}

async function protect(uri: string): Promise<PathProtection> {
  if (!SaxNative) throw new ProtectionError();
  const p = await SaxNative.protectPath(uri);
  if (!p.excludedFromBackup) throw new ProtectionError();
  return p;
}

export async function inspect(uri: string): Promise<PathProtection | null> {
  return SaxNative ? SaxNative.inspectPath(uri) : null;
}

async function ensureDir(d: Directory): Promise<Directory> {
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
  await protect(d.uri);
  return d;
}

export async function writeProtected(f: File, bytes: Uint8Array): Promise<void> {
  await ensureDir(f.parentDirectory);
  await f.write(bytes);
  try {
    await protect(f.uri);
  } catch (e) {
    f.delete();
    throw e;
  }
}

export function deleteQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* 이미 없음 */
  }
}

const CAPTURE_CACHE_DIRS = ['Camera', 'ImageManipulator'] as const;
export function sweepCaptureTemps(): void {
  for (const name of CAPTURE_CACHE_DIRS) {
    try {
      const d = new Directory(Paths.cache, name);
      if (!d.exists) continue;
      for (const c of d.list()) {
        try {
          c.delete();
        } catch {
          /* 다음 시작 때 다시 */
        }
      }
    } catch {
      /* 폴더 없음 */
    }
  }
}
