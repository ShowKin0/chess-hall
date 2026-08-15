const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const PORT = process.env.PORT || 1010;
const HOST = process.env.HOST || '0.0.0.0';

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/* ---------------- 轻量 WebSocket 服务端（RFC6455 基础实现，零依赖） ---------------- */
class MiniWebSocket extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.readyState = 1; // OPEN
    this._buffer = Buffer.alloc(0);
    this._fragments = [];
    this._fragOpcode = null;
    this._closed = false;

    socket.setNoDelay(true);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('error', () => this._destroy());
    socket.on('close', () => this._destroy());
  }

  _destroy() {
    if (this._closed) return;
    this._closed = true;
    this.readyState = 3; // CLOSED
    try { this.socket.destroy(); } catch (e) {}
    this.emit('close');
  }

  _onData(chunk) {
    this._buffer = this._buffer.length ? Buffer.concat([this._buffer, chunk]) : chunk;
    while (this._buffer.length >= 2) {
      if (!this._parseFrame()) break;
    }
  }

  _parseFrame() {
    const buf = this._buffer;
    const b0 = buf[0];
    const b1 = buf[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (buf.length < 4) return false;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return false;
      const big = buf.readBigUInt64BE(2);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) return false;
      len = Number(big);
      offset = 10;
    }

    if (masked) {
      if (buf.length < offset + 4) return false;
      this._maskKey = buf.subarray(offset, offset + 4);
      offset += 4;
    }

    if (buf.length < offset + len) return false;

    let payload = Buffer.from(buf.subarray(offset, offset + len));
    if (masked) {
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= this._maskKey[i % 4];
      }
    }
    this._buffer = buf.subarray(offset + len);

    if (opcode === 0x8) { // close
      this._sendFrame(0x8, payload.subarray(0, 2));
      this.readyState = 2;
      this.socket.end();
      this._destroy();
      return true;
    }
    if (opcode === 0x9) { // ping
      this._sendFrame(0xA, payload);
      return true;
    }
    if (opcode === 0xA) return true; // pong

    if (!fin) {
      if (opcode !== 0) this._fragOpcode = opcode;
      this._fragments.push(payload);
      return true;
    }
    if (opcode === 0) {
      this._fragments.push(payload);
      payload = Buffer.concat(this._fragments);
      this._fragments = [];
      this._fragOpcode = null;
    } else if (this._fragments.length) {
      this._fragments.push(payload);
      payload = Buffer.concat(this._fragments);
      this._fragments = [];
      this._fragOpcode = null;
    }

    this.emit('message', payload.toString('utf8'));
    return true;
  }

  _sendFrame(opcode, payload) {
    if (this._closed || this.readyState !== 1) return;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
    const len = data.length;
    let header;
    if (len < 126) {
      header = Buffer.alloc(2);
      header[1] = len;
    } else if (len < 65536) {
      header = Buffer.alloc(4);
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }
    header[0] = 0x80 | opcode;
    try {
      this.socket.write(Buffer.concat([header, data]));
    } catch (e) {
      this._destroy();
    }
  }

  send(data) {
    this._sendFrame(0x1, data);
  }

  ping() {
    if (this.readyState === 1) this._sendFrame(0x9, Buffer.alloc(0));
  }
}

class MiniWebSocketServer extends EventEmitter {
  constructor({ server }) {
    super();
    server.on('upgrade', (req, socket, head) => {
      if (!req.headers.upgrade || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
        socket.destroy();
        return;
      }
      const key = req.headers['sec-websocket-key'];
      if (!key) {
        socket.destroy();
        return;
      }
      const accept = crypto
        .createHash('sha1')
        .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');

      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
      );

      const ws = new MiniWebSocket(socket);
      if (head && head.length) ws._onData(head);
      this.emit('connection', ws, req);
    });
  }
}


