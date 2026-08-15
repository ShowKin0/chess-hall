/* ============ 水墨棋院 · 主逻辑（v3 完整版） ============ */
const GAME_LIST = [
  { id: 'go', name: '围棋', short: '围棋', desc: '黑白博弈，围地争先' },
  { id: 'xiangqi', name: '象棋', short: '象棋', desc: '楚河汉界，运筹帷幄' },
  { id: 'gomoku_folk', name: '五子棋（民间玩法）', short: '五子·民间', desc: '无禁手，先五为胜' },
  { id: 'gomoku_standard', name: '五子棋（国际标准）', short: '五子·标准', desc: '黑方禁手，规范连珠' },
];

const canvas = document.getElementById('board');

let me = null;
let room = null;
let currentGame = null;
let gameInstance = null;
let pendingModalShown = false;
let selectedPiece = null;
let gameOver = false;
let localWinner = null;
let aiLevel = 'medium';
let aiTimer = null;
let aiThinking = false;
let redrawQueued = false;

function gameById(id) { return GAME_LIST.find((g) => g.id === id); }

function ensureGameInstance(gameType) {
  if (!gameInstance || currentGame !== gameType) {
    switch (gameType) {
      case 'go': gameInstance = new GoGame(canvas); break;
      case 'xiangqi': gameInstance = new XiangqiGame(canvas); break;
      case 'gomoku_folk': gameInstance = new GomokuFolkGame(canvas); break;
      case 'gomoku_standard': gameInstance = new GomokuStandardGame(canvas); break;
      default: gameInstance = null;
    }
    currentGame = gameType;
    selectedPiece = null;
    if (gameInstance) gameInstance._bound = false;
  }
  return gameInstance;
}

/* ============ 初始化 ============ */
window.addEventListener('DOMContentLoaded', () => {
  renderGameSelectGrid();
  renderGameTabs();
  bindUI();
  connectWS();
  initResizeObserver();
  showView('hall');
});

function onWSOpen() { toast('已连入水墨棋院'); }

function onWSClose() {
  cancelAITimer();
  if (room) {
    toast('连接已断开，正在重连');
    room = null;
    selectedPiece = null;
  }
  showView('hall');
}

function onWSMessage(msg) {
  switch (msg.type) {
    case 'welcome':
    case 'me':
      me = msg.player;
      updateMeUI();
      break;
    case 'error':
      toast(msg.message || '出错');
      break;
    case 'notice':
      toast(msg.message || '提示');
      break;
    case 'matching':
      updateMatchUI(msg);
      break;
    case 'match_cancelled':
      showView('hall');
      break;
    case 'room':
      onRoomUpdate(msg.room);
      break;
    case 'left_room':
      cancelAITimer();
      room = null;
      selectedPiece = null;
      showView('hall');
      break;
    default:
      break;
  }
}

/* ============ UI 绑定 ============ */
function bindUI() {
  document.querySelectorAll('.menu-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'single') chooseDifficultyAndStartSingle();
      else if (action === 'join') showView('join');
      else if (action === 'create') sendMsg({ type: 'create_room' });
      else if (action === 'quick') {
        sendMsg({ type: 'quick_match' });
        showView('match');
      }
    });
  });

  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.back;
      if (target === 'hall') showView('hall');
      else if (target === 'leave-room') {
        if (room && room.status === 'playing') {
          confirmModal('离席', '对局尚未结束，确定离开吗？', () => sendMsg({ type: 'leave_room' }));
        } else {
          sendMsg({ type: 'leave_room' });
        }
      }
    });
  });

  $('#btn-join-room').addEventListener('click', () => {
    const val = $('#room-id').value.trim().toUpperCase();
    if (!val) return toast('请输入房间号');
    sendMsg({ type: 'join_room', roomId: val });
  });

  $('#room-id').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-join-room').click();
  });

  $('#btn-cancel-match').addEventListener('click', () => sendMsg({ type: 'cancel_match' }));
  $('#btn-switch').addEventListener('click', () => openSwitchMenu());

  canvas.addEventListener('click', (e) => {
    if (!gameInstance || gameOver) return;
    if (!room || room.status !== 'playing') return;
    const mySide = mySideMapping();
    const isSingle = room.players.length === 1;
    if (isSingle ? room.turn !== 'black' : (!mySide || room.turn !== mySide)) {
      toast('还没轮到你落子');
      return;
    }
    if (currentGame === 'xiangqi') handleXiangqiClick(e);
    else gameInstance.handleClick(e.clientX, e.clientY);
  });
}

function mySideMapping() {
  if (!me || !room) return null;
  const p = room.players.find((pl) => pl.id === me.id);
  return p ? p.side : null;
}

