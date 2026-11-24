import type { Link } from '@sax/remote';

export function peerSession(link: Link): Link {
  const listeners = new Set<() => void>();
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    for (const cb of listeners) cb();
    listeners.clear();
  };
  link.onClose(end);
  link.onPeerGone?.(end);
  return {
    get closed() {
      return ended;
    },
    send(frame) {
      if (ended) throw new Error('relay: closed');
      link.send(frame);
    },
    onFrame(cb) {
      link.onFrame((frame) => {
        if (!ended) cb(frame);
      });
    },
    onPeer(cb) {
      link.onPeer(() => {
        if (!ended) cb();
      });
    },
    onClose(cb) {
      if (ended) cb();
      else listeners.add(cb);
    },
    close() {
      if (!ended) link.close();
    },
  };
}
