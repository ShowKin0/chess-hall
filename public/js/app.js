/* ============ app.js 主逻辑 ============ */
const GAME_LIST = [
  { id: 'go', name: '围棋', short: '围棋', desc: '黑白博弈，围地争先' },
  { id: 'xiangqi', name: '象棋', short: '象棋', desc: '楚河汉界，运筹帷幄' },
  { id: 'gomoku_folk', name: '五子棋（民间玩法）', short: '五子·民间', desc: '无禁手，先五为胜' },
  { id: 'gomoku_standard', name: '五子棋（国际标准）', short: '五子·标准', desc: '黑方禁手，规范连珠' },
];

let me = null;
let room = null;
let currentGame = null;
let gameInstance = null;
let pendingModalShown = false;
let selectedPiece = null; // 象棋选子 {row, col}
let gameOver = false;

/* -------- 游戏实例 -------- */
const canvas = document.getElementById('board');

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
  }
  return gameInstance;
}

function gameById(id) {
  return GAME_LIST.find((g) => g.id === id);
}

/* ============ 初始化 ============ */
window.addEventListener('DOMContentLoaded', () => {
  renderGameSelectGrid();
  renderGameTabs();
  bindUI();
  connectWS();
  onViewShown('hall');
});

function onWSOpen() {
  if (window.currentView === 'match') {
    // 保持
  }
  toast('已连入水墨棋院');
}

function onWSMessage(msg) {
  switch (msg.type) {
    case 'welcome':
      me = msg.player;
      updateMeUI();
      break;
    case 'me':
      me = msg.player;
      updateMeUI();
      break;
    case 'error':
      toast(msg.message || '出错');
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
      room = null;
      showView('hall');
      break;
    case 'game_start':
      break;
    default:
      break;
  }
}

/* ============ UI 绑定 ============ */
function bindUI() {
  // 大厅菜单
  document.querySelectorAll('.menu-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'single') {
        sendMsg({ type: 'create_room' });
      } else if (action === 'join') {
        showView('join');
      } else if (action === 'create') {
        sendMsg({ type: 'create_room' });
      } else if (action === 'quick') {
        sendMsg({ type: 'quick_match' });
        showView('match');
      }
    });
  });

  // 返回按钮
  document.querySelectorAll('[data-back]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.back;
      if (target === 'hall') showView('hall');
      else if (target === 'leave-room') {
        if (room && room.status === 'playing') {
          confirmModal('离席', '对局尚未结束，确定离开吗？', () => {
            sendMsg({ type: 'leave_room' });
          });
        } else {
          sendMsg({ type: 'leave_room' });
        }
      }
    });
  });

  // 加入房间
  $('#btn-join-room').addEventListener('click', () => {
    const val = $('#room-id').value.trim().toUpperCase();
    if (!val) {
      toast('请输入房间号');
      return;
    }
    sendMsg({ type: 'join_room', roomId: val });
  });

  $('#room-id').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#btn-join-room').click();
  });

  // 取消匹配
  $('#btn-cancel-match').addEventListener('click', () => {
    sendMsg({ type: 'cancel_match' });
  });

  // 切换棋局按钮
  $('#btn-switch').addEventListener('click', () => {
    openSwitchMenu();
  });

  // 棋盘点击
  canvas.addEventListener('click', (e) => {
    if (!gameInstance || gameOver) return;
    if (!room || room.status !== 'playing') return;
    const mySide = mySideMapping();
    if (!mySide) return;
    if (room.players.length !== 1 && room.turn !== mySide) {
      toast('还没轮到你落子');
      return;
    }
    if (currentGame === 'xiangqi') {
      handleXiangqiClick(e);
    } else {
      gameInstance.handleClick(e.clientX, e.clientY);
    }
  });
}

function mySideMapping() {
function bindGameListeners() {
  if (!gameInstance || gameInstance._bound) return;
  gameInstance._bound = true;
  gameInstance.attachListener((row, col) => {
    if (!room || room.status !== 'playing') return;
    if (gameOver) return;
    const mySide = mySideMapping();
    if (!mySide) return;
    const state = gameInstance.state || gameInstance.buildState(room);
    if (!gameInstance.isValidMove(state, row, col, mySide)) {
      toast('此处不能落子');
      return;
    }
    sendMsg({ type: 'move', x: row, y: col });
  });
}

function mySideMapping() {
  if (!me || !room) return null;
  const p = room.players.find((pl) => pl.id === me.id);
  return p ? p.side : null;
}

function updateMeUI() {
  if (!me) return;
  $('#me-name').textContent = me.name;
}

/* ============ 房间渲染 ============ */
function onRoomUpdate(r) {
  room = r;
  const waiting = (r.status === 'waiting' || r.status === 'playing' && !r.gameType);

  if (r.status === 'playing' && r.gameType) {
    showView('game');
    renderGame();
  } else if (waiting || r.status === 'playing') {
    showView('room');
    renderRoom();
  } else if (r.status === 'finished') {
    showView('game');
    renderGame();
  }

  handlePending(r);
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
      if (room && room.gameType === g.id) {
        // 当前游戏，点击提示
      } else {
        openSwitchMenu(g.id);
      }
    });
    tabs.appendChild(b);
  });
}