function currentTurnSide() {
  if (!room) return null;
  return room.players.length === 1 ? room.turn : mySideMapping();
}

function bindGameListeners() {
  if (!gameInstance || gameInstance._bound) return;
  gameInstance._bound = true;
  gameInstance.attachListener((row, col) => {
    if (!room || room.status !== 'playing' || gameOver) return;
    if (room.players.length === 1 && room.turn !== 'black') return;
    const side = room.players.length === 1 ? 'black' : currentTurnSide();
    if (!side) return;
    const state = gameInstance.state || gameInstance.buildState(room);
  // 占位说明（难度选择入口见 chooseDifficultyAndStartSingle）
    if (!gameInstance.isValidMove(state, row, col, side)) {
      toast('此处不能落子');
      return;
    }
    sendMsg({ type: 'move', x: row, y: col });
  });
}

/* ============ 单机 AI ============ */
function chooseDifficultyAndStartSingle() {
  if (room) return toast('请先离开当前房间');
  const levels = [
    { id: 'low', label: '低', desc: '轻松对弈，适合入门' },
    { id: 'medium', label: '中', desc: '攻守有度，旗鼓相当' },
    { id: 'high', label: '高', desc: '算路犀利，步步紧逼' },
    { id: 'extreme', label: '超难', desc: '巅峰手谈，绝少退让' },
  ];
  const actions = levels.map((l) => ({
    label: `${l.label} · ${l.desc}`,
    cls: 'btn-accept',
    onClick: () => {
      aiLevel = l.id;
      cancelAITimer();
      if (ws && ws.readyState === 1) sendMsg({ type: 'create_room', mode: 'single' });
      else toast('正在连接服务器，请稍候');
    },
  }));
  showModal('选择 AI 难度', '单机对弈，请君择席', actions);
}

function cancelAITimer() {
  if (aiTimer) {
    clearTimeout(aiTimer);
    aiTimer = null;
  }
  aiThinking = false;
}

function maybeTriggerAI() {
  cancelAITimer();
  if (!room || room.mode !== 'single') return;
  if (room.status !== 'playing' || !room.gameType || gameOver) return;
  if (room.turn !== 'white') return;
  if (!gameInstance || !window.InkAI) return;

  aiThinking = true;
  const ti = $('#turn-indicator');
  if (ti) ti.textContent = 'AI 思考中…';

  aiTimer = setTimeout(() => {
    aiTimer = null;
    if (!room || room.mode !== 'single' || room.status !== 'playing' || room.turn !== 'white' || gameOver) {
      aiThinking = false;
      return;
    }
    let state = gameInstance.buildState(room);
    gameInstance.state = state;
    try {
      const mv = window.InkAI.decide(gameInstance, state, aiLevel, 'white', room.gameType);
      if (!mv) {
        aiThinking = false;
        toast('AI 已无路可走');
        return;
      }
      if (gameInstance.isValidMove(state, mv.x, mv.y, 'white', mv.from)) {
        sendMsg({ type: 'move', x: mv.x, y: mv.y, from: mv.from || null });
      } else {
        aiThinking = false;
        toast('AI 走子异常，请点击重开');
      }
    } catch (e) {
      console.warn('[AI] decide error', e);
      aiThinking = false;
    }
  }, 360);
}

function aiLevelLabel() {
  const map = { low: '低', medium: '中', high: '高', extreme: '超难' };
  return map[aiLevel] || '中';
}

/* ============ 玩家信息 ============ */
function updateMeUI() {
  if (!me) return;
  $('#me-name').textContent = me.name;
}

/* ============ 房间 ============ */
function onRoomUpdate(r) {
  room = r;
  const hasGame = r.status === 'playing' && r.gameType;
  const selecting = (r.status === 'waiting') || (r.status === 'playing' && !r.gameType);

  if (hasGame || r.status === 'finished') {
    showView('game');
    renderGame();
  } else if (selecting) {
    showView('room');
    renderRoom();
  }
  handlePending(r);
  maybeTriggerAI();
}

function renderGameSelectGrid() {
  const grid = $('#game-select-grid');
  grid.innerHTML = '';
  GAME_LIST.forEach((g) => {
    const b = document.createElement('button');
    b.className = 'game-select-item';
    b.innerHTML = `<strong>${g.short}</strong><small>${g.desc}</small>`;
    b.addEventListener('click', () => {
      if (!room) return;
      sendMsg({ type: 'game_select', gameType: g.id });
      toast('已提出棋局选择：' + g.name);
    });
    grid.appendChild(b);
  });
}

