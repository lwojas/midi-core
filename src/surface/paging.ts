import type { ControlRegistry } from "../control-api/types/registry.js";
import type { DeviceProfile } from "../profile/types/profile.js";
import type { GridOffset } from "./types/navigation.js";
import type { SurfaceBindingTable, WindowedControlBinding } from "./types/bindings.js";

/**
 * The paging limits for a surface's shared window onto a sequence (ECS-89). Paging never goes before the
 * first column. It also stops at the last window that still shows the end of the sequence, once the
 * sequence length is known from the window's `columnCountControl`.
 */
export function sequenceClamp(table: SurfaceBindingTable, profile: DeviceProfile, registry: ControlRegistry): (offset: GridOffset) => GridOffset {
  const windows = table.flatMap((definition) => definition.bindings ?? []).filter((binding): binding is WindowedControlBinding => binding.kind === "window");
  const window = windows.find((binding) => binding.columnCountControl !== undefined);

  return (offset) => {
    const row = Math.max(0, offset.row);
    if (!window?.columnCountControl) return { row, column: Math.max(0, offset.column) };

    const columns = profile.grids?.find((grid) => grid.id === window.gridId)?.columns ?? 0;
    const length = registry.getControl(window.columnCountControl)?.getValue();
    const lastColumn = typeof length === "number" ? Math.max(0, length - columns) : Number.POSITIVE_INFINITY;
    return { row, column: Math.min(lastColumn, Math.max(0, offset.column)) };
  };
}