function openSwitchMenu(gameType) {
  if (!room) return;
  if (room.status !== 'playing') {
    toast('对局尚未开始');
    return;
  }
  const target = gameType || currentGame;
  if (!target || room.gameType === target) return;
  if (target === 'go' && room.moves.length > 0) {
    // 可中途切换
  }
  sendMsg({ type: 'switch_game', gameType: target });
  toast('已请求切换棋局');
}

function renderRoom() {
  $('#room-id-tag').textContent = '房 ' + room.id;

  const blackSeat = $('#seat-black');
  const whiteSeat = $('#seat-white');
  const black = room.players.find((p) => p.side === 'black');
  const white = room.players.find((p) => p.side === 'white');

  renderSeat(blackSeat, $('#status-black'), '黑方', black);
  renderSeat(whiteSeat, $('#status-white'), '白方', white);

  const selectStage = $('#select-stage');
  const tip = $('#room-tip');
  if (room.players.length === 2 && room.status === 'playing') {
    selectStage.classList.remove('hidden');
    tip.textContent = '请选择想要进行的棋局，对方同意后开局';
  } else if (room.players.length === 1) {
    selectStage.classList.remove('hidden');
    tip.textContent = '单机模式：直接选择棋局开局（可自由落子摆棋）';
  } else {
    selectStage.classList.add('hidden');
    tip.textContent = '等待对手加入…（房间号 ' + room.id + '）';
  }
}

function renderSeat(seatEl, statusEl, sideName, player) {
  if (player) {
    seatEl.classList.add('occupied');
    statusEl.textContent = player.name + (player.online ? '' : '（离线）');
  } else {
    seatEl.classList.remove('occupied');
    statusEl.textContent = '虚位以待';
  }
}

/* ============ 对局渲染 ============ */
function renderGame() {
  if (!room) return;
  const game = gameById(room.gameType);
  if (!game) return;

  $('#game-name').textContent = game.name;

  // Tabs 高亮
  document.querySelectorAll('.game-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.game === room.gameType);
  });

  ensureGameInstance(room.gameType);
  bindGameListeners();
  if (!gameInstance) return;

  // 画布尺寸
  resizeCanvas();
  gameInstance.render(room);

  updateStatusBar();
  updateToolbar();
  updateResult();
}

function resizeCanvas() {
  const board = canvas;
  const dpr = window.devicePixelRatio || 1;
  const wrap = $('#board-wrap');
  const maxW = Math.min(wrap.clientWidth - 4, 620);
  const maxH = window.innerHeight * 0.56;
  const side = Math.min(maxW, maxH);
  board.style.width = side + 'px';
  board.style.height = side + 'px';
  board.width = side * dpr;
  board.height = side * dpr;
  if (gameInstance) gameInstance.dpr = dpr;
}

function updateStatusBar() {
  const black = room.players.find((p) => p.side === 'black');
  const white = room.players.find((p) => p.side === 'white');

  const blackName = black ? black.name : (room.gameType === 'xiangqi' ? '红方' : '黑方');
  const whiteName = white ? white.name : (room.gameType === 'xiangqi' ? '黑方' : '白方');
  $('#black-name').textContent = blackName;
  $('#white-name').textContent = whiteName;

  const xiangqi = currentGame === 'xiangqi';
  const blackLabel = xiangqi ? '红方' : '黑方';
  const whiteLabel = xiangqi ? '黑方' : '白方';

  if (room.turn === 'black') {
    $('#turn-indicator').textContent = blackLabel + '行棋';
    $('#status-black-bar').style.fontWeight = '700';
    $('#status-white-bar').style.fontWeight = '400';
  } else {
    $('#turn-indicator').textContent = whiteLabel + '行棋';
    $('#status-black-bar').style.fontWeight = '400';
    $('#status-white-bar').style.fontWeight = '700';
  }

  // 提子信息
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
}