function renderGameTabs() {
  const tabs = $('#game-tabs');
  tabs.innerHTML = '';
  GAME_LIST.forEach((g) => {
    const b = document.createElement('button');
    b.className = 'game-tab';
    b.dataset.game = g.id;
    b.textContent = g.short;
    b.addEventListener('click', () => {
      if (!room || room.gameType === g.id) return;
      openSwitchMenu(g.id);
    });
    tabs.appendChild(b);
  });
}

function openSwitchMenu(gameType) {
  if (!room) return;
  if (room.status !== 'playing') { toast('对局尚未开始'); return; }
  const target = gameType || currentGame;
  if (!target || room.gameType === target) return;
  sendMsg({ type: 'switch_game', gameType: target });
  toast('已请求切换棋局');
}

function renderRoom() {
  $('#room-id-tag').textContent = '房 ' + room.id;
  const black = room.players.find((p) => p.side === 'black');
  const white = room.players.find((p) => p.side === 'white');
  renderSeat($('#seat-black'), $('#status-black'), '黑方', black);
  renderSeat($('#seat-white'), $('#status-white'), '白方', white);

  if (room.mode === 'single' || room.players.length === 2) {
    $('#select-stage').classList.remove('hidden');
  } else {
    $('#select-stage').classList.add('hidden');
  }

  if (room.players.length === 2) {
    $('#room-tip').textContent = '请选择想要进行的棋局，对方同意后开局';
      $('#seat-white').classList.add('occupied');
  } else {
    $('#room-tip').textContent = room.mode === 'single'
      ? `单机模式 · AI 难度「${aiLevelLabel()}」：选择棋局开局`
      : `等待对手加入…（房 ${room.id}）`;
  }

  // 单机座位显示 AI
  if (room.mode === 'single') {
    $('#seat-white .seat-name').textContent = 'AI · ' + aiLevelLabel();
    $('#status-white').textContent = '执白 · 本地智能';
  }
}

function renderSeat(seatEl, statusEl, sideName, player) {
  const nameEl = seatEl.querySelector('.seat-name');
  if (nameEl) nameEl.textContent = sideName;
  if (player) {
    seatEl.classList.add('occupied');
    statusEl.textContent = player.name + (player.online ? '' : '（离线）');
  } else {
    seatEl.classList.remove('occupied');
    statusEl.textContent = '虚位以待';
  }
}

/* ============ 对局 ============ */
function renderGame() {
  if (!room) return;
  const game = gameById(room.gameType);
  if (!game) return;

  $('#game-name').textContent = game.name;
  document.querySelectorAll('.game-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.game === room.gameType);
  });

  ensureGameInstance(room.gameType);
  if (!gameInstance) return;
  bindGameListeners();

  resizeCanvas();
  gameInstance.render(room);

  updateStatusBar();
  updateToolbar();
  checkNaturalWin();
  updateResult();
}

function resizeCanvas() {
  if (!gameInstance) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const wrap = $('#board-wrap');
  const availW = wrap.clientWidth || 320;
  const availH = wrap.clientHeight || Math.max(260, window.innerHeight * 0.55);
  const side = Math.max(240, Math.min(availW - 6, availH - 6));
  canvas.style.width = Math.floor(side) + 'px';
  canvas.style.height = Math.floor(side) + 'px';
  canvas.width = Math.floor(side * dpr);
  canvas.height = Math.floor(side * dpr);
  gameInstance.dpr = dpr;
}

function scheduleGameRedraw() {
  if (redrawQueued || window.currentView !== 'game' || !room || !gameInstance) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    if (window.currentView !== 'game' || !room || !gameInstance) return;
    resizeCanvas();
    gameInstance.render(room);
    if (currentGame === 'xiangqi' && selectedPiece) gameInstance.drawSelected(selectedPiece);
  });
}

function initResizeObserver() {
  if (window.__boardRO) return;
  const wrap = $('#board-wrap');
  if (!wrap || typeof ResizeObserver === 'undefined') return;
  window.__boardRO = new ResizeObserver(() => scheduleGameRedraw());
  window.__boardRO.observe(wrap);
}