const server = http.createServer((req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); return res.end('Bad request'); }
  if (urlPath === '/') urlPath = '/index.html';

  const safePath = path.posix.normalize(urlPath).replace(/^[/\\]+/, '');
  let filePath = path.resolve(PUBLIC_DIR, '.' + path.sep + safePath);

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA 兜底
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (err2, html) => {
        if (err2) {
          res.writeHead(500);
          res.end('Internal error');
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
        }
      });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

const wss = new MiniWebSocketServer({ server });

/* ---------------- 数据结构 ---------------- */
const GAME_TYPES = ['go', 'xiangqi', 'gomoku_folk', 'gomoku_standard'];
const GAME_NAMES = {
  go: '围棋',
  xiangqi: '象棋',
  gomoku_folk: '五子棋（民间玩法）',
  gomoku_standard: '五子棋（国际标准）',
};

// roomId -> room
const rooms = new Map();
// socket -> player
const players = new Map();

let playerSeq = 1;

function uid() {
  return 'p' + (playerSeq++);
}

function roomId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

function broadcastRoom(room) {
  for (const p of room.players) {
    const player = players.get(p.ws);
    if (player && player.roomId === room.id) {
      send(p.ws, { type: 'room', room: publicRoom(room, player.id) });
    }
  }
}

function publicRoom(room, viewerId) {
  const view = {
    id: room.id,
    status: room.status,
    gameType: room.gameType,
    creatorId: room.creatorId,
      mode: room.mode || 'multi',
    turn: room.turn,
    moves: room.moves,
    pending: room.pending,
    lastState: room.lastState,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      side: p.side,
      ready: p.ready,
      online: p.ws.readyState === 1,
    })),
    you: viewerId,
    createdAt: room.createdAt,
  };
  return view;
}

function publicPlayer(p) {
  return { id: p.id, name: p.name };
}

function getPlayer(ws) {
  return players.get(ws) || null;
}

function getRoomOfPlayer(player) {
  if (!player || !player.roomId) return null;
  return rooms.get(player.roomId) || null;
}

function otherPlayer(room, player) {
  return room.players.find((p) => p.id !== player.id);
}

function roomEmpty(room) {
  return room.players.length === 0;
}

function cleanupRoom(room) {
  if (roomEmpty(room)) {
    rooms.delete(room.id);
  }
}

function pingAll() {
  for (const p of players.values()) {
    if (p.ws.readyState === 1) {
      p.ws.ping();
    }
  }
}

/* ---------------- 弹窗确认（创建 Pending） ---------------- */
function createPending(room, action, gameType, meta = {}) {
  if (room.pending) {
    const p = room.players.find((pl) => pl.id === meta.from);
    if (p) send(p.ws, { type: 'notice', message: '已有待回应的请求，请稍候' });
    return;
  }
  const requireBoth = room.players.length === 2 && room.status === 'playing';
  room.pending = {
    id: crypto.randomBytes(4).toString('hex'),
    action, // switch_game | request_draw | resign | undo | restart | game_select
    from: meta.from || null,
    gameType: gameType || room.gameType,
    meta,
    respond: requireBoth ? 2 : 1,
    responded: meta.from ? [meta.from] : [],
  };
  broadcastRoom(room);
}

function respondPending(ws, accept) {
  const player = getPlayer(ws);
  if (!player) return;
  const room = getRoomOfPlayer(player);
  if (!room || !room.pending) return;
  const p = room.pending;

  if (p.from !== player.id && !p.responded.includes(player.id)) {
    p.responded.push(player.id);
  }

  if (accept === false) {
    room.pending = null;
  const fromP = room.players.find((pl) => pl.id === p.from);
  if (fromP) send(fromP.ws, { type: 'notice', message: '对方拒绝了请求' });
    broadcastRoom(room);
    return;
  }

  if (p.responded.length >= p.respond) {
    // 全部同意 -> 执行
    const action = p.action;
    room.pending = null;
    switch (action) {
      case 'switch_game': {
        startGame(room, p.gameType);
        break;
      }
      case 'request_draw': {
        room.status = 'finished';
        room.result = '和棋';
        room.winner = null;
        broadcastRoom(room);
        break;
      }
      case 'resign': {
        const winner = otherId(room, p.from);
        room.status = 'finished';
        room.result = '认输';
        room.winner = winner;
        broadcastRoom(room);
        break;
      }
      case 'undo': {
        undoMove(room);
        break;
      }
      case 'restart': {
        restartGame(room, room.gameType);
        break;
      }
      case 'game_select': {
        // 双人选择游戏，先到先得
        startGame(room, p.gameType);
        break;
      }
      default:
        break;
    }
  } else {
    broadcastRoom(room);
  }
}