function updateToolbar() {
  const bar = $('#game-toolbar');
  bar.innerHTML = '';

  const isTwoPlayers = room.players.length === 2;

  // 悔棋（所有棋类）
  addTool(bar, '悔棋', () => {
    if (isTwoPlayers) {
      sendMsg({ type: 'undo' });
    } else {
      sendMsg({ type: 'undo' });
    }
  });

  // 认输
  addTool(bar, '认输', () => {
    if (isTwoPlayers) {
      confirmModal('认输', '认输需对方同意。确定提交认输请求吗？', () => {
        sendMsg({ type: 'resign' });
      });
    } else {
      sendMsg({ type: 'resign' });
    }
  });

  // 和棋（双人可请求）
  addTool(bar, '和棋', () => {
    if (isTwoPlayers) {
      confirmModal('和棋', '向对方提出和棋请求？', () => {
        sendMsg({ type: 'request_draw' });
      });
    } else {
      sendMsg({ type: 'request_draw' });
    }
  });

  // 重新开局
  addTool(bar, '重开', () => {
    if (isTwoPlayers) {
      confirmModal('重新开局', '向对方提出重新开局请求？', () => {
        sendMsg({ type: 'restart' });
      });
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

function updateResult() {
  const banner = $('#result-banner');
  if (room.status === 'finished') {
    gameOver = true;
    let title, desc;
    if (room.result === '和棋') {
      title = '和棋';
      desc = '一局和棋，握手言和';
    } else if (room.result === '认输') {
      title = '胜负已分';
      desc = '对方认输';
    } else if (room.result === '对手离开') {
      title = '对手离开';
      desc = '对局结束';
    } else {
      title = '对局结束';
      desc = room.result || '';
    }
    const winnerName = room.winner
      ? (room.players.find((p) => p.id === room.winner)?.name || '胜方')
      : '';
    if (winnerName) desc = winnerName + ' 获胜';
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
    banner.classList.add('hidden');
  }
}

/* ============ Pending 弹窗 ============ */
function handlePending(r) {
  if (!r.pending) {
    if (pendingModalShown) {
      hideModal();
      pendingModalShown = false;
    }
    return;
  }
  const p = r.pending;
  const mePlayer = room.players.find((pl) => pl.id === me?.id);
  const isFromMe = p.from === me?.id;
  const needsMyResponse = !p.responded.includes(me?.id) && !isFromMe;

  if (needsMyResponse && !pendingModalShown) {
    pendingModalShown = true;
    const gameName = p.gameType ? (gameById(p.gameType)?.name || '棋局') : '棋局';
    const fromName = room.players.find((pl) => pl.id === p.from)?.name || '对手';
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
  } else if ((isFromMe || p.responded.includes(me?.id)) && pendingModalShown) {
    // 等待对方回应
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

  const state = gameInstance.buildState(room);
  const board = state.board;
  const mySide = mySideMapping();
  const clicked = board[pt.row]?.[pt.col];

  if (selectedPiece && clicked && clicked[0] === mySide) {
    // 换选
    selectedPiece = { row: pt.row, col: pt.col };
    gameInstance.selected = selectedPiece;
    gameInstance.render(room);
    gameInstance.drawSelected(selectedPiece);
    return;
  }

  if (selectedPiece) {
    const from = selectedPiece;
    if (gameInstance.isValidMoveOnBoard(board, pt.row, pt.col, mySide, null)) {
      const piece = board[from.row][from.col];
      if (!piece || piece[0] !== mySide) { selectedPiece = null; return; }
      sendMsg({ type: 'move', x: pt.row, y: pt.col });
      selectedPiece = null;
      gameInstance.selected = null;
      return;
    } else if (clicked && clicked[0] !== mySide) {
      // 尝试吃子（走法同 move）
      selectedPiece = null;
      gameInstance.selected = null;
    } else {
      selectedPiece = null;
      if (clicked && clicked[0] === mySide) {
        selectedPiece = { row: pt.row, col: pt.col };
        gameInstance.selected = selectedPiece;
      }
    }
  } else if (clicked && clicked[0] === mySide) {
    selectedPiece = { row: pt.row, col: pt.col };
    gameInstance.selected = selectedPiece;
  }
  gameInstance.render(room);
  if (selectedPiece) gameInstance.drawSelected(selectedPiece);
}

/* ============ 视图切换钩子 ============ */
function onViewShown(name) {
  if (name === 'game' && room) {
    setTimeout(() => {
      resizeCanvas();
      if (gameInstance) {
        gameInstance.render(room);
        if (selectedPiece && currentGame === 'xiangqi') gameInstance.drawSelected(selectedPiece);
      }
    }, 30);
  }
}

/* ============ 匹配 UI ============ */
function updateMatchUI(msg) {
  $('#match-hint').textContent = `等待对手中… 当前队列 ${msg.queueLength || 1} 人`;
}

window.addEventListener('resize', () => {
  if (window.currentView === 'game') {
    resizeCanvas();
    if (gameInstance && room) gameInstance.render(room);
  }
});

window.sendMsg = sendMsg;
window.showView = showView;
