/* ============ 中国象棋（优化版） ============ */
/* 约定：side='black' 为先手（视觉红色，执红在下），side='white' 为后手（视觉黑色，执黑在上） */
class XiangqiGame extends BaseGame {
  constructor(canvas) {
    super(canvas);
    this.rows = 10;
    this.cols = 9;
  }

  getName() { return '象棋'; }
  boardSize() { return this.rows; }

  initialBoard() {
    const red = 'black';
    const blk = 'white';
    const e = null;
    return [
      [blk+'车', blk+'马', blk+'相', blk+'仕', blk+'帅', blk+'仕', blk+'相', blk+'马', blk+'车'],
      [e,e,e,e,e,e,e,e,e],
      [e, blk+'炮', e,e,e,e,e, blk+'炮', e],
      [blk+'兵', e, blk+'兵', e, blk+'兵', e, blk+'兵', e, blk+'兵'],
      [e,e,e,e,e,e,e,e,e],
      [e,e,e,e,e,e,e,e,e],
      [red+'兵', e, red+'兵', e, red+'兵', e, red+'兵', e, red+'兵'],
      [e, red+'炮', e,e,e,e,e, red+'炮', e],
      [e,e,e,e,e,e,e,e,e],
      [red+'车', red+'马', red+'相', red+'仕', red+'帅', red+'仕', red+'相', red+'马', red+'车'],
    ];
  }

  drawBoard() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    const padX = Math.round(W * 0.055);
    const padY = Math.round(H * 0.05);
    this.ox = padX;
    this.oy = padY;
    this.cell = Math.min(
      (W - padX * 2) / (this.cols - 1),
      (H - padY * 2) / (this.rows - 1),
    );
    const w = this.cell * (this.cols - 1);
    const h = this.cell * (this.rows - 1);
    this.boardW = w; this.boardH = h;

    ctx.strokeStyle = '#5a3d1e';
    ctx.lineWidth = 1.2;