function otherId(room, id) {
  return room.players.find((pl) => pl.id !== id)?.id || null;
}

function undoMove(room) {
  if (room.moves.length > 0) {
    const last = room.moves.pop();
    if (room.lastState) {
      room.lastState = { board: room.historyBoards?.[room.moves.length] || null };
    }
    // 轮到上一步的落子方
    room.turn = last.side;
    room.historyBoards = (room.historyBoards || []).slice(0, room.moves.length);
    broadcastRoom(room);
  }
}
function undoToPlayer(room) {
  // 单机 AI 模式：撤销到最后一次玩家落子（黑方），让玩家继续执黑行棋
  let last = null;
  while (room.moves.length > 0) {
    last = room.moves[room.moves.length - 1];
    room.moves.pop();
    if (last.side === 'black') break;
  }
  room.turn = 'black';
  room.pending = null;
  room.historyBoards = (room.historyBoards || []).slice(0, room.moves.length);
  broadcastRoom(room);
}



function startGame(room, gameType) {
  if (!GAME_TYPES.includes(gameType)) return;
  room.gameType = gameType;
  room.status = 'playing';
  room.moves = [];
  room.historyBoards = [];
  room.pending = null;
  room.winner = null;
  room.result = null;
  // 规则：黑先（围棋黑先 / 象棋红先）
  const black = room.players.find((p) => p.side === 'black');
  room.turn = black ? 'black' : room.players[0]?.side || 'black';
  broadcastRoom(room);
}

function restartGame(room, gameType) {
  startGame(room, gameType || room.gameType);
}

/* ---------------- 匹配 ---------------- */
function findMatch(player) {
  // 找最短队列
  let best = null;
  for (const [key, q] of matchQueues) {
    if (q.length > 0 && q[0].id !== player.id) {
      if (key !== 'quick') continue;
      if (!best || q[0].matchedAt < best.player.matchedAt) {
        best = { key, player: q[0] };
      }
    }
  }
  if (best) {
    const opponent = best.player;
    matchQueues[best.key] = matchQueues[best.key].filter((p) => p.id !== opponent.id);
    return opponent;
  }
  return null;
}

const matchQueues = {
  quick: [],
};

/* ---------------- 消息处理 ---------------- */
wss.on('connection', (ws) => {
  const player = {
    id: uid(),
    name: '棋友' + playerSeq,
    ws,
    roomId: null,
  };
  players.set(ws, player);

  send(ws, { type: 'welcome', player: publicPlayer(player) });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    handleMessage(ws, player, msg);
  });

  ws.on('close', () => {
    const room = getRoomOfPlayer(player);
    if (room) {
      room.players = room.players.filter((p) => p.id !== player.id);
      if (room.creatorId === player.id && room.players.length > 0) {
        room.creatorId = room.players[0].id;
      }
      if (room.status === 'playing') {
        room.status = 'finished';
        room.result = '对手离开';
        room.winner = otherId(room, player.id);
      }
      broadcastRoom(room);
      cleanupRoom(room);
    }
    // 从匹配队列移除
    for (const key of Object.keys(matchQueues)) {
      matchQueues[key] = matchQueues[key].filter((p) => p.id !== player.id);
    }
    players.delete(ws);
  });
});