function updateStatusBar() {
  if (!room || !gameInstance) return;
  const black = room.players.find((p) => p.side === 'black');
  const white = room.players.find((p) => p.side === 'white');
  const xiangqi = currentGame === 'xiangqi';
  const blackLabel = xiangqi ? '红方' : '黑方';
  const whiteLabel = xiangqi ? '黑方' : '白方';

  if (room.mode === 'single') {
    $('#black-name').textContent = '玩家 · ' + blackLabel;
    $('#white-name').textContent = `AI（${whiteLabel}） · ${aiLevelLabel()}`;
  } else {
    $('#black-name').textContent = black ? black.name : blackLabel;
    $('#white-name').textContent = white ? white.name : whiteLabel;
  }

  if (room.turn === 'black') {
    $('#turn-indicator').textContent = blackLabel + '行棋';
    $('#status-black-bar').style.fontWeight = '700';
    $('#status-white-bar').style.fontWeight = '400';
  } else {
    $('#turn-indicator').textContent = (room.mode === 'single' ? 'AI · ' : '') + whiteLabel + '行棋';
    $('#status-black-bar').style.fontWeight = '400';
    $('#status-white-bar').style.fontWeight = '700';
  }

  const info = gameInstance.info || {};
  if (currentGame === 'go') {
    const bc = info.captures?.black || 0;
    const wc = info.captures?.white || 0;
    $('#black-info').textContent = '提子 ' + bc + ' · 领地 ' + (info.black || 0);
    $('#white-info').textContent = '领地 ' + (info.white || 0) + ' · 提子 ' + wc;
  } else {
    $('#black-info').textContent = '';
    $('#white-info').textContent = '';
  }

  // 象棋将军提示
  if (currentGame === 'xiangqi') {
    const checks = gameInstance.info?.checks;
    if (checks) {
      let extra = '';
      if (room.turn === 'black' && checks.black) extra = '（将军！）';
      if (room.turn === 'white' && checks.white) extra = '（将军！）';
      const cur = room.turn === 'black' ? blackLabel : whiteLabel;
      $('#turn-indicator').textContent = (room.mode === 'single' && room.turn === 'white' ? 'AI · ' : '') + cur + '行棋' + extra;
    }
  }
}

function updateToolbar() {
  const bar = $('#game-toolbar');
  bar.innerHTML = '';
  if (!room) return;
  const two = room.players.length === 2;

  addTool(bar, '悔棋', () => {
    if (room.moves.length === 0) return toast('尚无落子');
    if (two) {
      confirmModal('悔棋', '向对方提出悔棋请求？', () => sendMsg({ type: 'undo' }));
    } else {
      cancelAITimer();
      // 单机：先撤回 AI 一步，再撤回玩家一步
      sendMsg({ type: 'undo' });
      setTimeout(() => sendMsg({ type: 'undo' }), 30);
    }
  });

  addTool(bar, '认输', () => {
    if (two) {
      confirmModal('认输', '认输需对方同意。确定提交吗？', () => sendMsg({ type: 'resign' }));
    } else {
      sendMsg({ type: 'resign' });
    }
  });

  addTool(bar, '和棋', () => {
    if (two) {
      confirmModal('和棋', '向对方提出和棋请求？', () => sendMsg({ type: 'request_draw' }));
    } else {
      sendMsg({ type: 'request_draw' });
    }
  });

  addTool(bar, '重开', () => {
    cancelAITimer();
    if (two) {
      confirmModal('重新开局', '向对方提出重新开局请求？', () => sendMsg({ type: 'restart' }));
    } else {
      sendMsg({ type: 'restart' });
    }
  });
}

function addTool(bar, label, fn) {
  const b = document.createElement('button');
  b.className = 'tool-btn';
  b.textContent = label;
  b.addEventListener('click', fn);
  bar.appendChild(b);
}

function checkNaturalWin() {
  localWinner = null;
  if (!room || !gameInstance) return;
  if (currentGame === 'gomoku_folk' || currentGame === 'gomoku_standard') {
    localWinner = gameInstance.checkWin(gameInstance.state?.board || []);
  }
}

function localGameOver() { return !!localWinner; }

function updateResult() {
  const banner = $('#result-banner');
  if (room.status === 'finished' || localGameOver()) {
    gameOver = true;
    let title = '对局结束', desc = room.result || '';
    if (room.result === '和棋') { title = '和棋'; desc = '一局和棋，握手言和'; }
    else if (room.result === '认输') {
      title = room.mode === 'single' ? '你已认输' : '胜负已分';
      desc = room.mode === 'single' ? '此局告负，可再来一局' : '对方认输';
    }
    else if (room.result === '对手离开') { title = '对手离开'; desc = '对局结束'; }
    if (room.winner) {
      const wn = room.players.find((p) => p.id === room.winner);
      desc = (wn ? wn.name : '对方') + ' 获胜';
    }
    if (localWinner) {
      title = '胜负已分';
      const label = localWinner === 'black'
        ? (currentGame === 'xiangqi' ? '红方' : '黑方')
        : (currentGame === 'xiangqi' ? '黑方' : '白方');
      desc = room.mode === 'single'
        ? (localWinner === 'black' ? '你获胜了' : 'AI 获胜')
        : label + ' 连五取胜';
    }
    banner.innerHTML = `
      <div class="banner-inner">
        <h3>${title}</h3>
        <p>${desc}</p>
        <button class="btn-primary" onclick="sendMsg({type:'restart'})">再来一局</button>
        <button class="btn-ghost" style="margin-left:8px" onclick="sendMsg({type:'leave_room'});showView('hall')">返回大厅</button>
      </div>`;
    banner.classList.remove('hidden');
  } else {
    gameOver = false;
    localWinner = null;
    banner.classList.add('hidden');
  }
}

