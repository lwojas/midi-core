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

  const gridOf = (binding: WindowedControlBinding | undefined) => profile.grids?.find((grid) => grid.id === binding?.gridId);
  const lastOffset = (countControl: string | undefined, cells: number | undefined): number => {
    if (countControl === undefined) return Number.POSITIVE_INFINITY;
    const count = registry.getControl(countControl)?.getValue();
    return typeof count === "number" ? Math.max(0, count - (cells ?? 0)) : Number.POSITIVE_INFINITY;
  };

  return (offset) => {
    const lastRow = lastOffset(rowWindow?.rowCountControl, gridOf(rowWindow)?.rows);
    const lastColumn = lastOffset(columnWindow?.columnCountControl, gridOf(columnWindow)?.columns);
    return {
      row: Math.min(lastRow, Math.max(0, offset.row)),
      column: Math.min(lastColumn, Math.max(0, offset.column)),
    };
  };
}
