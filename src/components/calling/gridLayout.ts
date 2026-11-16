/**
 * Best-fit video grid (the Meet / Teams approach): try every column count
 * and keep the one that gives the biggest 16:9 tiles that still fit the
 * stage in both directions. Nobody gets cut off, whatever the window size.
 */
export interface GridLayout {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

export function bestGridLayout(
  count: number,
  width: number,
  height: number,
  gap: number,
  aspect = 16 / 9,
): GridLayout {
  const n = Math.max(1, Math.floor(count));
  let best: GridLayout = { cols: 1, rows: n, tileWidth: 0, tileHeight: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const maxW = (width - gap * (cols - 1)) / cols;
    const maxH = (height - gap * (rows - 1)) / rows;
    if (maxW <= 0 || maxH <= 0) continue;
    const tileWidth = Math.floor(Math.min(maxW, maxH * aspect));
    const tileHeight = Math.floor(tileWidth / aspect);
    if (tileWidth > best.tileWidth) best = { cols, rows, tileWidth, tileHeight };
  }
  return best;
}
