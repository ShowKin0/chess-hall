/* ============ 中国象棋 ============ */
class XiangqiGame extends BaseGame {
  constructor(canvas) {
    super(canvas);
    this.rows = 10; // 0..9 行
    this.cols = 9;  // 0..8 列
  }

  getName() { return '象棋'; }
  boardSize() { return this.rows; }

  initialBoard() {
    const R = 'black'; // 红方（下方，黑代表先手红？我们约定 black=红方 先行）
    const B = 'white'; // 黑方
    const e = null;
    // 约定用 red 字样代表"红方先手"，用 black 变量名会因为 stone 显黑容易混
    // 我们直接： 'red' 先手（下方，红），'black' 后手（上方，黑）
    const board = [
      [B+'车', B+'马', B+'相', B+'仕', B+'帅', B+'仕', B+'相', B+'马', B+'车'],
      [e, e, e, e, e, e, e, e, e],
      [e, B+'炮', e, e, e, e, e, B+'炮', e],
      [B+'兵', e, B+'兵', e, B+'兵', e, B+'兵', e, B+'兵'],
      [e, e, e, e, e, e, e, e, e],
      [e, e, e, e, e, e, e, e, e],
      [R+'兵', e, R+'兵', e, R+'兵', e, R+'兵', e, R+'兵'],
      [e, R+'炮', e, e, e, e, e, R+'炮', e],
      [e, e, e, e, e, e, e, e, e],
      [R+'车', R+'马', R+'相', R+'仕', R+'帅', R+'仕', R+'相', R+'马', R+'车'],
    ];
    return board;
  }

  drawBoard() {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const W = this.canvas.width / dpr;
    const H = this.canvas.height / dpr;
    const padX = Math.round(W * 0.05);
    const padY = Math.round(H * 0.04);
    this.ox = padX;
    this.oy = padY;
    this.cell = Math.min(
      (W - padX * 2) / (this.cols - 1),
      (H - padY * 2) / (this.rows - 1),
    );
    const w = this.cell * (this.cols - 1);
    const h = this.cell * (this.rows - 1);
    this.boardW = w;
    this.boardH = h;

    ctx.strokeStyle = '#5a3d1e';
    ctx.lineWidth = 1;

    // 横线
    for (let r = 0; r < this.rows; r++) {
      const y = padY + r * this.cell;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(padX + w, y);
      ctx.stroke();
    }
    // 竖线（两侧贯通，中间断开过河）
    for (let c = 0; c < this.cols; c++) {
      const x = padX + c * this.cell;
      if (c === 0 || c === this.cols - 1) {
        ctx.beginPath();
        ctx.moveTo(x, padY);
        ctx.lineTo(x, padY + h);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x, padY);
        ctx.lineTo(x, padY + this.cell * 4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, padY + this.cell * 5);
        ctx.lineTo(x, padY + h);
        ctx.stroke();
      }
    }

    // 九宫斜线
    const x3 = padX + 3 * this.cell;
    const x5 = padX + 5 * this.cell;
    const y0 = padY, y2 = padY + 2 * this.cell;
    const y7 = padY + 7 * this.cell, y9 = padY + 9 * this.cell;
    ctx.beginPath(); ctx.moveTo(x3, y0); ctx.lineTo(x5, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x5, y0); ctx.lineTo(x3, y2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x3, y7); ctx.lineTo(x5, y9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x5, y7); ctx.lineTo(x3, y9); ctx.stroke();

    this.padX = padX; this.padY = padY;
  }

  drawPiece(row, col, piece) {
    const ctx = this.ctx;
    const { x, y } = this.cellCenter(row, col);
    const r = this.cell * 0.42;
    const side = piece[0];
    const name = piece[1];

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = r * 0.25;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#f6e8c8');
    g.addColorStop(1, '#e2c993');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = side === 'red' ? '#a33' : '#222';
    ctx.lineWidth = Math.max(1.4, r * 0.12);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.92, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = side === 'red' ? '#a33' : '#222';
    ctx.font = `${Math.round(r * 1.15)}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
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

  inPalace(row, col, side) {
    if (col < 3 || col > 5) return false;
    return side === 'red' ? (row >= 7 && row <= 9) : (row >= 0 && row <= 2);
  }

  onOwnSide(row, side) {
    return side === 'red' ? row >= 5 : row <= 4;
  }

  isValidMove(state, row, col, side, from) {
    return this.isValidMoveOnBoard(state.board, row, col, side, from);
  }

  isValidMoveOnBoard(board, row, col, side, from) {
    if (row < 0 || col < 0 || row >= this.rows || col >= this.cols) return false;
    const target = board[row][col];
    const selected = this.selected;
    // 用 selected 传进来（在 applyMove 内直接判定）
    const from = lastMove ? { row: lastMove.fromRow, col: lastMove.fromCol } : selected;
    if (!from) return false;
    const piece = board[from.row]?.[from.col];
    if (!piece) return false;
    if (this.sideOf(piece) !== side) return false;
    if (target && this.sideOf(target) === side) return false;

    const dr = row - from.row;
    const dc = col - from.col;
    const type = piece[1];
    const absDr = Math.abs(dr), absDc = Math.abs(dc);

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
        if (target && target[1] === '帅') {
          // 将帅对面：中间无子则合法（飞将）
          if (col === from.col && [from, { row, col }].every((p) => p.row >= 0)) {
            let has = false;
            const top = Math.min(from.row, row), bottom = Math.max(from.row, row);
            for (let rr = top + 1; rr < bottom; rr++) {
              if (board[rr][col]) { has = true; break; }
            }
            return !has;
          }
        }
        if (absDr + absDc !== 1) return false;
        return this.inPalace(row, col, side);
      case '炮': {
        if (dr === 0 || dc === 0) {
          const cnt = countBetween();
          if (!target) return cnt === 0;
          return cnt === 1; // 隔一打一
        }
        return false;
      }
      case '兵': {
        const forward = side === 'red' ? -1 : 1;
        const crossed = side === 'red' ? from.row <= 4 : from.row >= 5;
        if (crossed) {
          return (dc === 0 && dr === forward) || (dr === 0 && absDc === 1);
        }
        return dc === 0 && dr === forward;
      }
    }
    return false;
  }

  /* 检查是否处于被将军状态，以及对移动合法性包装 */
  applyMove(state, row, col, side, from) {
    const board = state.board.map((r) => r.slice());
    board[row][col] = board[from.row][from.col];
    board[from.row][from.col] = null;
    const lastMove = { fromRow: from.row, fromCol: from.col, toRow: row, toCol: col };
    return { board, side, moves: state.moves.slice(), lastMove };
  }

  extraInfo(state) {
    return { lastMove: state.lastMove };
  }
}

window.XiangqiGame = XiangqiGame;