/* ============ 弹窗确认 ============ */
function handlePending(r) {
  if (!r.pending) {
    if (pendingModalShown) {
      hideModal();
      pendingModalShown = false;
    }
    return;
  }
  const p = r.pending;
  if (!me) return;
  const isFromMe = p.from === me.id;
  const needsMyResponse = !isFromMe && !p.responded.includes(me.id);

  if (needsMyResponse && !pendingModalShown) {
    pendingModalShown = true;
    const gameName = p.gameType ? (gameById(p.gameType)?.name || '棋局') : '棋局';
    const fromName = r.players.find((pl) => pl.id === p.from)?.name || '对手';
    let title, body;
    switch (p.action) {
      case 'switch_game':
      case 'game_select':
        title = '棋局邀请';
        body = `${fromName} 提议进行「${gameName}」，是否接受？`;
        break;
      case 'undo':
        title = '悔棋请求';
        body = `${fromName} 请求悔棋，是否同意？`;
        break;
      case 'resign':
        title = '认输确认';
        body = `${fromName} 提出认输，是否接受？`;
        break;
      case 'request_draw':
        title = '和棋请求';
        body = `${fromName} 请求和棋，是否同意？`;
        break;
      case 'restart':
        title = '重新开局';
        body = `${fromName} 请求重新开局，是否同意？`;
        break;
      default:
        title = '请求';
        body = `${fromName} 发起了一个请求`;
    }
    confirmModal(title, body, () => {
      pendingModalShown = false;
      sendMsg({ type: 'pending_respond', accept: true });
    }, () => {
      pendingModalShown = false;
      sendMsg({ type: 'pending_respond', accept: false });
    });
  } else if ((isFromMe || p.responded.includes(me.id)) && pendingModalShown) {
    pendingModalShown = false;
    hideModal();
  }
}

/* ============ 象棋交互 ============ */
function handleXiangqiClick(e) {
  if (!gameInstance || currentGame !== 'xiangqi') return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / gameInstance.dpr / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / gameInstance.dpr / rect.height);
  const pt = gameInstance.pointAt(x, y);
  if (!pt) return;

  const state = gameInstance.state || gameInstance.buildState(room);
  const board = state.board;
  const mySide = room.players.length === 1 ? 'black' : currentTurnSide();
  const clicked = board[pt.row]?.[pt.col];

  if (selectedPiece) {
    const movingPiece = board[selectedPiece.row]?.[selectedPiece.col];
    if (movingPiece && movingPiece[0] === mySide) {
      if (clicked && clicked[0] === mySide) {
        selectedPiece = { row: pt.row, col: pt.col };
        gameInstance.selected = selectedPiece;
        gameInstance.render(room);
        gameInstance.drawSelected(selectedPiece);
        return;
      }
      if (gameInstance.isValidMoveFull(board, pt.row, pt.col, mySide, selectedPiece)) {
        sendMsg({ type: 'move', x: pt.row, y: pt.col, from: { row: selectedPiece.row, col: selectedPiece.col } });
        selectedPiece = null;
        gameInstance.selected = null;
        return;
      } else {
        toast('不符合走法');
        selectedPiece = null;
        gameInstance.selected = null;
        gameInstance.render(room);
        return;
      }
    }
    selectedPiece = null;
    gameInstance.selected = null;
  }

  if (clicked && clicked[0] === mySide) {
    selectedPiece = { row: pt.row, col: pt.col };
    gameInstance.selected = selectedPiece;
    gameInstance.render(room);
    gameInstance.drawSelected(selectedPiece);
  }
}

/* ============ 视图 ============ */
function onViewShown(name) {
  if (name === 'game' && room && gameInstance) {
    setTimeout(() => scheduleGameRedraw(), 30);
  }
}

function updateMatchUI(msg) {
  $('#match-hint').textContent = `等待对手中… 当前队列 ${msg.queueLength || 1} 人`;
}

window.addEventListener('resize', () => scheduleGameRedraw());

window.sendMsg = sendMsg;
window.showView = showView;
