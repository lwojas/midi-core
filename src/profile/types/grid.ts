/**
 * A 2D layout grouping existing physical controls — e.g. an 8x8 pad grid —
 * without redefining them. A grid is purely a layout over `PhysicalControl`s
 * already declared on the profile (`GridCell.controlId` references one by
 * id); it carries no address or feedback info of its own, since each cell's
 * control already has both. Whether every cell resolves to a real control,
 * and whether the grid's declared size matches its cells, is left to
 * ECS-42 — this schema only names the shape.
 */

export interface GridCell {
  readonly row: number; // 0-based
  readonly column: number; // 0-based
  /** The `PhysicalControl.id` occupying this cell. */
  readonly controlId: string;
}

export interface ControlGrid {
  readonly id: string;
  readonly label: string;
  readonly rows: number;
  readonly columns: number;
  readonly cells: readonly GridCell[];
}
