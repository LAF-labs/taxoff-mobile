import { WebSocket as WS } from 'ws';
import {
  CAP, DeviceTokenCache, MobilePairing, RECEIPT_CHUNK, VM_PURPOSES, deviceAuthHeaders, ed25519Keygen, enqueueCash, flushOutbox, fromB64, makeCashEntry,
  makeReceiptOffer, monotonicClock, openMobileSession, queueOutbox, relayQueue, requestDeviceToken, softNoiseStatic, softSigner, uuid4, verifyQBundle,
  wsRelayClient, x25519Keygen,
  type HttpJson, type Link, type OutboxItem, type OutboxStore, type SignedCert, type WebSocketLike,
} from '../vendor/sax-remote/src/index.ts';

import { parsePaperInvoice } from '../src/capture/invoice.ts';
import { toWire } from '../src/capture/invoice-wire.ts';
import { paperTaxInvoice } from '../test/fixtures/invoice-boxes.ts';

const HOST = 'localhost:8787';
const base = `http://${HOST}`;
const CONNECT_WAIT_MS = 5000;

function waitForPeer(link: Link): Promise<boolean> {
  return new Promise((resolve) => {
    const finish = (ready: boolean) => {
      clearTimeout(timer);
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), CONNECT_WAIT_MS);
    link.onClose(() => finish(false));
    link.onPeer(() => finish(true));
  });
}

const fetchJson: HttpJson = async (r) => {
  const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body });
  const t = await res.text();
  return { status: res.status, body: t ? (JSON.parse(t) as unknown) : null };
};
let tokens: DeviceTokenCache | null = null;
const client = wsRelayClient({
  host: HOST, insecureLocal: true,
  open: (u, headers) => new WS(u, { headers }) as unknown as WebSocketLike,
  deviceAuth: async (htm, htu) => deviceAuthHeaders(await tokens!.token(), vmSigner, htm, htu),
});

const qr = await (await fetch(`${base}/dev/qr`)).text();
const s = x25519Keygen();
const vm = ed25519Keygen();
const km = x25519Keygen();
const noise = softNoiseStatic(s.secretKey);
const vmSigner = softSigner(vm.secretKey, VM_PURPOSES);
const mp = new MobilePairing({
  keys: { noise, vmPub: vm.publicKey, kmPub: km.publicKey, deviceId: uuid4(), name: 'smoke', platform: 'ios' },
  relayAllowlist: [HOST], pairOkTimeoutMs: 15_000, accountKeys: [fromB64('3uABVr6gwZIYy5ir9UMb2ohr2fxONenkzT9XtRRIBCY=')],
});
if (!mp.scan(qr)) throw new Error(`scan failed: ${mp.failure}`);
const link = await client.joinRoom(mp.roomId, 'mobile');
mp.onState((st) => {
  if (st === 'show_sas') void fetch(`${base}/dev/sas`, { method: 'POST', body: JSON.stringify({ code: mp.sas }) });
});
const r = await mp.run(link);
if (!r) throw new Error(`pair failed: ${mp.failure}`);
r.channel.close();
console.log('paired', r.pairId);

const items = new Map<string, { it: OutboxItem; photo?: Uint8Array }>();
const store: OutboxStore = {
  list: async () => [...items.values()].map((x) => x.it),
  put: async (it, photo) => void items.set(it.msgId, { it, photo: photo ?? items.get(it.msgId)?.photo }),
  readPhoto: async (id) => items.get(id)!.photo!,
  remove: async (id) => void items.delete(id),
};
const jpeg = new Uint8Array(RECEIPT_CHUNK * 3 + 77);
jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
for (let i = 4; i < jpeg.length; i++) jpeg[i] = (i * 31) & 0xff;
const paper = toWire(parsePaperInvoice(paperTaxInvoice())!.invoice);
if (!paper.ok) throw new Error(`paperInvoice: ${paper.bad.join(',')}`);
const offer = makeReceiptOffer(jpeg, { capturedAt: Date.now(), ocrEngine: 'ios_vision', ownerConfirmed: true, paperInvoice: paper.invoice });
await store.put({ kind: 'receipt', msgId: offer.msgId, offer, createdAt: Date.now(), attempts: 0 }, jpeg);
await enqueueCash(store, makeCashEntry('2026-11-05', 1234));

const myCert: SignedCert = r.cert;
tokens = new DeviceTokenCache(() => requestDeviceToken(fetchJson, base, myCert, vmSigner));

if (process.argv.includes('--queue')) {
  const rq = relayQueue({
    http: fetchJson, origin: base, mbxId: fromB64(r.mbxId), tok: { read: fromB64(r.tokRead), write: fromB64(r.tokWrite) },
    deviceAuth: async (htm, htu) => deviceAuthHeaders(await tokens!.token(), vmSigner, htm, htu),
  });
  let field: string | null = null;
  for (let i = 0; i < 20 && !field; i++) {
    field = await rq.getBundle();
    if (!field) await new Promise((res) => setTimeout(res, 200));
  }
  const bundle = field ? verifyQBundle(field, r.desktopVd) : null;
  if (!bundle) throw new Error('no valid bundle');
  let seq = 0;
  const q = await queueOutbox(store, { queue: rq, pairId: r.pairId, vm: vmSigner, bundle, mbxEpoch: r.mbxEpoch, nextSeq: () => ++seq });
  console.log('queued', q.queued.length, 'waiting', q.waiting.length);
  let st: { received: { receipts: number; cash: number; viaQueue: number } } | null = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((res) => setTimeout(res, 500));
    st = (await (await fetch(`${base}/dev/status`)).json()) as typeof st;
    if (st!.received.viaQueue >= 1 + Math.ceil(jpeg.length / 32768) + 1) break;
  }
  console.log('pc status', JSON.stringify(st));
  process.exit(q.queued.length === 2 && st!.received.receipts === 1 && st!.received.cash === 1 ? 0 : 1);
}
const nextTimestamp = monotonicClock(0);
const connect = async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const mbx = await client.joinMailbox(fromB64(r.mbxId), { read: fromB64(r.tokRead), write: fromB64(r.tokWrite) }, 'mobile');
    if (await waitForPeer(mbx)) {
      // A reconnect can still see presence from the desktop's previous socket.
      mbx.onPeerGone?.(() => mbx.close());
      const sess = await openMobileSession(mbx, {
        pairId: r.pairId, noise, desktopStatic: r.desktopStatic, nextTimestamp,
        hello: { appVersion: 'smoke', deviceListVersion: r.deviceList.listVersion, capabilities: [CAP.receipt, CAP.receiptV2, CAP.cash] },
        responseTimeoutMs: CONNECT_WAIT_MS, helloTimeoutMs: CONNECT_WAIT_MS,
      });
      if (sess) return { mbx, sess };
    }
    mbx.close();
  }
  throw new Error('desktop session unavailable after waiting for relay peer');
};
const { sess } = await connect();
const f = await flushOutbox(sess.channel, store, { pace: async () => {} });
console.log('flushed', f.sent.length, 'pending', f.pending.length);
sess.channel.close();
const resumed = await connect();
resumed.mbx.close();
(await connect()).sess.channel.close();
console.log('reconnected after graceful and abrupt disconnects');
const st = await (await fetch(`${base}/dev/status`)).json();
console.log('pc status', JSON.stringify(st));
process.exit(f.pending.length === 0 && f.sent.length === 2 ? 0 : 1);
