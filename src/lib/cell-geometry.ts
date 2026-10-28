import type { Cell, Frame } from './data';

export type IndexedCell = Cell & { index: number };

/** Rebuild the polygon list only when its finite-value mask changes, never for new values alone. */
export function createCellGeometry(cells: readonly Cell[]) {
  const grid: IndexedCell[] = cells.map((cell, index) => ({ ...cell, index }));
  let visible = grid;
  function forFrame(frame: Frame | null): IndexedCell[] {
    // A missing month hides the layer; keep its geometry ready for the next observation.
    if (!frame) return visible;
    let count = 0;
    let changed = false;
    for (let index = 0; index < grid.length; index++) {
      if (!Number.isFinite(frame.values[index])) continue;
      if (visible[count]?.index !== index) changed = true;
      count++;
    }
    if (changed || count !== visible.length) visible = grid.filter(cell => Number.isFinite(frame.values[cell.index]));
    return visible;
  }
  return { forFrame };
}
