/* ============ 五子棋 · 民间玩法 ============ */
/* 民间玩法：无禁手，15 路棋盘，先连五者胜；棋盘较小 13 路更亲民 */
class GomokuFolkGame extends BaseGame {
  constructor(canvas) {
    super(canvas);
    this.sizeN = 13;
  }

  getName() { return '五子棋（民间玩法）'; }
  boardSize() { return this.sizeN; }

  drawBoard() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    const n = this.sizeN;
    const pad = Math.round(Math.min(W, H) * 0.07);
    this.ox = pad;
    this.oy = pad;
    const usable = Math.min(W, H) - pad * 2;
    this.cell = usable / (n - 1);

    ctx.strokeStyle = '#5a3d1e';
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const p = pad + i * this.cell;
      ctx.beginPath();
      ctx.moveTo(pad, p);
      ctx.lineTo(pad + (n - 1) * this.cell, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, pad);
      ctx.lineTo(p, pad + (n - 1) * this.cell);
      ctx.stroke();
    }

    // 星位（13 路）
    for (const [r, c] of [[3, 3], [3, 9], [9, 3], [9, 9], [6, 6]]) {
      ctx.beginPath();
      ctx.arc(pad + c * this.cell, pad + r * this.cell, Math.max(2, this.cell * 0.1), 0, Math.PI * 2);
      ctx.fillStyle = '#5a3d1e';
      ctx.fill();
    }
  }

  drawPiece(row, col, side) {
    const ctx = this.ctx;
    const { x, y } = this.cellCenter(row, col);
    const r = this.cell * 0.44;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = r * 0.3;
    ctx.shadowOffsetX = r * 0.08;
    ctx.shadowOffsetY = r * 0.1;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    if (side === 'black') {
      g.addColorStop(0, '#3c332b');
      g.addColorStop(1, '#0d0b09');
    } else {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(1, '#c9bfae');
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  pointAt(x, y) {
    const { ox, oy, cell } = this;
    const col = Math.round((x - ox) / cell);
    const row = Math.round((y - oy) / cell);
    if (row < 0 || col < 0 || row >= this.sizeN || col >= this.sizeN) return null;
    if (Math.abs(x - (ox + col * cell)) > this.cell * 0.4) return null;
    if (Math.abs(y - (oy + row * cell)) > this.cell * 0.4) return null;
    return { row, col };
  }

  isValidMove(state, row, col) {
    return row >= 0 && col >= 0 && row < this.sizeN && col < this.sizeN && !state.board[row][col];
  }

  applyMove(state, row, col, side) {
    const board = state.board.map((r) => r.slice());
    board[row][col] = side;
    return { board, side, moves: state.moves.slice() };
  }

  extraInfo(state) {
    return { winner: this.checkWin(state.board) };
  }

  checkWin(board) {
    const n = this.sizeN;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const p = board[r][c];
        if (!p) continue;
        for (const [dr, dc] of dirs) {
          let cnt = 1;
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === p) { cnt++; rr += dr; cc += dc; }
          rr = r - dr; cc = c - dc;
          while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === p) { cnt++; rr -= dr; cc -= dc; }
          if (cnt >= 5) return p;
        }
      }
    }
    return null;
  }
}

window.GomokuFolkGame = GomokuFolkGame;
