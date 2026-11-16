// 갤러리(웹) 전용 빈 파일 시스템. 화면을 그리는 데만 쓰고 아무것도 읽고 쓰지 않는다.
class Node {
  uri: string;
  constructor(...parts: Array<string | Node>) {
    this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
  }
  get exists() {
    return false;
  }
  get parentDirectory() {
    return new Directory(this.uri.split('/').slice(0, -1).join('/'));
  }
  create() {}
  delete() {}
  list() {
    return [];
  }
}
export class File extends Node {
  async bytes() {
    return new Uint8Array();
  }
  copySync() {}
  write() {}
}
export class Directory extends Node {}
export const Paths = { document: new Directory('doc'), cache: new Directory('cache') };
