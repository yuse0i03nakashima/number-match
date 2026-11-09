// VS(2 台のスマホで同じ Board を同時に遊び、得点を競う)の通信と準備。
//   通信は WebRTC のデータチャネル。相手を見つける仲介(シグナリング)だけ PeerJS の公開サーバーを使い、
//   盤面と得点は端末どうしが直接やり取りする。サーバーに得点は残らない。
//   PeerJS は VS を使うときだけ CDN から読み込む(main.js の起動には要らない)。
//   盤面は部屋を作った側(host)が選び、cells をそのまま相手に送る。両方が同じ stages.json を持っていなくても同じ Board になる。

const PEER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.5/peerjs.min.js';
const ID_PREFIX = 'the-ten-vs-';
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 見間違えやすい I O 0 1 を除く
export const CODE_LEN = 4;

let peerLoading = null;
/** PeerJS を 1 回だけ読み込む。すでにあればそれを返す。 */
export function loadPeer() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  if (peerLoading) return peerLoading;
  peerLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PEER_SRC;
    s.onload = () => (globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error('PeerJS が読めない')));
    s.onerror = () => { peerLoading = null; reject(new Error('通信ライブラリを読み込めない(電波を確認)')); };
    document.head.appendChild(s);
  });
  return peerLoading;
}

/** 部屋の合言葉(4 文字)。 */
export function makeCode(rnd = Math.random) {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[Math.floor(rnd() * CODE_CHARS.length)];
  return s;
}
/** 入力された合言葉を整える(大文字にし、使わない文字を除く。0 → O、1 → I は使わない文字なので捨てる)。 */
export function normalizeCode(text) {
  return String(text ?? '').toUpperCase().split('').filter((c) => CODE_CHARS.includes(c)).join('').slice(0, CODE_LEN);
}

/**
 * host が World から Board を選ぶ。stages は stages.json の配列。
 * 返り値 { stageIndex, def, variant } 。rnd は 0 以上 1 未満の乱数(検査では固定できる)。
 */
export function pickBoard(stages, world, worldSize, rnd = Math.random) {
  const first = Math.max(0, Math.min(world, Math.ceil(stages.length / worldSize) - 1)) * worldSize;
  const inWorld = stages.slice(first, first + worldSize);
  const k = Math.min(inWorld.length - 1, Math.floor(rnd() * inWorld.length));
  const def = inWorld[k];
  const variant = def.boards[Math.min(def.boards.length - 1, Math.floor(rnd() * def.boards.length))];
  return { stageIndex: first + k, def, variant };
}

/** 相手に送る対戦の設定(Board そのものを含む)。 */
export function makeSetup(pick, { timeLimitMs, world }) {
  return { stage: pick.def.stage, world, cells: pick.variant.cells.slice(), adds: pick.def.adds, cellsCount: pick.def.cellsCount, timeLimitMs };
}
/** 受け取った設定から、Game に渡す 1 Stage ぶんの面データを作る。 */
export function stageDefFrom(setup) {
  return { stage: setup.stage, cellsCount: setup.cellsCount, adds: setup.adds, boards: [{ cells: setup.cells.slice() }] };
}

/**
 * 1 対 1 の接続。host(code) か join(code) のどちらかを呼ぶ。
 * イベント: on('open')(つながった) / on('data', obj) / on('close') / on('error', message)
 */
export class VsLink {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.handlers = {};
    this.closed = false;
  }
  on(ev, fn) { (this.handlers[ev] ??= []).push(fn); return this; }
  emit(ev, ...args) { for (const fn of this.handlers[ev] ?? []) fn(...args); }

  async host(code) {
    const Peer = await loadPeer();
    await new Promise((resolve, reject) => {
      this.peer = new Peer(ID_PREFIX + code, { debug: 0 });
      const timer = setTimeout(() => reject(new Error('仲介サーバーにつながらない(電波を確認)')), 15000);
      this.peer.on('open', () => { clearTimeout(timer); resolve(); });
      this.peer.on('error', (e) => {
        clearTimeout(timer);
        if (e.type === 'unavailable-id') reject(Object.assign(new Error('その合言葉は使われている'), { retry: true }));
        else if (!this.conn) reject(new Error(describe(e)));
        else this.emit('error', describe(e));
      });
      this.peer.on('connection', (c) => {
        if (this.conn) { c.close(); return; }     // 3 人目は断る
        this.conn = c;
        this.wire(c);
      });
    });
  }

  async join(code) {
    const Peer = await loadPeer();
    await new Promise((resolve, reject) => {
      this.peer = new Peer({ debug: 0 });
      const timer = setTimeout(() => reject(new Error('相手が見つからない(合言葉と電波を確認)')), 20000);
      this.peer.on('error', (e) => {
        clearTimeout(timer);
        if (e.type === 'peer-unavailable') reject(new Error('その合言葉の部屋が無い'));
        else if (!this.conn || !this.conn.open) reject(new Error(describe(e)));
        else this.emit('error', describe(e));
      });
      this.peer.on('open', () => {
        const c = this.peer.connect(ID_PREFIX + code, { reliable: true, serialization: 'json' });   // Safari でも通る JSON
        this.conn = c;
        this.wire(c, () => { clearTimeout(timer); resolve(); });
      });
    });
  }

  wire(c, onOpen) {
    c.on('open', () => { if (onOpen) onOpen(); this.emit('open'); });
    c.on('data', (d) => { if (d && typeof d === 'object') this.emit('data', d); });
    c.on('close', () => { if (!this.closed) this.emit('close'); });
    c.on('error', (e) => this.emit('error', describe(e)));
  }

  get open() { return !!(this.conn && this.conn.open); }
  send(obj) { if (this.open) { try { this.conn.send(obj); } catch { /* 切れた直後は無視 */ } } }
  close() {
    this.closed = true;
    try { this.conn?.close(); } catch { /* 無視 */ }
    try { this.peer?.destroy(); } catch { /* 無視 */ }
    this.conn = null; this.peer = null;
  }
}

function describe(e) {
  const t = e?.type ?? '';
  if (t === 'network' || t === 'server-error' || t === 'socket-error' || t === 'socket-closed') return '仲介サーバーにつながらない(電波を確認)';
  if (t === 'browser-incompatible') return 'このブラウザは対戦に対応していない';
  if (t === 'disconnected') return '仲介サーバーから切れた';
  return e?.message ? String(e.message) : '通信に失敗した';
}
