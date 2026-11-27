import { RELAY_FRAME_MAX, type Link, type WebSocketLike } from '@sax/remote';

export function peerSession(link: Link, socket: WebSocketLike) {
  const listeners = new Set<() => void>();
  const frames = new Set<(frame: Uint8Array) => void>();
  let pending = 0;
  let peerGone = false;
  let ended = false;
  let resolveDrained!: () => void;
  const drained = new Promise<void>((resolve) => { resolveDrained = resolve; });
  const dispatch = socket.onmessage;
  const receive: NonNullable<WebSocketLike['onmessage']> = (event) => {
    const data = event.data;
    if (!peerGone && (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) && data.byteLength <= RELAY_FRAME_MAX) pending++;
    dispatch?.call(socket, event);
  };
  const end = () => {
    if (ended) return;
    ended = true;
    if (socket.onmessage === receive) socket.onmessage = dispatch;
    for (const cb of listeners) cb();
    listeners.clear();
    frames.clear();
    resolveDrained();
  };
  socket.onmessage = receive;
  link.onFrame((frame) => {
    if (ended) return;
    if (pending) pending--;
    for (const cb of frames) cb(frame);
    if (peerGone && pending === 0) end();
  });
  link.onClose(end);
  link.onPeerGone?.(() => {
    peerGone = true;
    if (pending === 0) end();
  });
  const session: Link = {
    get closed() {
      return peerGone || ended;
    },
    send(frame) {
      if (session.closed) throw new Error('relay: closed');
      link.send(frame);
    },
    onFrame(cb) {
      if (!ended) frames.add(cb);
    },
    onPeer(cb) {
      link.onPeer(() => {
        if (!session.closed) cb();
      });
    },
    onClose(cb) {
      if (ended) cb();
      else listeners.add(cb);
    },
    close() {
      if (!session.closed) link.close();
    },
  };
  return { session, drained };
}
