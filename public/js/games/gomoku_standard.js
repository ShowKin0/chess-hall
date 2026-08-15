/* ============ 五子棋 · 国际标准 ============ */
/* 国际标准（连珠 RIF 简化规则）：15 路，黑先；黑方禁手：三三、四四、长连（但为民间体验，可配置严格度） */
class GomokuStandardGame extends GomokuFolkGame {
  constructor(canvas) {
    super(canvas);
    this.sizeN = 15;
  }

  getName() { return '五子棋（国际标准）'; }
  boardSize() { return this.sizeN; }

  drawBoard() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    const n = this.sizeN;
    const pad = Math.round(Math.min(W, H) * 0.065);
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

    for (const [r, c] of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) {
      ctx.beginPath();
      ctx.arc(pad + c * this.cell, pad + r * this.cell, Math.max(2, this.cell * 0.1), 0, Math.PI * 2);
      ctx.fillStyle = '#5a3d1e';
      ctx.fill();
    }
  }

  /* 黑方禁手简化判断 */
  isForbidden(board, row, col, side) {
    if (side !== 'black') return false;
    // 判断落子后是否直接成五 -> 允许
    const boardCopy = board.map((r) => r.slice());
    boardCopy[row][col] = side;
    const five = this.countAround(boardCopy, row, col, side);
    if (five >= 1) return false;

    // 检查 3x3 周围是否出现两个以上活三/冲四/长连
    let threes = 0, fours = 0;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      const line = this.collectLine(boardCopy, row, col, side, dr, dc);
      const analysis = this.analyzeLine(line, side);
      threes += analysis.threes;
      fours += analysis.fours;
      if (analysis.long) return true; // 长连禁手
    }
    if (threes >= 2 || fours >= 2) return true;
    return false;
  }

  collectLine(board, row, col, side, dr, dc) {
    const n = this.sizeN;
    const cells = [];
    // 从远端往近端
    for (let step = -4; step <= 4; step++) {
      const r = row + dr * step;
      const c = col + dc * step;
      if (r < 0 || c < 0 || r >= n || c >= n) cells.push(null);
      else cells.push(board[r][c]);
    }
    return cells;
  }

  analyzeLine(line, side) {
    // line[i] === side 是己方，"连", null/其他为间隔
    let threes = 0, fours = 0, long = false;
    for (let i = 0; i + 4 < line.length; i++) {
      let cnt = 0, own = 0, empty = 0;
      for (let j = 0; j < 5; j++) {
        const cell = line[i + j];
        if (cell === side) own++;
        else if (cell === null || cell !== side) empty++;
      }
      if (empty === 0) {
        if (own >= 6) long = true; // 超5也算长连（简化：>=6）
        // 五连允许
      }
      if (own === 4 && empty === 1) fours++;
      if (own === 3 && empty === 2) threes++;
    }
    return { threes, fours, long };
  }

  countAround(board, row, col, side) {
    let fives = 0;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const [dr, dc] of dirs) {
      let cnt = 1;
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < this.sizeN && c >= 0 && c < this.sizeN && board[r][c] === side) { cnt++; r += dr; c += dc; }
      r = row - dr; c = col - dc;
      while (r >= 0 && r < this.sizeN && c >= 0 && c < this.sizeN && board[r][c] === side) { cnt++; r -= dr; c -= dc; }
      if (cnt >= 5) fives++;
    }
    return fives;
  }

  isValidMove(state, row, col, side) {
    if (!super.isValidMove(state, row, col)) return false;
    if (this.isForbidden(state.board, row, col, side)) {
      return false;
    }
    return true;
  }
}

window.GomokuStandardGame = GomokuStandardGame;
