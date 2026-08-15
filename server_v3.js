const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
};

/* ================= 极简 WebSocket 服务端（零依赖） ================= */
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

let onClientConnected = null;

function registerWS(server) {
  server.on('upgrade', (req, socket) => {
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (upgrade !== 'websocket') { socket.destroy(); return; }
    const key = String(req.headers['sec-websocket-key'] || '');
    if (!key) { socket.destroy(); return; }

    const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n' +
      '\r\n'
    );

    const ws = {
      readyState: 1,
      socket,
      onmessage: null,
      onclose: null,
      onopen: null,
      ping() {
        if (ws.readyState === 1) {
          try { socket.write(Buffer.from([0x89, 0x00])); } catch (e) { cleanup(); }
        }
      },
      send(data) {
        if (ws.readyState !== 1) return;
        const payload = Buffer.from(String(data), 'utf8');
        let header;
        if (payload.length < 126) {
          header = Buffer.from([0x81, payload.length]);
        } else if (payload.length < 65536) {
          header = Buffer.alloc(4);
          header[0] = 0x81; header[1] = 126;
          header.writeUInt16BE(payload.length, 2);
        } else {
          header = Buffer.alloc(10);
          header[0] = 0x81; header[1] = 127;
          header.writeBigUInt64BE(BigInt(payload.length), 2);
        }
        try { socket.write(Buffer.concat([header, payload])); } catch (e) { cleanup(); }
      },
    };

    const cleanup = () => {
      if (ws.readyState === 3) return;
      ws.readyState = 3;
      try { socket.destroy(); } catch (e) {}
      if (ws.onclose) ws.onclose();
    };

    socket.on('data', (chunk) => {
      let buf = ws._parseBuf ? Buffer.concat([ws._parseBuf, chunk]) : chunk;
      while (buf.length >= 2) {
        const b0 = buf[0], b1 = buf[1];
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) break;
          len = buf.readUInt16BE(2); off = 4;
        } else if (len === 127) {
          if (buf.length < 10) break;
          len = Number(buf.readBigUInt64BE(2)); off = 10;
        }
        let maskKey = null;
        if (masked) {
          if (buf.length < off + 4) break;
          maskKey = buf.subarray(off, off + 4); off += 4;
        }
        if (buf.length < off + len) break;

        let payload = buf.subarray(off, off + len);
        if (maskKey) {
          payload = Buffer.from(payload);
          for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
        }
        buf = buf.subarray(off + len);

        if (opcode === 0x8) {
          cleanup();
          return;
        }
        if (opcode === 0x8 || opcode === 0x9 || opcode === 0xA) continue;
        // opcode 0 文本消息
        if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
          if (ws.onmessage) ws.onmessage(payload.toString('utf8'));
        }
      }
      ws._parseBuf = buf;
    });
    socket.on('error', cleanup);
    socket.on('close', cleanup);
    socket.on('end', cleanup);

    if (onClientConnected) onClientConnected(ws);
    if (ws.onopen) ws.onopen();
  });
}

/* ================= HTTP 静态文件服务 ================= */
const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400);
    return res.end('Bad request');
  }
  if (urlPath === '/') urlPath = '/index.html';

  const safePath = path.posix.normalize(urlPath).replace(/^[/\\]+/, '');
  const filePath = path.resolve(PUBLIC_DIR, '.' + path.sep + safePath);

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
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

registerWS(server);

/* ================= 房间/玩家状态 ================= */
const rooms = new Map();
const players = new Map();
const matchQueues = { quick: [] };
let playerSeq = 1;

const GAME_TYPES = ['go', 'xiangqi', 'gomoku_folk', 'gomoku_standard'];

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function publicPlayer(p) { return { id: p.id, name: p.name }; }

function publicRoom(room, viewerId) {
  return {
    id: room.id,
    status: room.status,
    gameType: room.gameType,
    creatorId: room.creatorId,
    mode: room.mode || 'multi',
    turn: room.turn,
    moves: room.moves,
    pending: room.pending,
    winner: room.winner,
    result: room.result,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      side: p.side,
      ready: p.ready,
      online: p.ws && p.ws.readyState === 1,
    })),
    you: viewerId,
    createdAt: room.createdAt,
  };
}

function broadcastRoom(room) {
  for (const p of room.players) {
    const player = players.get(p.ws);
    if (player && player.roomId === room.id) {
      send(p.ws, { type: 'room', room: publicRoom(room, player.id) });
    }
  }
}

