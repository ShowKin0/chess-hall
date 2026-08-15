/* ============ 单机 AI · 四棋通用 ============ */
/* 全部为本地启发式 AI，零额外依赖、零网络延迟 */
window.InkAI = (function () {
  const LV = ['low', 'medium', 'high', 'extreme'];

  function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  function cloneBoard(board) {
    return board.map((r) => r.slice());
  }
  function isEmpty(board, r, c) {
    return board[r] && board[r][c] === null;
  }

  /* 评估权重：按难度返回随机概率 */
  function randFactor(level) {
    return { low: 0.55, medium: 0.25, high: 0.1, extreme: 0 }[level] ?? 0.1;
  }

  /* ============================ 五子棋 ============================ */
  const GOMOKU_DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function gomokuCandidates(game, state) {
    const n = game.sizeN;
    const board = state.board;
    const hasStone = [];
    let any = false;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (board[r][c]) { hasStone.push([r, c]); any = true; }
      }
    }
    const cand = new Set();
    const add = (r, c) => {
      if (r >= 0 && r < n && c >= 0 && c < n && !board[r][c]) cand.add(r + ',' + c);
    };
    if (!any) { cand.add(`${(n - 1) >> 1},${(n - 1) >> 1}`); }
    for (const [r, c] of hasStone) {
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) add(r + dr, c + dc);
      }
    }
    if (!cand.size) cand.add(`${(n - 1) >> 1},${(n - 1) >> 1}`);
    return Array.from(cand).map((s) => {
      const [r, c] = s.split(',').map(Number);
      return { row: r, col: c };
    });
  }

  /* 对某一点分别计算 攻（ai 成五潜力）、防（玩家成五潜力） */
  function gomokuScoreAt(board, row, col, me, enemy, n) {
    let atk = 0, def = 0;
    for (const [dr, dc] of GOMOKU_DIRS) {
      let mine = 1, opp = 1;
      // 正向
      for (let step = 1; step < 5; step++) {
        const r = row + dr * step, c = col + dc * step;
        if (r < 0 || r >= n || c < 0 || c >= n) break;
        const v = board[r][c];
        if (v === me) mine++;
        else if (v === enemy) { mine = -99; /* 被挡，但可继续用于防守统计 */ }
        else break;
      }
      for (let step = 1; step < 5; step++) {
        const r = row - dr * step, c = col - dc * step;
        if (r < 0 || r >= n || c < 0 || c >= n) break;
        const v = board[r][c];
        if (v === me) mine++;
        else break;
      }
      for (let step = 1; step < 5; step++) {
        const r = row + dr * step, c = col + dc * step;
        if (r < 0 || r >= n || c < 0 || c >= n) break;
        const v = board[r][c];
        if (v === enemy) opp++;
        else break;
      }
      for (let step = 1; step < 5; step++) {
        const r = row - dr * step, c = col - dc * step;
        if (r < 0 || r >= n || c < 0 || c >= n) break;
        const v = board[r][c];
        if (v === enemy) opp++;
        else break;
      }
      atk += Math.pow(Math.max(0, mine), 3);
      def += Math.pow(Math.max(0, opp), 3);
    }
    return { atk, def };
  }

  function gomokuDecide(game, state, level, aiSide) {
    const board = state.board;
    const enemy = aiSide === 'black' ? 'white' : 'black';
    const cands = gomokuCandidates(game, state).map((p) => {
      const sc = gomokuScoreAt(board, p.row, p.col, aiSide, enemy, game.sizeN);
      // 超难：更看重双威胁与制胜；普通：atk/def 并行
      const score = level === 'extreme'
        ? (sc.atk + sc.def * 0.9)
        : (sc.atk * 0.55 + sc.def * 0.45);
      return { ...p, score, atk: sc.atk, def: sc.def };
    });
    cands.sort((a, b) => b.score - a.score);

    if (level === 'low') return rand(shuffle(cands.slice(0, 6)));
    if (level === 'medium') {
      const pool = cands.slice(0, 4);
      return rand(shuffle(pool));
    }
    // high / extreme 取最优，微随机避免完全一样
    const top = cands.slice(0, level === 'extreme' ? 2 : 3);
    return top[0];
  }

  /* ============================ 象棋 ============================ */
  const XIANGQI_VAL = { 帅: 10000, 车: 900, 马: 420, 炮: 430, 仕: 200, 相: 200, 兵: 100 };
  const XIANGQI_POS = {
    // 兵在中路/过河价值更高（简单位置加成）
    兵: (r, c, side) => {
      const crossed = side === 'white' ? r >= 5 : r <= 4;
      return crossed ? (side === 'white' ? r * 2 : (9 - r) * 2) + (c === 4 ? 5 : 0) : 0;
    },
    马: (r, c, side) => 2,
    车: (r, c, side) => (c >= 3 && c <= 5 ? 6 : 0),
    炮: (r, c, side) => 4,
  };

  function xiangqiPieceVal(p) {
    return XIANGQI_VAL[p[1]] || 100;
  }

  function xiangqiMaterial(board, side) {
    let sum = 0;
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        const p = board[r][c];
        if (!p) continue;
        const sign = p[0] === side ? 1 : -1;
        const pos = (XIANGQI_POS[p[1]] || (() => 0))(r, c, p[0]);
        sum += sign * (xiangqiPieceVal(p) + pos);
      }
    }
    return sum;
  }

  function xiangqiMoves(game, board, side, filterCheck) {
    const moves = [];
    for (let fr = 0; fr < game.rows; fr++) {
      for (let fc = 0; fc < game.cols; fc++) {
        const p = board[fr][fc];
        if (!p || p[0] !== side) continue;
        for (let tr = 0; tr < game.rows; tr++) {
          for (let tc = 0; tc < game.cols; tc++) {
            const from = { row: fr, col: fc };
            if (!game.isValidMoveOnBoard(board, tr, tc, side, from)) continue;
            if (filterCheck && game.isValidMoveFull && !game.isValidMoveFull(board, tr, tc, side, from)) continue;
            const captured = board[tr][tc];
            moves.push({ from, row: tr, col: tc, captured, piece: p });
          }
        }
      }
    }
    return moves;
  }

  function xiangqiScoreMove(game, board, move, side) {
    const capVal = move.captured ? xiangqiPieceVal(move.captured) * 1.4 : 0;
    // 移动后子力增量
    const copy = cloneBoard(board);
    copy[move.row][move.col] = copy[move.from.row][move.from.col];
    copy[move.from.row][move.from.col] = null;
    const materialDelta = xiangqiMaterial(copy, side) - xiangqiMaterial(board, side);
    // 将军奖励
    const enemy = side === 'black' ? 'white' : 'black';
    const givesCheck = game.isInCheck(copy, enemy) ? 40 : 0;
    return capVal + materialDelta * 0.3 + givesCheck;
  }

  function xiangqiDecide(game, state, level, aiSide) {
    const board = state.board;
    const useFilter = true; // 全部难度只走合法步（不含送将）
    let moves = xiangqiMoves(game, board, aiSide, useFilter);
    if (!moves.length) return null;
    if (level === 'low') {
      // 优先吃子，否则随机
      const eats = moves.filter((m) => m.captured);
      return rand(shuffle(eats.length ? eats : moves));
    }
    const scored = moves.map((m) => ({ m, score: xiangqiScoreMove(game, board, m, aiSide) }));
    scored.sort((a, b) => b.score - a.score);
    if (level === 'medium') return rand(shuffle(scored.slice(0, 4))).m;

    // high：一层择优 + 避免明显送子（若候选被吃的子价值高则扣分）
    const enemy = aiSide === 'black' ? 'white' : 'black';
    const best = scored.map((s) => {
      const copy = cloneBoard(board);
      copy[s.m.row][s.m.col] = copy[s.m.from.row][s.m.from.col];
      copy[s.m.from.row][s.m.from.col] = null;
      const enemyMoves = xiangqiMoves(game, copy, enemy, false);
      let worstLoss = 0;
      for (const em of enemyMoves) {
        if (em.captured && em.captured[0] === aiSide) worstLoss = Math.max(worstLoss, xiangqiPieceVal(em.captured));
      }
      return { m: s.m, score: s.score - worstLoss * (level === 'extreme' ? 1.0 : 0.6) };
    });
    best.sort((a, b) => b.score - a.score);
    return best[0].m;
  }

  /* ============================ 围棋 ============================ */
  function goNeighbors(game, r, c) {
    const res = [];
    if (r > 0) res.push([r - 1, c]);
    if (r < game.sizeN - 1) res.push([r + 1, c]);
    if (c > 0) res.push([r, c - 1]);
    if (c < game.sizeN - 1) res.push([r, c + 1]);
    return res;
  }

  /* 计算某侧在某点的气数（用于候选评估） */
  function goLiberties(game, board, r, c, side) {
    const n = game.sizeN;
    const checked = Array.from({ length: n }, () => Array(n).fill(false));
    const stack = [[r, c]];
    let lib = 0;
    while (stack.length) {
      const [rr, cc] = stack.pop();
      if (checked[rr][cc]) continue;
      checked[rr][cc] = true;
      for (const [nr, nc] of goNeighbors(game, rr, cc)) {
        const v = board[nr][nc];
        if (!v) lib++;
        else if (v === side && !checked[nr][nc]) stack.push([nr, nc]);
      }
    }
    return lib;
  }

  function goSimulateCaptures(game, board, row, col, side) {
    const copy = cloneBoard(board);
    copy[row][col] = side;
    let captured = 0;
    for (const [nr, nc] of goNeighbors(game, row, col)) {
      const v = copy[nr][nc];
      if (v && v !== side && goLiberties(game, copy, nr, nc, v) === 0) {
        captured += game.group(nr, nc, copy).length;
      }
    }
    return { captured, board: copy };
  }

  function goCandidates(game, state) {
    const n = game.sizeN;
    const board = state.board;
    const any = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (board[r][c]) any.push([r, c]);
    const cand = new Set();
    const add = (r, c) => { if (r >= 0 && r < n && c >= 0 && c < n && !board[r][c]) cand.add(r + ',' + c); };
    if (!any.length) {
      const mid = Math.floor(n / 2);
      add(mid, mid);
      add(mid, mid - 1); add(mid - 1, mid); add(mid, mid + 1); add(mid + 1, mid);
    }
    for (const [r, c] of any) {
      add(r, c); add(r - 1, c); add(r + 1, c); add(r, c - 1); add(r, c + 1);
    }
    if (!cand.size) { const mid = Math.floor(n / 2); add(mid, mid); }
    return Array.from(cand).map((s) => { const [r, c] = s.split(',').map(Number); return { row: r, col: c }; });
  }

  function goDecide(game, state, level, aiSide) {
    const enemy = aiSide === 'black' ? 'white' : 'black';
    let cands = goCandidates(game, state).filter((p) => game.isValidMove(state, p.row, p.col, aiSide));
    if (!cands.length) return { row: Math.floor(game.sizeN / 2), col: Math.floor(game.sizeN / 2), from: null };
    if (level === 'low') return rand(shuffle(cands));

    const scored = cands.map((p) => {
      const cap = goSimulateCaptures(game, state.board, p.row, p.col, aiSide);
      const myLib = goLiberties(game, cap.board, p.row, p.col, aiSide);
      // 防止自撞无气同时没提子
      // 攻击：吃敌子；防御：避免无气
      const suicide = cap.captured === 0 && myLib === 0 ? -999 : 0;
      return { ...p, cap: cap.captured, myLib, suicide };
    });

    if (level === 'medium') {
      const eat = scored.filter((s) => s.cap > 0 && s.suicide > -900);
      if (eat.length) return rand(shuffle(eat.sort((a, b) => b.cap - a.cap)).slice(0, 3));
      scored.sort((a, b) => (b.myLib + b.cap * 3) - (a.myLib + a.cap * 3));
      return rand(shuffle(scored.slice(0, 5)));
    }
    // high / extreme
    scored.sort((a, b) => {
      const av = a.cap * 8 + a.myLib + (a.suicide ? -999 : 0);
      const bv = b.cap * 8 + b.myLib + (b.suicide ? -999 : 0);
      return bv - av;
    });
    // extreme 附带吃掉最多、占据边角/中心（简单扩地）
    if (level === 'extreme') {
      const n = game.sizeN;
      scored.sort((a, b) => {
        const av = a.cap * 10 + a.myLib + (a.suicide ? -999 : 0) + (Math.min(a.row, n - 1 - a.row) + Math.min(a.col, n - 1 - a.col)) * 0.1;
        const bv = b.cap * 10 + b.myLib + (b.suicide ? -999 : 0) + (Math.min(b.row, n - 1 - b.row) + Math.min(b.col, n - 1 - b.col)) * 0.1;
        return bv - av;
      });
    }
    return scored[0];
  }

  /* ============================ 分发 ============================ */
  function decide(game, state, level, aiSide, gameType) {
    level = LV.includes(level) ? level : 'medium';
    try {
      if (gameType === 'gomoku_folk' || gameType === 'gomoku_standard') {
        const m = gomokuDecide(game, state, level, aiSide);
        return m ? { x: m.row, y: m.col, from: null } : null;
      }
      if (gameType === 'xiangqi') {
        const m = xiangqiDecide(game, state, level, aiSide);
        return m ? { x: m.row, y: m.col, from: { row: m.from.row, col: m.from.col } } : null;
      }
      if (gameType === 'go') {
        const m = goDecide(game, state, level, aiSide);
        return m ? { x: m.row, y: m.col, from: null } : null;
      }
    } catch (e) {
      console.warn('[AI] error', e);
    }
    return null;
  }

  return { decide, levels: LV };
})();