function handleMessage(ws, player, msg) {
  switch (msg.type) {
    case 'set_name': {
      player.name = String(msg.name || '').slice(0, 12) || player.name;
      send(ws, { type: 'me', player: publicPlayer(player) });
      const room = getRoomOfPlayer(player);
      if (room) broadcastRoom(room);
      break;
    }
    case 'create_room': {
      createRoom(player, msg.mode === 'single' ? 'single' : 'multi');
      break;
    }
    case 'join_room': {
      joinRoom(player, String(msg.roomId || '').toUpperCase());
      break;
    }
    case 'leave_room': {
      leaveRoom(player);
      break;
    }
    case 'quick_match': {
      quickMatch(player);
      break;
    }
    case 'cancel_match': {
      for (const key of Object.keys(matchQueues)) {
        matchQueues[key] = matchQueues[key].filter((p) => p.id !== player.id);
      }
      send(ws, { type: 'match_cancelled' });
      break;
    }
    case 'game_select': {
      // 单人模式：直接开始；双人：需对方同意
      const room = getRoomOfPlayer(player);
      if (!room) return;
      const gt = msg.gameType;
      if (!GAME_TYPES.includes(gt)) return;
      if (room.players.length === 1) {
        // 单机 AI 模式：直接开局（AI 由前端本地驱动）
        startGame(room, gt);
      } else {
        createPending(room, 'game_select', gt, { from: player.id });
      }
      break;
    }
    case 'pending_respond': {
      respondPending(ws, !!msg.accept);
      break;
    }
    case 'move': {
      handleMove(player, msg);
      break;
    }
    case 'request_draw': {
      const room = getRoomOfPlayer(player);
      if (!room || room.status !== 'playing') return;
      if (room.players.length === 1) {
        room.status = 'finished';
        room.result = '和棋';
        broadcastRoom(room);
      } else {
        createPending(room, 'request_draw', room.gameType, { from: player.id });
      }
      break;
    }
    case 'resign': {
      const room = getRoomOfPlayer(player);
      if (!room || room.status !== 'playing') return;
      if (room.players.length === 1) {
        room.status = 'finished';
        room.result = '认输';
        room.winner = null;
        broadcastRoom(room);
      } else {
        createPending(room, 'resign', room.gameType, { from: player.id });
      }
      break;
    }
    case 'undo': {
      const room = getRoomOfPlayer(player);
      if (!room || room.status !== 'playing' || room.moves.length === 0) return;
      if (room.players.length === 1) {
        undoMove(room);
      } else {
        createPending(room, 'undo', room.gameType, { from: player.id });
      }
      break;
    }
    case 'restart': {
      const room = getRoomOfPlayer(player);
      if (!room) return;
      if (room.players.length === 1) {
        restartGame(room, room.gameType);
      } else {
        createPending(room, 'restart', room.gameType, { from: player.id });
      }
      break;
    }
    case 'switch_game': {
      const room = getRoomOfPlayer(player);
      if (!room || room.players.length === 1) {
        if (room && GAME_TYPES.includes(msg.gameType)) startGame(room, msg.gameType);
        return;
      }
      if (!GAME_TYPES.includes(msg.gameType)) return;
      createPending(room, 'switch_game', msg.gameType, { from: player.id });
      break;
    }
    default:
      break;
  }
}

function createRoom(player, mode) {
  if (player.roomId) return;
  const room = {
    id: roomId(),
    creatorId: player.id,
      mode: mode || 'multi',
    status: 'waiting',
    gameType: null,
    players: [{ ...playerPublic(player), side: 'black', ready: true, ws: player.ws }],
    turn: 'black',
    moves: [],
    historyBoards: [],
    pending: null,
    lastState: null,
    winner: null,
    result: null,
    createdAt: Date.now(),
  };
  rooms.set(room.id, room);
  player.roomId = room.id;
  broadcastRoom(room);
}

function playerPublic(player) {
  return { id: player.id, name: player.name };
}

