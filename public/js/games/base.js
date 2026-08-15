/* ============ 棋类基类 ============ */
class BaseGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.room = null;
    this.dpr = 1;
    this.padding = 24;      // 棋盘画布内边距（px，配合 dpr 使用前转换）
    this.cell = 0;          // 每格像素
    this.size = 0;          // 横竖线数量（含边界线）
    this.starPoints = [];
    this.listeners = [];
    this.selected = null;   // 当前选中（象棋用）
    this.ox = 0;
    this.oy = 0;
    this.info = {};
    this.state = null;
  }

  attachListener(fn) {
    this.listeners.push(fn);
    return fn;
  }

  /* 子类实现 */
  getName() { return '棋局'; }
  boardSize() { return 9; }          // 横线数（含边界）
  drawBoard() {}
  drawPiece(row, col, side) {}
  pointAt(x, y) { return { row: -1, col: -1 }; }
  isValidMove(state, row, col, side) { return true; }
  applyMove(state, row, col, side) { return state; }
  extraInfo(state) { return {}; }

  /* 初始棋局（象棋等需重写） */
  initialBoard() {
    return Array.from({ length: this.boardSize() }, () => Array(this.boardSize()).fill(null));
  }

  /* 状态（通过重放 moves 得到局面） */
  buildState(room) {
    let state = {
      board: this.initialBoard(),
      side: 'black',
      moves: [],
      captures: {},
      lastMove: null,
    };
    for (const mv of (room.moves || [])) {
      const from = mv.from || { row: mv.fromRow, col: mv.fromCol };
      const valid = mv.invalid ? false : this.isValidMove(state, mv.x, mv.y, mv.side, from);
      if (valid) {
        state = this.applyMove(state, mv.x, mv.y, mv.side, from);
        state.moves.push({ ...mv });
      } else {
        // 非法落子跳过（保证重放稳健），但保留标记
        state.moves.push({ ...mv, skipped: true });
      }
    }
    return state;
  }

  render(room) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // 底色（木纹/宣纸质感）
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#efd9a8');
    g.addColorStop(0.5, '#eacc96');
    g.addColorStop(1, '#dfbd85');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 细木纹
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#7a5325';
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      const yy = (i / 14) * H + Math.sin(i) * 6;
      ctx.moveTo(0, yy);
      ctx.bezierCurveTo(W * 0.4, yy + 9, W * 0.6, yy - 9, W, yy + 4);
      ctx.stroke();
    }
    ctx.restore();

    this.drawBoard();

    // 绘制棋子
    const state = this.buildState(room);
    for (let r = 0; r < state.board.length; r++) {
      for (let c = 0; c < state.board[r].length; c++) {
        const p = state.board[r][c];
        if (p) {
          this.drawPiece(r, c, p);
        }
      }
    }

    // 标记最后一手
    const last = (room.moves || []).filter((m) => !m.skipped && !m.invalid).pop();
    if (last && last.x != null && last.y != null) {
      this.drawLastMarker(last.x, last.y, last.side);
    }

    this.info = this.extraInfo(state);
    this.state = state;
  }

  drawLastMarker(row, col, side) {
    const { x, y } = this.cellCenter(row, col);
    const ctx = this.ctx;
    const r = this.cell * 0.16;
    ctx.save();
    ctx.strokeStyle = side === 'black' ? '#e8e2d0' : '#a33';
    ctx.lineWidth = Math.max(2, this.cell * 0.06);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  cellCenter(row, col) {
    return {
      x: this.ox + col * this.cell,
      y: this.oy + row * this.cell,
    };
  }

  handleClick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (this.canvas.width / this.dpr / rect.width);
    const y = (clientY - rect.top) * (this.canvas.height / this.dpr / rect.height);
    const pt = this.pointAt(x, y);
    if (!pt || pt.row < 0 || pt.col < 0) return;
    for (const fn of this.listeners) fn(pt.row, pt.col, x, y);
  }

  /* 判断棋盘鼠标悬浮高亮（可继承重写） */
  drawHover(row, col) {}
  drawSelected(sel) {
    if (!sel) return;
    const { x, y } = this.cellCenter(sel.row, sel.col);
    const ctx = this.ctx;
    const r = this.cell * 0.46;
    ctx.save();
    ctx.strokeStyle = '#a33';
    ctx.lineWidth = Math.max(2, this.cell * 0.08);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }


}

window.BaseGame = BaseGame;
