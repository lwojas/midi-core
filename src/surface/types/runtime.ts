import type { Unsubscribe } from "../../core/types/discovery.js";
import type { DeviceProfile } from "../../profile/types/profile.js";
import type { HandshakeStep } from "../../profile/types/handshake.js";
import type { SurfaceError } from "./errors.js";
import type { SurfaceLifecycleChange, SurfaceLifecycleState } from "./lifecycle.js";

/**
 * Performs one `HandshakeStep` a device profile declares (`sent`: send
 * whatever that step means; `expect`: wait for the device's reply). A
 * profile only describes a handshake exists and each step's intent
 * (`docs/contracts/device-profile.md`'s `DeviceHandshake`/`HandshakeStep`)
 * — it carries no message bytes, because modeling those is real protocol
 * work deliberately deferred to a composition model (ECS-40) that doesn't
 * exist yet. A `HandshakeExecutor` is therefore supplied by whoever
 * constructs a `ControlSurface` for a specific device (device-specific
 * knowledge), not derived by this contract from the profile alone.
 */
export interface HandshakeExecutor {
  performStep(step: HandshakeStep): Promise<void>;
}

/**
 * The minimal runtime shape for a Control Surface's lifecycle: attach,
 * detach, and observe both state and error, over whatever ports and
 * handshake its `profile` declares. Deliberately as small as Core's own
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
 *
 * `attach()` connects every port `profile.ports` marks `required`, then
 * runs `profile.handshake`'s steps (if `required`) through `executor` —
 * failing with a `SurfaceError` (`"handshake-unsupported"`) rather than
 * silently skipping it if the profile requires a handshake and no
 * `executor` was supplied, the same "report, never invented or guessed"
 * stance `docs/contracts/profile-validation.md` takes elsewhere. `detach()`
 * disconnects those same ports after giving a caller the `"detaching"`
 * notification to unbind whatever it bound.
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

  attach(): Promise<void>;
  detach(): Promise<void>;

  onStateChange(listener: (change: SurfaceLifecycleChange) => void): Unsubscribe;
  onError(listener: (error: SurfaceError) => void): Unsubscribe;
}
