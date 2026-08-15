/* ============ 围棋 ============ */
class GoGame extends BaseGame {
  constructor(canvas) {
    super(canvas);
    this.sizeN = 19;
  }

  getName() { return '围棋'; }
  boardSize() { return this.sizeN; }

  drawBoard() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    const n = this.sizeN;
    const pad = Math.round(Math.min(W, H) * 0.06);
    this.ox = pad;
    this.oy = pad;
    const usable = Math.min(W, H) - pad * 2;
    this.cell = usable / (n - 1);

    // 网格
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

    // 星位（9路：4个星 + 天元）
    this.starPoints = [];
    const stars = (n === 9) ? [2, 4, 6] : (n === 13 ? [3, 6, 9] : [3, 9, 15]);
    for (const r of stars) {
      for (const c of stars) {
        this.starPoints.push([r, c]);
      }
    }
    for (const [r, c] of this.starPoints) {
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

    ctx.save();
    ctx.strokeStyle = side === 'black' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.82, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  pointAt(x, y) {
    const { ox, oy, cell } = this;
    const col = Math.round((x - ox) / cell);
    const row = Math.round((y - oy) / cell);
    if (row < 0 || col < 0 || row >= this.sizeN || col >= this.sizeN) return null;
    if (Math.abs(x - (ox + col * cell)) > this.cell * 0.45) return null;
    if (Math.abs(y - (oy + row * cell)) > this.cell * 0.45) return null;
    return { row, col };
  }

  neighbors(r, c) {
    const res = [];
    if (r > 0) res.push([r - 1, c]);
    if (r < this.sizeN - 1) res.push([r + 1, c]);
    if (c > 0) res.push([r, c - 1]);
    if (c < this.sizeN - 1) res.push([r, c + 1]);
    return res;
  }

  group(r, c, board) {
    const color = board[r][c];
    if (!color) return [];
    const seen = new Set([r + ',' + c]);
    const stack = [[r, c]];
    const grp = [];
    while (stack.length) {
      const [rr, cc] = stack.pop();
      grp.push([rr, cc]);
      for (const [nr, nc] of this.neighbors(rr, cc)) {
        const key = nr + ',' + nc;
        if (!seen.has(key) && board[nr][nc] === color) {
          seen.add(key);
          stack.push([nr, nc]);
        }
      }
    }
    return grp;
  }

  hasLiberty(r, c, board) {
    const grp = this.group(r, c, board);
    for (const [rr, cc] of grp) {
      for (const [nr, nc] of this.neighbors(rr, cc)) {
        if (!board[nr][nc]) return true;
      }
    }
    return false;
  }

  isValidMove(state, row, col, side) {
    const board = state.board;
    if (row < 0 || col < 0 || row >= this.sizeN || col >= this.sizeN) return false;
    if (board[row][col]) return false;

    // 模拟落子
    const copy = board.map((r) => r.slice());
    copy[row][col] = side;
    let captured = 0;
    for (const [nr, nc] of this.neighbors(row, col)) {
      if (copy[nr][nc] && copy[nr][nc] !== side && !this.hasLiberty(nr, nc, copy)) {
        const grp = this.group(nr, nc, copy);
        grp.forEach(([rr, cc]) => { copy[rr][cc] = null; });
        captured += grp.length;
      }
    }
    // 自身有气则合法
    if (this.hasLiberty(row, col, copy)) return true;
    // 无气但提子了（禁着点/打劫简化判断通过 captured>0 或 跟上一手比较）
    if (captured > 0) return true;

    // 简单打劫检查：不允许立即回提完全复现上一手棋形
    const prev = state.board;
    let diff = 0;
    for (let r = 0; r < this.sizeN; r++) {
      for (let c = 0; c < this.sizeN; c++) {
        if (prev[r][c] !== copy[r][c]) diff++;
      }
    }
    return diff > 1;
  }

  applyMove(state, row, col, side) {
    const board = state.board.map((r) => r.slice());
    board[row][col] = side;
    const captured = [];
    for (const [nr, nc] of this.neighbors(row, col)) {
      if (board[nr][nc] && board[nr][nc] !== side && !this.hasLiberty(nr, nc, board)) {
        const grp = this.group(nr, nc, board);
        grp.forEach(([rr, cc]) => { board[rr][cc] = null; captured.push(side); });
      }
    }
    const captures = { ...state.captures };
    captures[side] = (captures[side] || 0) + captured.length;
    return { board, side, moves: state.moves.slice(), captures };
  }

  extraInfo(state) {
    // 数子
    const board = state.board;
    const visited = Array.from({ length: this.sizeN }, () => Array(this.sizeN).fill(false));
    let black = 0, white = 0;
    const flood = (r, c) => {
      const stack = [[r, c]];
      visited[r][c] = true;
      const tiles = [];
      let border = new Set();
      while (stack.length) {
        const [rr, cc] = stack.pop();
        tiles.push([rr, cc]);
        for (const [nr, nc] of this.neighbors(rr, cc)) {
          if (!board[nr][nc]) {
            if (!visited[nr][nc]) {
              visited[nr][nc] = true;
              stack.push([nr, nc]);
            }
          } else {
            border.add(board[nr][nc]);
          }
        }
      }
      if (border.size === 1) {
        const owner = border.values().next().value;
        if (owner === 'black') black += tiles.length;
        else white += tiles.length;
      }
      return tiles.length;
    };
    for (let r = 0; r < this.sizeN; r++) {
      for (let c = 0; c < this.sizeN; c++) {
        if (!board[r][c]) {
          if (!visited[r][c]) flood(r, c);
        } else if (board[r][c] === 'black') black++;
        else white++;
      }
    }
    return { black, white, captures: state.captures || {} };
  }

  renderInfo(state) {
    return this.info || { black: 0, white: 0, captures: {} };
  }
}

window.GoGame = GoGame;
