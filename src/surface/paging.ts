import type { ControlRegistry } from "../control-api/types/registry.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import type { GridOffset } from "./types/navigation.js";
import type { SurfaceBindingTable, WindowedControlBinding } from "./types/bindings.js";

/**
 * The paging limits for a surface's shared window onto a sequence (ECS-89, ECS-95). Paging never goes before the
 * first column or row. It also stops at the last window that still shows the end of the sequence, once the
 * sequence length (`columnCountControl`) and the track count (`rowCountControl`) are known from the application.
 */
export function sequenceClamp(table: SurfaceBindingTable, profile: DeviceProfile, registry: ControlRegistry): (offset: GridOffset) => GridOffset {
  const windows = table.flatMap((definition) => definition.bindings ?? []).filter((binding): binding is WindowedControlBinding => binding.kind === "window");
  const columnWindow = windows.find((binding) => binding.columnCountControl !== undefined);
  const rowWindow = windows.find((binding) => binding.rowCountControl !== undefined);

  // How many cells the window spans along one of its virtual axes: a horizontal window swaps the grid's axes (ECS-95).
  const span = (binding: WindowedControlBinding | undefined, axis: "row" | "column"): number => {
    const grid = profile.grids?.find((candidate) => candidate.id === binding?.gridId);
    if (!grid) return 0;
    const alongRows = (axis === "row") !== (binding?.orientation === "horizontal");
    return alongRows ? grid.rows : grid.columns;
  };
  const lastOffset = (countControl: string | undefined, cells: number): number => {
    if (countControl === undefined) return Number.POSITIVE_INFINITY;
    const count = registry.getControl(countControl)?.getValue();
    return typeof count === "number" ? Math.max(0, count - cells) : Number.POSITIVE_INFINITY;
  };

  return (offset) => {
    const lastRow = lastOffset(rowWindow?.rowCountControl, span(rowWindow, "row"));
    const lastColumn = lastOffset(columnWindow?.columnCountControl, span(columnWindow, "column"));
    return {
      row: Math.min(lastRow, Math.max(0, offset.row)),
      column: Math.min(lastColumn, Math.max(0, offset.column)),
    };
  };
}
