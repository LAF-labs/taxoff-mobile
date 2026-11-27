import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { WebSocket as WS } from 'ws';
import { devAcctClaim } from './test-account-key.ts';
import {
  AIK_PURPOSES, CAP, DesktopPairing, DeviceTokenCache, ReceiveQueue, VD_PURPOSES, acceptDesktopSession, b64url, certNotAfter, deviceAuthHeaders,
  drainQueue, ed25519Keygen, hpkeOpen, initialDeviceList, issueCert, makeQBundle, qbundleWindow, relayQueue, requestDeviceToken, sha256Hash,
  softNoiseStatic, softSigner, toHex, uuid4, wsRelayClient, x25519Keygen, docChunkBodies, docListPages,
  type DesktopKeys, type DeviceListJson, type DocListItem, type DocWantBody, type HttpJson, type Link, type PairRecord, type WebSocketLike,
} from '../vendor/sax-remote/src/index.ts';
import { DevAuth } from './dev-auth.ts';
import { DevRelay } from './relay-server.ts';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = `localhost:${PORT}`;
const OUT = join(import.meta.dirname, 'out');
mkdirSync(join(OUT, 'received'), { recursive: true });

const s = x25519Keygen();
const vd = ed25519Keygen();
const aik = ed25519Keygen();
const kv = x25519Keygen();
const keys: DesktopKeys = { noise: softNoiseStatic(s.secretKey), vd: softSigner(vd.secretKey, VD_PURPOSES), aik: softSigner(aik.secretKey, AIK_PURPOSES), kvPublic: () => kv.publicKey };
const deviceId = uuid4();
const registeredAt = Date.now() - (process.env.DUMMY_NEW_PC ? 3_600_000 : 30 * 86_400_000);
let deviceList: DeviceListJson = await initialDeviceList(keys.aik, { deviceId, role: 'desktop', noisePub: keys.noise.publicKey, signPub: keys.vd.publicKey, registeredAt });

const ORIGIN = `http://${HOST}`;
const auth = new DevAuth(keys.aik.publicKey, ORIGIN);
const relay = new DevRelay(auth, ORIGIN);

export const fetchJson: HttpJson = async (r) => {
  const res = await fetch(r.url, { method: r.method, headers: r.headers, body: r.body });
  const t = await res.text();
  return { status: res.status, body: t ? (JSON.parse(t) as unknown) : null };
};
const deskCert = await issueCert(keys.aik, { device_id: deviceId, role: 'desktop', Sx: keys.noise.publicKey, Vx: keys.vd.publicKey, not_after: certNotAfter() });
const tokens = new DeviceTokenCache(() => requestDeviceToken(fetchJson, ORIGIN, deskCert, keys.vd));
const client = wsRelayClient({
  host: HOST, insecureLocal: true,
  open: (url, headers) => new WS(url, { headers }) as unknown as WebSocketLike,
  deviceAuth: async (htm, htu) => deviceAuthHeaders(await tokens.token(), keys.vd, htm, htu),
});
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);

let pairing: DesktopPairing | null = null;
let qr: { text: string; exp: number } | null = null;
const pairs: PairRecord[] = [];
const received = { receipts: 0, cash: 0, viaQueue: 0 };

