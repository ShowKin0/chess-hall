/* ============ 水墨棋院 · 增强 AI ============ */
/* 纯本地启发式 + 限时搜索；无外部依赖，低延迟 */
window.InkAI = (function () {
  const LEVELS = ['low', 'medium', 'high', 'extreme'];
  const NOW = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const TIMEOUT = Symbol('ai_timeout');

  /* ---------- 通用工具 ---------- */
  function rand(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function cloneBoard(board) {
    return board.map((r) => r.slice());
  }
  function ensureLegalPool(moves) {
    return moves.length ? moves : null;
  }

  /* ============================ 五子棋 ============================ */
  const G_DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function gomokuShape(count, open) {
    if (count >= 5) return 10000000;
    if (count === 4) return open >= 2 ? 600000 : 60000;
    if (count === 3) return open >= 2 ? 22000 : 1400;
    if (count === 2) return open >= 2 ? 1100 : 110;
    if (count === 1) return open >= 2 ? 26 : 4;
    return 0;
  }

  function gomokuPointScore(board, row, col, side, n) {
    const copy = cloneBoard(board);
    copy[row][col] = side;
    let score = 0;
    for (const [dr, dc] of G_DIRS) {
      let cnt = 1, open = 0;
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < n && c >= 0 && c < n && copy[r][c] === side) { cnt++; r += dr; c += dc; }
      if (r >= 0 && r < n && c >= 0 && c < n && !copy[r][c]) open++;
      r = row - dr; c = col - dc;
      while (r >= 0 && r < n && c >= 0 && c < n && copy[r][c] === side) { cnt++; r -= dr; c -= dc; }
      if (r >= 0 && r < n && c >= 0 && c < n && !copy[r][c]) open++;
      score += gomokuShape(cnt, open);
    }
    return score;
  }

  function gomokuMoveLegal(game, board, row, col, side) {
    if (row < 0 || col < 0 || row >= game.sizeN || col >= game.sizeN) return false;
    if (board[row][col]) return false;
    if (game.isForbidden && game.isForbidden(board, row, col, side)) return false;
    return true;
  }

  function gomokuCandidates(game, board, radius) {
    const n = game.sizeN;
    const stones = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (board[r][c]) stones.push([r, c]);
    const set = new Set();
    const add = (r, c) => { if (r >= 0 && r < n && c >= 0 && c < n && !board[r][c]) set.add(r + ',' + c); };
    if (!stones.length) {
      const m = Math.floor(n / 2);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add(m + dr, m + dc);
    } else {
      for (const [r, c] of stones) {
        for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) add(r + dr, c + dc);
      }
    }
    if (!set.size) add(Math.floor(n / 2), Math.floor(n / 2));
    return Array.from(set).map((s) => {
      const [r, c] = s.split(',').map(Number);
      return { row: r, col: c };
    });
  }

  function gomokuImmediateWins(game, board, side, cands) {
    return cands.filter((p) => {
      if (!gomokuMoveLegal(game, board, p.row, p.col, side)) return false;
      const copy = cloneBoard(board);
      copy[p.row][p.col] = side;
      return game.checkWin(copy) === side;
    });
  }

  function gomokuEvalBoard(board, me, enemy, n) {
    let score = 0;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = board[r][c];
        if (!v) continue;
        let lineScore = 0;
        for (const [dr, dc] of G_DIRS) {
          let cnt = 1, open = 0;
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === v) { cnt++; rr += dr; cc += dc; }
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && !board[rr][cc]) open++;
          rr = r - dr; cc = c - dc;
          while (rr >= 0 && rr < n && cc >= 0 && cc < n && board[rr][cc] === v) { cnt++; rr -= dr; cc -= dc; }
          if (rr >= 0 && rr < n && cc >= 0 && cc < n && !board[rr][cc]) open++;
          lineScore += gomokuShape(cnt, open);
        }
        score += v === me ? lineScore : -lineScore * 0.92;
      }
    }
    return score;
  }

  function gomokuOrderedMoves(game, board, side, cands, limit) {
    const enemy = side === 'black' ? 'white' : 'black';
    return cands
      .filter((p) => gomokuMoveLegal(game, board, p.row, p.col, side))
      .map((p) => ({
        ...p,
        score: gomokuPointScore(board, p.row, p.col, side, game.sizeN) * 0.55
          + gomokuPointScore(board, p.row, p.col, enemy, game.sizeN) * 0.45,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function gomokuSearch(game, board, aiSide, maxDepth, deadline) {
    const enemy = aiSide === 'black' ? 'white' : 'black';
    const n = game.sizeN;
    let bestMove = null;
    let bestScore = -Infinity;

    function search(b, depth, alpha, beta, side) {
      if (NOW() > deadline) throw TIMEOUT;
      const win = game.checkWin(b);
      if (win === aiSide) return 100000000 - (maxDepth - depth) * 10;
      if (win === enemy) return -100000000 + (maxDepth - depth) * 10;
      if (depth === 0) return gomokuEvalBoard(b, aiSide, enemy, n);

      const cands = gomokuCandidates(game, b, 1);
      const moves = gomokuOrderedMoves(game, b, side, cands, depth >= 2 ? 8 : 12);
      if (!moves.length) return gomokuEvalBoard(b, aiSide, enemy, n);

      if (side === aiSide) {
        let best = -Infinity;
        for (const m of moves) {
          b[m.row][m.col] = side;
          const v = search(b, depth - 1, alpha, beta, enemy);
          b[m.row][m.col] = null;
          if (v > best) {
            best = v;
            if (depth === maxDepth) bestMove = m;
          }
          alpha = Math.max(alpha, best);
          if (alpha >= beta) break;
        }
        return best;
      } else {
        let best = Infinity;
        for (const m of moves) {
          b[m.row][m.col] = side;
          const v = search(b, depth - 1, alpha, beta, aiSide);
          b[m.row][m.col] = null;
          best = Math.min(best, v);
          beta = Math.min(beta, best);
          if (alpha >= beta) break;
        }
        return best;
      }
    }

    // 限时迭代加深：极难最多搜索 4 层，其余按需
    const maxAllowed = maxDepth;
    let completed = null;
    for (let d = 2; d <= maxAllowed; d += 1) {
      bestMove = null;
      try {
        const b = cloneBoard(board);
        const score = search(b, d, -Infinity, Infinity, aiSide);
        completed = { move: bestMove, score };
      } catch (e) {
        if (e === TIMEOUT) break;
        throw e;
      }
      if (NOW() > deadline) break;
    }
    return completed ? completed.move : bestMove;
  }

  function gomokuDecide(game, state, level, aiSide) {
    const board = cloneBoard(state.board);
    const enemy = aiSide === 'black' ? 'white' : 'black';
    const cands = gomokuCandidates(game, board, 2);

    // 必胜 / 必挡：任何难度都先处理
    const wins = gomokuImmediateWins(game, board, aiSide, cands);
    if (wins.length) return wins[0];
    const blocks = gomokuImmediateWins(game, board, enemy, cands);
    if (blocks.length) {
      blocks.sort((a, b) =>
        gomokuPointScore(board, b.row, b.col, aiSide, game.sizeN) -
        gomokuPointScore(board, a.row, a.col, aiSide, game.sizeN));
      return blocks[0];
    }

    const ordered = gomokuOrderedMoves(game, board, aiSide, cands, 24);
    if (!ordered.length) return cands[0];

    if (level === 'low') return rand(shuffle(ordered.slice(0, 8)));
    if (level === 'medium') return rand(shuffle(ordered.slice(0, 5)));
    if (level === 'high') {
      const top = ordered.slice(0, 3);
      return top[0];
    }
    if (level === 'extreme') {
      const deadline = NOW() + 380;
      const move = gomokuSearch(game, board, aiSide, 4, deadline);
      return move || ordered[0];
    }
    return ordered[0];
  }

  /* ============================ 象棋 ============================ */
  const XQ_VAL = { 帅: 100000, 车: 920, 炮: 440, 马: 430, 仕: 210, 相: 210, 兵: 110 };
  const XQ_POS = {
    兵: (r, c, side) => {
      const crossed = side === 'white' ? r >= 5 : r <= 4;
      if (!crossed) return 0;
      return (side === 'white' ? r * 3 : (9 - r) * 3) + (c >= 3 && c <= 5 ? 8 : 0);
    },
    马: (r, c, side) => (r >= 3 && r <= 6 && c >= 2 && c <= 6 ? 10 : 0),
    车: (r, c, side) => (c >= 3 && c <= 5 ? 8 : 0),
    炮: (r, c, side) => (r >= 2 && r <= 7 ? 5 : 0),
    相: (r, c, side) => (c === 2 || c === 6 ? 3 : 0),
    仕: (r, c, side) => (c === 4 ? 3 : 0),
  };

  function xqPieceVal(p) { return XQ_VAL[p[1]] || 100; }
  function xqEval(game, board, side) {
    const enemy = side === 'black' ? 'white' : 'black';
    let score = 0;
    for (let r = 0; r < game.rows; r++) {
      for (let c = 0; c < game.cols; c++) {
        const p = board[r][c];
        if (!p) continue;
        const base = xqPieceVal(p);
        const pos = (XQ_POS[p[1]] || (() => 0))(r, c, p[0]);
        score += (p[0] === side ? 1 : -1) * (base + pos);
      }
    }
    if (game.isInCheck(board, enemy)) score += 65;
    if (game.isInCheck(board, side)) score -= 70;
    return score;
  }

  function xqMoves(game, board, side, legal) {
    const moves = [];
    for (let fr = 0; fr < game.rows; fr++) {
      for (let fc = 0; fc < game.cols; fc++) {
        const p = board[fr][fc];
        if (!p || p[0] !== side) continue;
        for (let tr = 0; tr < game.rows; tr++) {
          for (let tc = 0; tc < game.cols; tc++) {
            const from = { row: fr, col: fc };
            if (!game.isValidMoveOnBoard(board, tr, tc, side, from)) continue;
            if (legal && !game.isValidMoveFull(board, tr, tc, side, from)) continue;
            moves.push({ from, row: tr, col: tc, captured: board[tr][tc], piece: p });
          }
        }
      }
    }
    return moves;
  }

  function xqApplyMove(board, m) {
    const b = cloneBoard(board);
    b[m.row][m.col] = b[m.from.row][m.from.col];
    b[m.from.row][m.from.col] = null;
    return b;
  }

  function xqSearch(game, board, aiSide, maxDepth, deadline) {
    const enemy = aiSide === 'black' ? 'white' : 'black';
    let bestMove = null;

    function movesFor(b, side) {
      const legal = xqMoves(game, b, side, true);
      legal.sort((a, b2) => (b2.captured ? xqPieceVal(b2.captured) : 0) - (a.captured ? xqPieceVal(a.captured) : 0));
      return legal;
    }

    function search(b, depth, alpha, beta, side) {
      if (NOW() > deadline) throw TIMEOUT;
      if (depth === 0) return xqEval(game, b, aiSide);
      const moves = movesFor(b, side);
      if (!moves.length) return game.isInCheck(b, side) ? -90000 + (maxDepth - depth) : 0;
      const limit = side === aiSide ? (depth >= 3 ? 12 : 16) : (depth >= 3 ? 10 : 14);
      const pool = moves.slice(0, limit);
      if (side === aiSide) {
        let best = -Infinity;
        for (const m of pool) {
          const nb = xqApplyMove(b, m);
          const v = search(nb, depth - 1, alpha, beta, enemy);
          if (v > best) {
            best = v;
            if (depth === maxDepth) bestMove = m;
          }
          alpha = Math.max(alpha, best);
          if (alpha >= beta) break;
        }
        return best;
      } else {
        let best = Infinity;
        for (const m of pool) {
          const nb = xqApplyMove(b, m);
          const v = search(nb, depth - 1, alpha, beta, aiSide);
          best = Math.min(best, v);
          beta = Math.min(beta, best);
          if (alpha >= beta) break;
        }
        return best;
      }
    }

    let completed = null;
    for (let d = 2; d <= maxDepth; d++) {
      bestMove = null;
      try {
        const b = cloneBoard(board);
        const score = search(b, d, -Infinity, Infinity, aiSide);
        completed = { move: bestMove, score };
      } catch (e) {
        if (e === TIMEOUT) break;
        throw e;
      }
      if (NOW() > deadline) break;
    }
    return completed ? completed.move : bestMove;
  }

  function xqDecide(game, state, level, aiSide) {
    const board = cloneBoard(state.board);
    const moves = xqMoves(game, board, aiSide, true);
    if (!moves.length) return null;

    if (level === 'low') {
      const eats = moves.filter((m) => m.captured);
      return rand(shuffle(eats.length ? eats : moves));
    }
    if (level === 'medium') {
      const scored = moves.map((m) => {
        const nb = xqApplyMove(board, m);
        return { m, score: xqEval(game, nb, aiSide) };
      });
      scored.sort((a, b) => b.score - a.score);
      return rand(shuffle(scored.slice(0, 5))).m;
    }
    if (level === 'high') {
      const deadline = NOW() + 360;
      const m = xqSearch(game, board, aiSide, 2, deadline);
      return m || xqDecide(game, state, 'medium', aiSide);
    }
    if (level === 'extreme') {
      const deadline = NOW() + 520;
      const m = xqSearch(game, board, aiSide, 3, deadline);
      return m || xqDecide(game, state, 'high', aiSide);
    }
    return moves[0];
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

  function goGroupAndLibs(game, board, r, c) {
    const side = board[r][c];
    const n = game.sizeN;
    const seen = Array.from({ length: n }, () => Array(n).fill(false));
    const stack = [[r, c]];
    const group = [];
    const libs = new Set();
    while (stack.length) {
      const [rr, cc] = stack.pop();
      if (seen[rr][cc]) continue;
      seen[rr][cc] = true;
      group.push([rr, cc]);
      for (const [nr, nc] of goNeighbors(game, rr, cc)) {
        const v = board[nr][nc];
        if (!v) libs.add(nr + ',' + nc);
        else if (v === side && !seen[nr][nc]) stack.push([nr, nc]);
      }
    }
    return { group, libs: libs.size, side };
  }

  function goSimulateMove(game, board, row, col, side) {
    const copy = cloneBoard(board);
    copy[row][col] = side;
    let captured = 0;
    const enemy = side === 'black' ? 'white' : 'black';
    for (const [nr, nc] of goNeighbors(game, row, col)) {
      if (copy[nr][nc] !== enemy) continue;
      const info = goGroupAndLibs(game, copy, nr, nc);
      if (info.libs === 0) {
        captured += info.group.length;
        for (const [rr, cc] of info.group) copy[rr][cc] = null;
      }
    }
    const own = goGroupAndLibs(game, copy, row, col);
    return { board: copy, captured, myLibs: own.libs, suicide: own.libs === 0 };
  }

  function goInfluence(game, board, row, col, side) {
    let score = 0;
    const n = game.sizeN;
    for (let r = Math.max(0, row - 3); r <= Math.min(n - 1, row + 3); r++) {
      for (let c = Math.max(0, col - 3); c <= Math.min(n - 1, col + 3); c++) {
        const v = board[r][c];
        if (!v) continue;
        const d = Math.abs(r - row) + Math.abs(c - col);
        const w = v === side ? 4 - d : (d - 4) * 0.6;
        score += Math.max(0, w);
      }
    }
    return score;
  }

  function goCandidates(game, board) {
    const n = game.sizeN;
    const stones = [];
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (board[r][c]) stones.push([r, c]);
    const set = new Set();
    const add = (r, c) => { if (r >= 0 && r < n && c >= 0 && c < n && !board[r][c]) set.add(r + ',' + c); };
    if (stones.length < 4) {
      const pts = [Math.floor(n / 2), 3, n - 4];
      for (const r of pts) for (const c of pts) {
        add(r, c); add(r - 1, c); add(r + 1, c); add(r, c - 1); add(r, c + 1);
      }
    }
    for (const [r, c] of stones) {
      const radius = stones.length < 40 ? 2 : 1;
      for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) add(r + dr, c + dc);
    }
    if (!set.size) add(Math.floor(n / 2), Math.floor(n / 2));
    return Array.from(set).map((s) => {
      const [r, c] = s.split(',').map(Number);
      return { row: r, col: c };
    });
  }

  function goDecide(game, state, level, aiSide) {
    const board = state.board;
    const enemy = aiSide === 'black' ? 'white' : 'black';
    const cands = goCandidates(game, board).filter((p) => game.isValidMove(state, p.row, p.col, aiSide));
    if (!cands.length) return null;

    const scored = cands.map((p) => {
      const sim = goSimulateMove(game, board, p.row, p.col, aiSide);
      const influence = goInfluence(game, sim.board, p.row, p.col, aiSide);
      return {
        ...p,
        captured: sim.captured,
        libs: sim.myLibs,
        suicide: sim.suicide,
        influence,
        score: sim.captured * 26 + sim.myLibs * 1.6 + influence * 0.25 - (sim.suicide ? 10000 : 0),
      };
    });
    scored.sort((a, b) => b.score - a.score);

    if (level === 'low') return rand(shuffle(scored.slice(0, 8)));
    if (level === 'medium') return rand(shuffle(scored.slice(0, 5)));
    if (level === 'high') return scored[0];

    // extreme：看一步对手最佳应对，避免明显被吃
    const top = scored.slice(0, 10);
    let best = top[0];
    let bestScore = -Infinity;
    for (const p of top) {
      const after = goSimulateMove(game, board, p.row, p.col, aiSide);
      const afterState = { ...state, board: after.board };
        const enemyCands = goCandidates(game, after.board)
        .filter((ep) => game.isValidMove(afterState, ep.row, ep.col, enemy))
        .slice(0, 6);
      let enemyGain = 0;
      for (const ep of enemyCands) {
        const es = goSimulateMove(game, after.board, ep.row, ep.col, enemy);
        enemyGain = Math.max(enemyGain, es.captured);
      }
      const total = p.score - enemyGain * 14;
      if (total > bestScore) { bestScore = total; best = p; }
    }
    return best;
  }

  /* ============================ 入口 ============================ */
  function decide(game, state, level, aiSide, gameType) {
    if (!LEVELS.includes(level)) level = 'medium';
    try {
      if (gameType === 'gomoku_folk' || gameType === 'gomoku_standard') {
        const m = gomokuDecide(game, state, level, aiSide);
        return m ? { x: m.row, y: m.col, from: null } : null;
      }
      if (gameType === 'xiangqi') {
        const m = xqDecide(game, state, level, aiSide);
        return m ? { x: m.row, y: m.col, from: { row: m.from.row, col: m.from.col } } : null;
      }
      if (gameType === 'go') {
        const m = goDecide(game, state, level, aiSide);
        return m ? { x: m.row, y: m.col, from: null } : null;
      }
    } catch (e) {
      console.warn('[AI] decide error', e);
    }
    return null;
  }

  return { decide, levels: LEVELS };
})();