function joinRoom(player, id) {
  if (player.roomId) {
    send(player.ws, { type: 'error', message: '你已在房间中' });
    return;
  }
  const room = rooms.get(id);
  if (!room) {
    send(player.ws, { type: 'error', message: '房间不存在' });
    return;
  }
  if (room.mode === 'single') {
    send(player.ws, { type: 'error', message: '单机房间不可加入' });
    return;
  }
  if (room.status !== 'waiting') {
    send(player.ws, { type: 'error', message: '房间已开局或已满' });
    return;
  }
  if (room.players.length >= 2) {
    send(player.ws, { type: 'error', message: '房间已满' });
    return;
  }
  room.players.push({ ...playerPublic(player), side: 'white', ready: true, ws: player.ws });
  player.roomId = room.id;
  room.status = 'playing';
  // 双方组局成功后，进入游戏选择界面
  room.waitingForSelect = true;
  broadcastRoom(room);
}

function leaveRoom(player) {
  const room = getRoomOfPlayer(player);
  if (!room) return;
  room.players = room.players.filter((p) => p.id !== player.id);
  player.roomId = null;
  if (room.creatorId === player.id && room.players.length > 0) {
    room.creatorId = room.players[0].id;
  }
  if (room.players.length === 1) {
    room.status = 'waiting';
    room.gameType = null;
    room.moves = [];
    room.pending = null;
    room.waitingForSelect = false;
      room.winner = null;
      room.result = null;
      room.turn = 'black';
      room.historyBoards = [];
  }
  broadcastRoom(room);
  cleanupRoom(room);
  send(player.ws, { type: 'left_room' });
}

function quickMatch(player) {
  if (player.roomId) {
    send(player.ws, { type: 'error', message: '你已在房间中' });
    return;
  }
  matchQueues.quick = matchQueues.quick.filter((p) => p.id !== player.id);
  const opponent = matchQueues.quick.shift();
  if (opponent) {
    // 创建房间
    const room = {
      id: roomId(),
      creatorId: opponent.id,
      status: 'playing',
      gameType: null,
      players: [
        { ...playerPublic(opponent), side: 'black', ready: true, ws: opponent.ws },
        { ...playerPublic(player), side: 'white', ready: true, ws: player.ws },
      ],
      turn: 'black',
      moves: [],
      historyBoards: [],
      pending: null,
      lastState: null,
      winner: null,
      result: null,
      waitingForSelect: true,
      createdAt: Date.now(),
    };
    rooms.set(room.id, room);
    opponent.roomId = room.id;
    player.roomId = room.id;
    broadcastRoom(room);
  } else {
    matchQueues.quick.push({ ...playerPublic(player), ws: player.ws, id: player.id, matchedAt: Date.now() });
    send(player.ws, { type: 'matching', queue: 'quick', queueLength: matchQueues.quick.length });
  }
}

/* ---------------- 移动落子 ---------------- */
function handleMove(player, msg) {
  const room = getRoomOfPlayer(player);
  if (!room || room.status !== 'playing') return;
  if (!room.gameType) return;
  if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y)) return;
  const me = room.players.find((p) => p.id === player.id);
  if (!me) return;

  let moveSide;
  if (room.players.length === 1) {
    // 单机模式：玩家替双方落子，落子方为当前行棋方
    moveSide = room.turn;
  } else {
    if (me.side !== room.turn) {
      send(player.ws, { type: 'error', message: '还没轮到你落子' });
      return;
    }
    moveSide = me.side;
  }

  const move = {
    player: player.id,
    side: moveSide,
    x: msg.x,
    y: msg.y,
    from: msg.from || null,     // 象棋移动起点 {row, col}
    ts: Date.now(),
  };
  room.moves.push(move);
  room.turn = moveSide === 'black' ? 'white' : 'black';
  broadcastRoom(room);
}

/* ---------------- 心跳 ---------------- */
setInterval(() => {
  pingAll();
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`♟ 水墨棋院已启动: http://${HOST}:${PORT}`);
});