/** 문서함 원본(ADR-070) 시험용 PDF. DUMMY_DOCS=0이면 빈 문서함. */
function fakePdf(title: string, pad: number): Uint8Array {
  const body = `BT /F1 24 Tf 72 700 Td (${title}) Tj ET`;
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${body.length} >>\nstream\n${body}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n%${'0'.repeat(pad)}\n`;
  return new TextEncoder().encode(out);
}
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const docs = new Map<string, { item: DocListItem; bytes: Uint8Array }>();
const DOC_NAMES: Array<[string, string, string]> = [['가나식자재 세금계산서', 'tax_invoice', 'Invoice 1'], ['사업자등록증명', 'biz_registration_cert', 'Biz cert'], ['납세증명서', 'national_tax_cert', 'Tax cert'], ['대한테크 세금계산서', 'tax_invoice', 'Invoice 2']];
for (const [i, [name, docType, title]] of DOC_NAMES.slice(0, Number(process.env.DUMMY_DOCS ?? DOC_NAMES.length)).entries()) {
  const bytes = fakePdf(title, i === 0 ? 120_000 : 10);
  const docId = uuid4();
  docs.set(docId, { item: { docId, name, docType, issuedOn: today, bytes: bytes.length, sha256: toHex(sha256Hash(bytes)) }, bytes });
}
async function sendDoc(ch: { closed: boolean; send(t: 'doc.chunk', b: object): unknown }, want: DocWantBody) {
  const d = docs.get(want.docId);
  if (!d) return;
  for (const c of docChunkBodies(want.docId, d.bytes)) {
    if (ch.closed) return;
    ch.send('doc.chunk', c);
    await new Promise((r) => setTimeout(r, 100));
  }
  log(`doc sent ${d.item.name}`);
}

async function startPairing(): Promise<string> {
  if (pairing && qr && pairing.state === 'waiting_phone' && !pairing.expired) return qr.text;
  pairing?.cancel();
  const p = new DesktopPairing({
    keys, deviceList, relayHost: HOST,
    enrollPhone: async () => {},
    accountClaim: async () => devAcctClaim(keys.aik.publicKey, 'owner@example.test'),
    desktopName: '더미 PC',
    publishDeviceList: async (l) => {
      deviceList = l;
    },
    registerMailbox: async (id, r, w) => relay.registerMailbox(b64url(id), toHex(sha256Hash(r)), toHex(sha256Hash(w))),
  });
  pairing = p;
  const o = p.offer();
  qr = { text: o.qr, exp: o.exp };
  p.onState((st) => log('pairing:', st));
  relay.createRoom(b64url(p.roomId));
  const link = await client.joinRoom(p.roomId, 'desktop');
  void p.run(link);
  return o.qr;
}

async function serveMailbox(rec: PairRecord, mbxId: Uint8Array, tok: { read: Uint8Array; write: Uint8Array }, phoneVm: Uint8Array, mbxEpoch: number) {
  const stored = new Set<string>();
  const q = new ReceiveQueue({
    hasReceipt: async (id) => stored.has(id),
    storeReceipt: async ({ msgId, offer, jpeg }) => {
      writeFileSync(join(OUT, 'received', `${msgId}.jpg`), jpeg);
      writeFileSync(join(OUT, 'received', `${msgId}.json`), JSON.stringify(offer, null, 2));
      stored.add(msgId);
      received.receipts++;
      log(`receipt stored ${msgId} (${jpeg.length} B)`);
    },
    hasCash: async (id) => stored.has(id),
    storeCash: async ({ entry }) => {
      writeFileSync(join(OUT, 'received', `cash-${entry.day}.json`), JSON.stringify(entry));
      stored.add(entry.msgId);
      received.cash++;
      log(`cash stored ${entry.day}`);
    },
  });
  void serveQueue(rec, mbxId, tok, phoneVm, mbxEpoch, q);
  for (;;) {
    let link: Link;
    try {
      link = await client.joinMailbox(mbxId, tok, 'desktop');
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    while (!link.closed) {
      const sess = await acceptDesktopSession(link, {
        noise: keys.noise, pair: rec, hello: { appVersion: 'dummy-pc', deviceListVersion: deviceList.listVersion, capabilities: [CAP.receipt, CAP.receiptV2, CAP.cash, CAP.docs] },
        persistTs: async () => {},
      });
      if (!sess) continue;
      log('session open', sess.deviceListMismatch ? '(device list mismatch)' : '');
      if (sess.peerHello.capabilities.includes(CAP.docs)) for (const page of docListPages([...docs.values()].map((d) => d.item).reverse(), Date.now())) sess.channel.send('doc.list', page);
      while (!sess.channel.closed) {
        const env = await sess.channel.recv(30_000);
        if (env?.type === 'doc.want') void sendDoc(sess.channel, env.body as DocWantBody);
        else if (env) await q.handle(sess.channel, env);
      }
      log('session closed');
    }
  }
}

async function serveQueue(rec: PairRecord, mbxId: Uint8Array, tok: { read: Uint8Array; write: Uint8Array }, phoneVm: Uint8Array, mbxEpoch: number, receive: ReceiveQueue) {
  const qd = x25519Keygen();
  const rq = relayQueue({ http: fetchJson, origin: ORIGIN, mbxId, tok, deviceAuth: async (htm, htu) => deviceAuthHeaders(await tokens.token(), keys.vd, htm, htu) });
  await rq.putBundle(await makeQBundle(keys.vd, { Qx: qd.publicKey, seq: 1, ...qbundleWindow() }));
  log('queue bundle published');
  let seqMax = 0;
  for (;;) {
    try {
      const r = await drainQueue({
        queue: rq, receive, pairId: rec.pairId, phoneVm, mbxEpoch,
        hpkeOpen: async ({ enc, ct, info, aad }) => hpkeOpen(qd.secretKey, enc, info, aad, ct),
        seqMax: { get: async () => seqMax, set: async (s) => void (seqMax = s) },
      });
      if (r.handled || r.dropped) log(`queue drained: ${r.handled} handled, ${r.dropped} dropped`);
      received.viaQueue += r.handled;
    } catch (e) {
      log('queue error', (e as Error).message);
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}

const server = createServer(async (req, res) => {
  const send = (code: number, body: string, type = 'application/json') => {
    res.writeHead(code, { 'content-type': type });
    res.end(body);
  };
  try {
    if (await relay.handleHttp(req, res)) return;
    if (req.method === 'POST' && req.url === '/v1/device-tokens') {
      let body = '';
      for await (const c of req) body += c;
      const dp = req.headers.dpop;
      const r = auth.issue(body, Array.isArray(dp) ? undefined : dp);
      log('device-token', r.status);
      return send(r.status, JSON.stringify(r.body));
    }
    if (req.method === 'GET' && req.url === '/dev/qr') return send(200, await startPairing(), 'text/plain');
    if (req.method === 'GET' && req.url === '/dev/status') return send(200, JSON.stringify({ pairing: pairing?.state ?? 'idle', pairs: pairs.length, received, frames: relay.frames }));
    if (req.method === 'POST' && req.url === '/dev/sas') {
      let body = '';
      for await (const c of req) body += c;
      const code = String((JSON.parse(body) as { code?: string }).code ?? '');
      if (!pairing || pairing.state !== 'awaiting_sas') return send(409, JSON.stringify({ ok: false, state: pairing?.state }));
      const r = await pairing.submitSas(code);
      if (!r.ok) return send(200, JSON.stringify(r));
      const rec: PairRecord = { pairId: r.result.pairId, phoneStatic: r.result.phone.Sm, revoked: false, ikTsMax: 0 };
      pairs.push(rec);
      r.result.channel.close();
      log('paired', rec.pairId, r.result.phone.platform);
      void serveMailbox(rec, r.result.mbxId, { read: r.result.tokRead, write: r.result.tokWrite }, r.result.phone.Vm, r.result.mbxEpoch);
      return send(200, JSON.stringify({ ok: true, pairId: rec.pairId }));
    }
    send(404, '{}');
  } catch (e) {
    log('error', (e as Error).message);
    send(500, '{}');
  }
});
relay.attach(server);
server.listen(PORT, () => log(`dummy PC + relay on http://${HOST}`));