function getRoomOfPlayer(player) {
  if (!player || !player.roomId) return null;
  return rooms.get(player.roomId) || null;
}

function createRoom(player, mode) {
  if (player.roomId) return;
  const room = {
    id: crypto.randomBytes(3).toString('hex').toUpperCase(),
    creatorId: player.id,
    mode: mode || 'multi',
    status: 'waiting',
    gameType: null,
    turn: 'black',
    moves: [],
    pending: null,
    winner: null,
    result: null,
    players: [{ ...publicPlayer(player), side: 'black', ready: true, ws: player.ws }],
    createdAt: Date.now(),
  };
  rooms.set(room.id, room);
  player.roomId = room.id;
  broadcastRoom(room);
}

function joinRoom(player, id) {
  if (player.roomId) {
    send(player.ws, { type: 'error', message: '你已在房间中' });
    return;
  }
  const room = rooms.get(id);
  if (!room) return send(player.ws, { type: 'error', message: '房间不存在' });
  if (room.mode === 'single') return send(player.ws, { type: 'error', message: '单机房间不可加入' });
  if (room.status !== 'waiting') return send(player.ws, { type: 'error', message: '房间已开局或已满' });
  if (room.players.length >= 2) return send(player.ws, { type: 'error', message: '房间已满' });

  room.players.push({ ...publicPlayer(player), side: 'white', ready: true, ws: player.ws });
  player.roomId = room.id;
  room.status = 'playing';
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
    room.winner = null;
    room.result = null;
    room.turn = 'black';
  }
  broadcastRoom(room);
  if (room.players.length === 0) rooms.delete(room.id);
  send(player.ws, { type: 'left_room' });
}

function undoMove(room) {
  if (room.moves.length > 0) {
    const last = room.moves.pop();
    room.turn = last.side;
    broadcastRoom(room);
  }
}

function startGame(room, gameType) {
  if (!GAME_TYPES.includes(gameType)) return;
  room.gameType = gameType;
  room.status = 'playing';
  room.moves = [];
  room.pending = null;
  room.winner = null;
  room.result = null;
  room.turn = 'black';
  broadcastRoom(room);
}

function createPending(room, action, gameType, meta = {}) {
  if (room.pending) {
    const p = room.players.find((pl) => pl.id === meta.from);
    if (p) send(p.ws, { type: 'notice', message: '已有待回应的请求，请稍候' });
    return;
  }
  const requireBoth = room.players.length === 2 && room.status === 'playing';
  room.pending = {
    id: crypto.randomBytes(4).toString('hex'),
    action,
    from: meta.from || null,
    gameType: gameType || room.gameType,
    respond: requireBoth ? 2 : 1,
    responded: meta.from ? [meta.from] : [],
  };
  broadcastRoom(room);
}

function respondPending(ws, accept) {
  const player = players.get(ws) || null;
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
    room.pending = null;
    switch (p.action) {
      case 'switch_game':
      case 'game_select':
        startGame(room, p.gameType);
        break;
      case 'request_draw':
        room.status = 'finished';
        room.result = '和棋';
        room.winner = null;
        broadcastRoom(room);
        break;
      case 'resign': {
        const winner = room.players.find((pl) => pl.id !== p.from)?.id || null;
        room.status = 'finished';
        room.result = '认输';
        room.winner = winner;
        broadcastRoom(room);
        break;
      }
      case 'undo':
        undoMove(room);
        break;
      case 'restart':
        startGame(room, room.gameType);
        break;
    }
  } else {
    broadcastRoom(room);
  }
}

function handleMove(player, msg) {
  const room = getRoomOfPlayer(player);
  if (!room || room.status !== 'playing' || !room.gameType) return;
  if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y)) return;
  const me = room.players.find((p) => p.id === player.id);
  if (!me) return;

  let moveSide;
  if (room.players.length === 1) {
    moveSide = room.turn;
  } else {
    if (me.side !== room.turn) {
      send(player.ws, { type: 'error', message: '还没轮到你落子' });
      return;
    }
    moveSide = me.side;
  }

  room.moves.push({
    player: player.id,
    side: moveSide,
    x: msg.x,
    y: msg.y,
    from: msg.from || null,
    ts: Date.now(),
  });
  room.turn = moveSide === 'black' ? 'white' : 'black';
  broadcastRoom(room);
}

