// ルール(generator/src/NumberMatch/Rules.hs の移植)。
// 正本は Haskell 側。関数名・意味をそろえ、web/test/rules.test.js で一致を確かめる。
//
// ボード面 board は数字の配列(読み順)。0 が空マス、1〜9 が数字。
// Haskell の Cell(Empty | Num n)を、JSON と同じ「0 か 1〜9」で表している。

export const WIDTH = 9;

export const rowOf = (p) => Math.floor(p / WIDTH);
export const colOf = (p) => p % WIDTH;

/** 2 つの数字が組になれるか: 同じ数字、または合計が 10。 */
export function matches(a, b) {
  return a === b || a + b === 10;
}

/** 添字 p のマス(範囲外は空扱い)。 */
export function cellAt(board, p) {
  return p < 0 || p >= board.length ? 0 : board[p];
}

/**
 * 位置 i と j (i < j) がつながっているか。
 * 読み順(step 1)・縦(step 9)・右下斜め(step 10)・左下斜め(step 8)のどれかで、
 * 途中のマスが全部空なら true。斜めは列の差で「行をまたぐ偽物」を弾く。
 */
export function connected(board, i, j) {
  const dr = rowOf(j) - rowOf(i);
  const dc = colOf(j) - colOf(i);
  const clear = (step) => {
    if ((j - i) % step !== 0) return false;
    for (let p = i + step; p < j; p += step) {
      if (cellAt(board, p) !== 0) return false;
    }
    return true;
  };
  return (
    clear(1) ||
    (dc === 0 && clear(WIDTH)) ||
    (dc === dr && clear(WIDTH + 1)) ||
    (dc === -dr && clear(WIDTH - 1))
  );
}

/** いま消せるペアの一覧 [[i, j], ...] (i < j、i の昇順・j の昇順)。 */
export function validPairs(board) {
  const pairs = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) continue;
    for (let j = i + 1; j < board.length; j++) {
      if (board[j] === 0) continue;
      if (matches(board[i], board[j]) && connected(board, i, j)) pairs.push([i, j]);
    }
  }
  return pairs;
}

/** 2 マスを空にする(行の縮約はしない)。元の配列は変えず新しい配列を返す。 */
export function removePair(i, j, board) {
  return board.map((c, p) => (p === i || p === j ? 0 : c));
}

/** ボードを行(長さ 9 の配列)に切り分ける。最後の行は短いことがある。 */
export function rows(board) {
  const out = [];
  for (let p = 0; p < board.length; p += WIDTH) out.push(board.slice(p, p + WIDTH));
  return out;
}

/** 全部空になった行を取り除く。 */
export function collapseRows(board) {
  return rows(board)
    .filter((row) => !row.every((c) => c === 0))
    .flat();
}

/** 残っている数字(読み順)。 */
export function numbers(board) {
  return board.filter((c) => c !== 0);
}

/** 残っている数字を読み順のまま末尾に足す。末尾の空マスは詰めてから足す。 */
export function addNumbers(board) {
  let end = board.length;
  while (end > 0 && board[end - 1] === 0) end--;
  return board.slice(0, end).concat(numbers(board));
}

export function isCleared(board) {
  return numbers(board).length === 0;
}

/**
 * パリティ不変量: 追加なしで全消しできるための必要条件。
 * d と 10-d の個数の合計が偶数(d = 5 は 5 の個数が偶数)。
 */
export function parityOk(board) {
  const count = (d) => board.filter((c) => c === d).length;
  for (let d = 1; d <= 4; d++) if ((count(d) + count(10 - d)) % 2 !== 0) return false;
  return count(5) % 2 === 0;
}
