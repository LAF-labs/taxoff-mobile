import { setImmediate } from 'node:timers/promises';

export const entries = new Map<string, Uint8Array | string | null>();
export const denied = new Set<string>();
export const Paths = { document: 'file:///app/files' };

export class Directory {
  readonly uri: string;
  constructor(base: string, name: string) {
    this.uri = `${base}/${name}`;
  }
  get exists() {
    return entries.has(this.uri);
  }
  create() {
    entries.set(this.uri, null);
  }
}

export class File {
  readonly uri: string;
  readonly parentDirectory: Directory | string;
  constructor(parentDirectory: Directory | string, name: string) {
    this.parentDirectory = parentDirectory;
    this.uri = `${typeof parentDirectory === 'string' ? parentDirectory : parentDirectory.uri}/${name}`;
  }
  async write(bytes: Uint8Array | string) {
    await setImmediate();
    entries.set(this.uri, bytes);
  }
  delete() {
    entries.delete(this.uri);
  }
}

export default {
  async protectPath(uri: string) {
    return { excludedFromBackup: entries.has(uri) && !denied.has(uri) };
  },
};
