import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Server } from 'socket.io';
import { beginGame, act, MODES } from './engine.mjs';
import { playerView } from './view.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const app = http.createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); return; }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!['index.html','app.js','style.css'].includes(file)) { res.writeHead(404).end('Not found'); return; }
  try {
    const data = await fs.readFile(path.join(root, file));
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end('Not found'); }
});
const io = new Server(app, { maxHttpBufferSize: 12_000, cors: { origin: false } });
const rooms = new Map();
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({length: 6}, () => alphabet[randomInt(alphabet.length)]).join('');
const token = () => randomBytes(24).toString('hex');
const eq = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};
const cleanName = name => typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 20) : '';
const err = (socket, message) => socket.emit('errorMessage', message);
function tell(room) {
  room.updatedAt = Date.now();
  for (const player of room.players) if (player.socketId) io.to(player.socketId).emit('roomState', playerView(room, player.id));
}
function record(room, item) {
  room.history.push({ ...item, id: token().slice(0, 12), at: Date.now() });
  if (room.history.length > 300) room.history.shift();
}
function active(socket) {
  const { roomCode, playerId } = socket.data;
  const room = rooms.get(roomCode);
  if (!room) throw new Error('ルームが見つかりません');
  const player = room.players.find(p => p.id === playerId && p.socketId === socket.id);
  if (!player) throw new Error('参加情報が一致しません。再参加してください');
  return { room, player };
}
function assign(socket, room, player) {
  const previous = player.socketId;
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  player.socketId = socket.id;
  if (previous && previous !== socket.id) io.sockets.sockets.get(previous)?.disconnect(true);
  socket.join(room.code);
  socket.emit('session', { roomCode: room.code, playerId: player.id, secret: player.secret });
  tell(room);
}
function safe(socket, fn) {
  return (...args) => { try { fn(...args); } catch(e) { err(socket, e.message || '操作に失敗しました'); } };
}
function ensureHost(room, player) { if (room.hostId !== player.id) throw new Error('ホストだけが操作できます'); }
function start(room) {
  if (room.players.length < 2 || room.players.length > 5) throw new Error('2〜5人必要です');
  if (room.players.some(p => !p.socketId)) throw new Error('全員の接続を確認してください。未接続の人は除外できます');
  room.game = beginGame(room.players, room.mode);
  room.history = [];
  room.chat = [];
  record(room, { kind: 'system', message: 'ゲームが始まりました！' });
  tell(room);
}
io.on('connection', socket => {
  socket.on('createRoom', safe(socket, data => {
    if (socket.data.roomCode) throw new Error('すでに参加しています');
    const name = cleanName(data?.name);
    if (!name) throw new Error('名前を入力してください');
    let code; do { code = newCode(); } while (rooms.has(code));
    const player = { id: token(), secret: token(), name, socketId: null, hand: [] };
    const room = { code, mode: 'classic', hostId: player.id, players: [player], game: null, history: [], chat: [], updatedAt: Date.now() };
    rooms.set(code, room);
    assign(socket, room, player);
  }));
  socket.on('joinRoom', safe(socket, data => {
    if (socket.data.roomCode) throw new Error('すでに参加しています');
    const code = String(data?.code ?? '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new Error('ルームが見つかりません。コードを確認してください');
    if (room.game?.phase === 'playing') throw new Error('進行中のゲームには新規参加できません');
    if (room.players.length >= 5) throw new Error('満員です（最大5人）');
    const name = cleanName(data?.name);
    if (!name) throw new Error('名前を入力してください');
    const player = { id: token(), secret: token(), name, socketId: null, hand: [] };
    room.players.push(player);
    assign(socket, room, player);
  }));
  socket.on('resume', safe(socket, data => {
    const code = String(data?.roomCode ?? '').toUpperCase();
    const room = rooms.get(code);
    const player = room?.players.find(p => p.id === data?.playerId && eq(p.secret, data?.secret));
    if (!player) throw new Error('復帰するルームがありません。サーバー再起動後は復元できません');
    if (socket.data.roomCode && (socket.data.roomCode !== code || socket.data.playerId !== player.id)) throw new Error('別のルームに参加中です');
    assign(socket, room, player);
  }));
  socket.on('setMode', safe(socket, data => {
    const { room, player } = active(socket); ensureHost(room, player);
    if (room.game?.phase === 'playing') throw new Error('ゲーム途中で変更できません');
    if (!MODES.includes(data?.mode)) throw new Error('モードが不正です');
    room.mode = data.mode;
    tell(room);
  }));
  socket.on('backToLobby', safe(socket, () => {
    const { room, player } = active(socket); ensureHost(room, player);
    if (room.game?.phase !== 'finished') throw new Error('終了したゲームからのみ戻れます');
    room.game = null;
    for (const p of room.players) p.hand = [];
    tell(room);
  }));
  socket.on('startGame', safe(socket, () => {
    const { room, player } = active(socket); ensureHost(room, player);
    if (room.game?.phase === 'playing') throw new Error('ゲームはすでに進行中です');
    start(room);
  }));
  socket.on('playerAction', safe(socket, data => {
    const { room, player } = active(socket);
    const result = act(room.game, room.players, player.id, data);
    record(room, result);
    if (room.game.phase === 'finished') record(room, { kind: 'system', message: 'ゲームが終了しました。' });
    tell(room);
  }));
  socket.on('chat', safe(socket, data => {
    const { room, player } = active(socket);
    const message = typeof data?.message === 'string' ? data.message.trim().slice(0, 300) : '';
    if (!message) return;
    if (Date.now() - (socket.data.lastChat || 0) < 750) throw new Error('連続送信は少し間隔を空けてください');
    socket.data.lastChat = Date.now();
    room.chat.push({ id: token().slice(0, 12), player: player.name, playerId: player.id, message, at: Date.now() });
    if (room.chat.length > 150) room.chat.shift();
    tell(room);
  }));
  socket.on('removePlayer', safe(socket, data => {
    const { room, player } = active(socket); ensureHost(room, player);
    if (room.game?.phase === 'playing') throw new Error('プレイ中に退席処理はできません');
    const target = room.players.find(p => p.id === data?.playerId);
    if (!target || target.socketId || target.id === player.id) throw new Error('未接続の他プレイヤーのみ除外できます');
    room.players = room.players.filter(p => p.id !== target.id);
    tell(room);
  }));
  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    const player = room?.players.find(p => p.id === socket.data.playerId);
    // Old socket may disconnect after a successful session takeover.
    if (!player || player.socketId !== socket.id) return;
    player.socketId = null;
    if (room.hostId === player.id && room.game?.phase !== 'playing') {
      const successor = room.players.find(p => p.socketId);
      if (successor) room.hostId = successor.id;
    }
    tell(room);
  });
});
// Avoid unbounded in-memory accumulation of abandoned rooms.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.updatedAt > 6 * 60 * 60 * 1000 && room.players.every(p => !p.socketId)) rooms.delete(code);
  }
}, 60 * 60 * 1000).unref();
const port = Number(process.env.PORT || 3000);
app.listen(port, '0.0.0.0', () => console.log(`Hanabi online running on http://localhost:${port}`));
