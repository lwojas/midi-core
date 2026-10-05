/**
 * Which of a device's controls play which sequencer role (ECS-90). A profile says what a device has (controls,
 * grids); its layout says which of those controls the application's surface uses for what. Every id here names a
 * `PhysicalControl` on the same profile. A device with no layout still works: the configuration reports that and
 * builds the rest of its surface.
 *
 * The step grid is not named here. It is the profile's grid with `paging`, and track mutes are that grid's top row.
 */
export interface ModeButtonRole {
  /** The `PhysicalControl.id` of the button. */
  readonly controlId: string;
  /** The surface mode this button switches to. */
  readonly mode: string;
}

export interface TransportRoles {
  readonly play?: string;
  readonly stop?: string;
  readonly record?: string;
  readonly clear?: string;
}

export interface DeviceLayout {
  /** Mode buttons, in order. Each switches the surface to its mode and is available in every mode. */
  readonly modeButtons?: readonly ModeButtonRole[];
  /**
   * Page buttons, one each side of the grid. Left and right page through time (steps); up and down page through
   * tracks (rows). A side left out has no page binding.
   */
  readonly pageLeft?: string;
  readonly pageRight?: string;
  readonly pageUp?: string;
  readonly pageDown?: string;
  /** Transport buttons. A button left out has no binding. */
  readonly transport?: TransportRoles;
}
