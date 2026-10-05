import type { Unsubscribe } from "../../core/types/discovery.js";
import type { DeviceProfile } from "../../profile/types/profile.js";
import type { SurfaceError } from "./errors.js";
import type { SurfaceLifecycleChange, SurfaceLifecycleState } from "./lifecycle.js";
import type { SurfaceNavigation } from "./navigation.js";

/**
 * The minimal runtime shape for a Control Surface's lifecycle: attach,
 * detach, and observe both state and error, over whatever ports and
 * device setup its `profile` declares. Deliberately as small as Core's own
 * `MidiConnection` — which ports to connect, how to resolve them from
 * discovery, and how any `ControlMapping`s get bound are all composed
 * around this, not inside it:
 *
 * - **Port resolution** (matching `profile.ports` against real discovered
 *   ports) happens before a `ControlSurface` is constructed — the same
 *   "not this schema's job" stance `docs/contracts/device-profile.md`
 *   already takes on profile-to-port matching. This contract assumes it's
 *   already done.
 * - **Binding `ControlMapping`s** is not part of `attach()`/`detach()`.
 *   `docs/control-surface-architecture.md` already describes mode
 *   switching as unbinding/binding a mapping set around a lifecycle
 *   event, not inside the lifecycle contract itself; this interface names
 *   the moment that happens — `onStateChange` entering `"attached"` is
 *   when bindings should be installed, entering `"detaching"` is when
 *   they should be torn down — without deciding how a binding set is
 *   authored or produced (ECS-68) or which mode is active (ECS-67).
 * - **`navigation`** (`docs/contracts/surface-navigation.md`, ECS-67) is
 *   the surface's own mode/bank/page state — independent of lifecycle:
 *   it exists for the `ControlSurface`'s whole lifetime, not reset or
 *   reinitialized by `attach()`/`detach()`, since a mode switch or a page
 *   turn is not itself a connection event.
 *
 * `attach()` connects every port `profile.ports` marks `required`, then runs
 * `profile.setup`'s steps (if declared) on those ports, in order
 * (`docs/contracts/device-setup.md`). A failed step fails the attach with a
 * `SurfaceError` (`"setup-failed"` or `"setup-timeout"`) rather than skipping
 * silently. `detach()` disconnects those same ports after giving a caller the
 * `"detaching"` notification to unbind whatever it bound.
 *
 * While `"attached"`, a composed port leaving `connected` on its own
 * (hardware unplugged, not a requested `detach()`) moves the surface
 * straight to `"error"` — a spontaneously discovered failure, not a
 * graceful `"detaching"` — mirroring the distinction Core's own
 * `ConnectionState` already draws between `error` and `disconnecting`.
 */
export interface ControlSurface {
  readonly profile: DeviceProfile;
  readonly state: SurfaceLifecycleState;
  readonly navigation: SurfaceNavigation;

  attach(): Promise<void>;
  detach(): Promise<void>;

  onStateChange(listener: (change: SurfaceLifecycleChange) => void): Unsubscribe;
  onError(listener: (error: SurfaceError) => void): Unsubscribe;
}