function quickMatch(player) {
  if (player.roomId) {
    send(player.ws, { type: 'error', message: '你已在房间中' });
    return;
  }
  matchQueues.quick = matchQueues.quick.filter((p) => p.id !== player.id);
  const opponent = matchQueues.quick.shift();
  // opponentPlayer 在下方 opponent 存在时初始化，避免空队列崩溃
  if (opponent) {
    const opponentPlayer = players.get(opponent.ws) || opponent;
    const room = {
      id: crypto.randomBytes(3).toString('hex').toUpperCase(),
      creatorId: opponent.id,
      mode: 'multi',
      status: 'playing',
      gameType: null,
      turn: 'black',
      moves: [],
      pending: null,
      winner: null,
      result: null,
      players: [
        { ...publicPlayer(opponent), side: 'black', ready: true, ws: opponent.ws },
        { ...publicPlayer(player), side: 'white', ready: true, ws: player.ws },
      ],
      waitingForSelect: true,
      createdAt: Date.now(),
    };
    rooms.set(room.id, room);
    opponentPlayer.roomId = room.id;
    player.roomId = room.id;
    broadcastRoom(room);
  } else {
    matchQueues.quick.push({ ...publicPlayer(player), ws: player.ws, id: player.id, matchedAt: Date.now() });
    send(player.ws, { type: 'matching', queue: 'quick', queueLength: matchQueues.quick.length });
  }
}

function handleMessage(ws, player, msg) {
  switch (msg.type) {
    case 'set_name':
      player.name = String(msg.name || '').slice(0, 12) || player.name;
      send(ws, { type: 'me', player: publicPlayer(player) });
      if (getRoomOfPlayer(player)) broadcastRoom(getRoomOfPlayer(player));
      break;
    case 'create_room':
      createRoom(player, msg.mode === 'single' ? 'single' : 'multi');
      break;
    case 'join_room':
      joinRoom(player, String(msg.roomId || '').toUpperCase());
      break;
    case 'leave_room':
      leaveRoom(player);
      break;
    case 'quick_match':
      quickMatch(player);
      break;
    case 'cancel_match':
      for (const key of Object.keys(matchQueues)) {
        matchQueues[key] = matchQueues[key].filter((p) => p.id !== player.id);
      }
      send(ws, { type: 'match_cancelled' });
      break;
    case 'game_select': {
      const room = getRoomOfPlayer(player);
      if (!room) return;
      const gt = msg.gameType;
      if (!GAME_TYPES.includes(gt)) return;
      if (room.players.length === 1) startGame(room, gt);
      else createPending(room, 'game_select', gt, { from: player.id });
      break;
    }
    case 'pending_respond':
      respondPending(ws, !!msg.accept);
      break;
    case 'move':
      handleMove(player, msg);
      break;
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
      if (room.players.length === 1) undoMove(room);
      else createPending(room, 'undo', room.gameType, { from: player.id });
      break;
    }
    case 'restart': {
      const room = getRoomOfPlayer(player);
      if (!room) return;
      if (room.players.length === 1) startGame(room, room.gameType);
      else createPending(room, 'restart', room.gameType, { from: player.id });
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
  }
}

onClientConnected = (ws) => {
  const player = {
    id: 'p' + (playerSeq++),
    name: '棋友' + playerSeq,
    ws,
    roomId: null,
  };
  players.set(ws, player);
  send(ws, { type: 'welcome', player: publicPlayer(player) });

  ws.onmessage = (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      return;
    }
    handleMessage(player.ws, player, msg);
  };

  ws.onclose = () => {
    const room = getRoomOfPlayer(player);
    if (room) {
      room.players = room.players.filter((p) => p.id !== player.id);
      if (room.creatorId === player.id && room.players.length > 0) {
        room.creatorId = room.players[0].id;
      }
      if (room.status === 'playing') {
        room.status = 'finished';
        room.result = '对手离开';
        room.winner = room.players.find((p) => p.id !== player.id)?.id || null;
      }
      broadcastRoom(room);
      if (room.players.length === 0) rooms.delete(room.id);
    }
    players.delete(ws);
    for (const key of Object.keys(matchQueues)) {
      matchQueues[key] = matchQueues[key].filter((p) => p.id !== player.id);
    }
  };
};

/* ================= 心跳保活 ================= */
setInterval(() => {
  for (const p of players.values()) {
    if (p.ws && p.ws.readyState === 1) p.ws.ping();
  }
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`♟ 水墨棋院已启动: http://${HOST}:${PORT}`);
});
