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
  /**
   * The same physical button's control id on the device's main input, when `controlId` names a control on a
   * different port (ECS-126). Some devices can be forced back to their stock input/output pair by the user, outside
   * any message the surface sees — the Launchpad Mini MK3's Setup-menu combo (hold Session, then the bottom
   * side-column button) always returns Programmer mode, documented in `docs/hardware-validation.md`. That silently
   * moves this button's reports from `controlId`'s port back to the main one, so a mode whose own exit control lives
   * on a different port would otherwise never hear it again. Binding `recoveryControlId` too means the same button's
   * press still reaches the surface however the device is currently reporting it, resyncing navigation instead of
   * leaving it stuck on a mode whose own port has gone quiet.
   */
  readonly recoveryControlId?: string;
}

export interface TransportRoles {
  readonly play?: string;
  readonly stop?: string;
  readonly record?: string;
  readonly clear?: string;
}

/**
 * Bank buttons (ECS-114). `previous` and `next` step through the banks; `select` has one button per bank, keyed by the
 * bank's index (0 = A). A button left out has no binding. A device sends these as a note or a CC; the profile's own
 * `input` says which, and the application never sees the difference.
 */
export interface BankRoles {
  readonly previous?: string;
  readonly next?: string;
  readonly select?: Readonly<Record<number, string>>;
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
  /** Bank buttons (ECS-114). A device with none has no bank binding. */
  readonly bank?: BankRoles;
}