    for (let r = 0; r < this.rows; r++) {
      const y = padY + r * this.cell;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(padX + w, y); ctx.stroke();
    }
    for (let c = 0; c < this.cols; c++) {
      const x = padX + c * this.cell;
      if (c === 0 || c === this.cols - 1) {
        ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, padY + h); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(x, padY); ctx.lineTo(x, padY + this.cell * 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x, padY + this.cell * 5); ctx.lineTo(x, padY + h); ctx.stroke();
      }
    }

    const x3 = padX + 3 * this.cell, x5 = padX + 5 * this.cell;
    const y0 = padY, y2 = padY + 2 * this.cell;
    const y7 = padY + 7 * this.cell, y9 = padY + 9 * this.cell;
    ctx.beginPath(); ctx.moveTo(x3, y0); ctx.lineTo(x5, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x5, y0); ctx.lineTo(x3, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x3, y7); ctx.lineTo(x5, y9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x5, y7); ctx.lineTo(x3, y9); ctx.stroke();

    ctx.save();
    ctx.fillStyle = '#6b4c23';
    ctx.font = `${Math.round(this.cell * 0.55)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cy = padY + this.cell * 4.5;
    ctx.fillText('楚 河', padX + this.cell * 2, cy);
    ctx.fillText('汉 界', padX + this.cell * 6.4, cy);
    ctx.restore();

    this.padX = padX; this.padY = padY;
  }

  drawPiece(row, col, piece) {
    const ctx = this.ctx;
    const { x, y } = this.cellCenter(row, col);
    const r = this.cell * 0.43;
    const side = piece[0];
    const name = piece[1];
    const isRed = side === 'black';

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = r * 0.25;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, isRed ? '#f8e2c0' : '#f1e2c2');
    g.addColorStop(1, '#dcbd83');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = isRed ? '#a33' : '#222';
    ctx.lineWidth = Math.max(1.4, r * 0.12);
    ctx.beginPath(); ctx.arc(x, y, r * 0.92, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = `${Math.round(r * 1.15)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, x, y + 1);
    ctx.restore();
  }

  pointAt(x, y) {
    const { padX, padY, cell } = this;
    const col = Math.round((x - padX) / cell);
    const row = Math.round((y - padY) / cell);
    if (row < 0 || col < 0 || row >= this.rows || col >= this.cols) return null;
    if (Math.abs(x - padX - col * cell) > cell * 0.45) return null;
    if (Math.abs(y - padY - row * cell) > cell * 0.45) return null;
    return { row, col };
  }

  sideOf(piece) { return piece ? piece[0] : null; }
  pieceName(piece) { return piece ? piece[1] : null; }

  inPalace(row, col, side) {
    if (col < 3 || col > 5) return false;
    return side === 'black' ? (row >= 7 && row <= 9) : (row >= 0 && row <= 2);
  }

  onOwnSide(row, side) {
    return side === 'black' ? row >= 5 : row <= 4;
  }

  isValidMove(state, row, col, side, from) {
    return this.isValidMoveFull(state.board, row, col, side, from);
  }

  isValidMoveOnBoard(board, row, col, side, from) {
    if (row < 0 || col < 0 || row >= this.rows || col >= this.cols) return false;
    if (!from) return false;
    from = { row: from.row, col: from.col };
    if (from.row < 0 || from.col < 0 || from.row >= this.rows || from.col >= this.cols) return false;

    const target = board[row][col];
    const piece = board[from.row]?.[from.col];
    if (!piece) return false;
    if (this.sideOf(piece) !== side) return false;
    if (target && this.sideOf(target) === side) return false;

    const dr = row - from.row;
    const dc = col - from.col;
    const type = piece[1];
    const absDr = Math.abs(dr), absDc = Math.abs(dc);
    if (dr === 0 && dc === 0) return false;

    const countBetween = () => {
      let cnt = 0;
      const sr = Math.sign(dr), sc = Math.sign(dc);
      let rr = from.row + sr, cc = from.col + sc;
      while (rr !== row || cc !== col) {
        if (board[rr]?.[cc]) cnt++;
        rr += sr; cc += sc;
      }
      return cnt;
    };

    switch (type) {
      case '车':
        if (dr === 0 || dc === 0) return countBetween() === 0;
        return false;
      case '马': {
        if (!((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2))) return false;
        const blockR = from.row + (absDr === 2 ? Math.sign(dr) : 0);
        const blockC = from.col + (absDc === 2 ? Math.sign(dc) : 0);
        return !board[blockR]?.[blockC];
      }
      case '相':
        if (absDr !== 2 || absDc !== 2) return false;
        if (!this.onOwnSide(row, side)) return false;
        return !board[from.row + Math.sign(dr)]?.[from.col + Math.sign(dc)];
      case '仕':
        return absDr === 1 && absDc === 1 && this.inPalace(row, col, side);
      case '帅':
        if (target && this.pieceName(target) === '帅' && this.sideOf(target) !== side) {
          if (col === from.col) {
            const top = Math.min(from.row, row), bottom = Math.max(from.row, row);
            for (let rr = top + 1; rr < bottom; rr++) {
              if (board[rr][col]) return false;
            }
            return true;
          }
        }
        if (absDr + absDc !== 1) return false;
        return this.inPalace(row, col, side);
      case '炮': {
        if (dr === 0 || dc === 0) {
          const cnt = countBetween();
          if (!target) return cnt === 0;
          return cnt === 1;
        }
        return false;
      }
      case '兵': {
        const forward = side === 'black' ? -1 : 1;
        const crossed = side === 'black' ? from.row <= 4 : from.row >= 5;
        if (crossed) return (dc === 0 && dr === forward) || (dr === 0 && absDc === 1);
        return dc === 0 && dr === forward;
      }
    }
    return false;
  }

  findKing(board, side) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = board[r][c];
        if (p && p[0] === side && p[1] === '帅') return { row: r, col: c };
      }
    }
    return null;
  }

  /* 快速将军检测：只检查敌方 16 个棋子能否吃掉将/帅，无需生成全部走法 */
  isInCheck(board, side) {
    const king = this.findKing(board, side);
    if (!king) return false;
    const enemy = side === 'black' ? 'white' : 'black';
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = board[r][c];
        if (!p || p[0] !== enemy) continue;
        if (this.isValidMoveOnBoard(board, king.row, king.col, enemy, { row: r, col: c })) return true;
      }
    }
    return false;
  }

  /* 合法性 + 走子后不能送将 */
  isValidMoveFull(board, row, col, side, from) {
    if (!this.isValidMoveOnBoard(board, row, col, side, from)) return false;
    const copy = board.map((r) => r.slice());
    copy[row][col] = copy[from.row][from.col];
    copy[from.row][from.col] = null;
    return !this.isInCheck(copy, side);
  }

  applyMove(state, row, col, side, from) {
    const board = state.board.map((r) => r.slice());
    board[row][col] = board[from.row][from.col];
    board[from.row][from.col] = null;
    const lastMove = { fromRow: from.row, fromCol: from.col, toRow: row, toCol: col };
    return { board, side, moves: state.moves.slice(), captures: state.captures, lastMove };
  }

  extraInfo(state) {
    return {
      lastMove: state.lastMove,
      checks: {
        black: this.isInCheck(state.board, 'black'),
        white: this.isInCheck(state.board, 'white'),
      },
    };
  }
}

window.XiangqiGame = XiangqiGame;
