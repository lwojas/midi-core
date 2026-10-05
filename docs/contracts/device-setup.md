# Device Setup

Status: Draft
Linear: [ECS-89](https://linear.app/ecs3d/issue/ECS-89) (device setup decision), resolves [ECS-79](https://linear.app/ecs3d/issue/ECS-79/select-and-validate-one-real-device-with-the-surface-runtime) F3
Replaces: the `DeviceHandshake` / `HandshakeExecutor` design in `device-profile.md` and `surface-lifecycle.md`
Source of truth: [`src/profile/types/setup.ts`](../../src/profile/types/setup.ts),
[`src/surface/setup.ts`](../../src/surface/setup.ts)

## Purpose

Some devices need messages sent before they behave as their profile describes:
a Launchpad must be switched into Programmer mode, and a device may be asked to
identify itself. Setup is the declared list of those messages. The profile holds
the bytes, and the surface runs them on connect. No per-device code is needed to
perform them, and the device's vendor knowledge stays in its profile.

"Setup" rather than "handshake" because most steps are not a conversation. A
Programmer-mode switch sends bytes and expects nothing back. An identity request
is one kind of step, among others.

## Schema

```ts
interface DeviceSetup {
  inputPortId: string;   // input port replies arrive on
  outputPortId: string;  // output port send steps go out on
  timeoutMs?: number;    // how long an expect step waits; default 2000 ms
  steps: DeviceSetupStep[];
}

interface DeviceSetupStep {
  id: string;
  description: string;   // warning if empty
  send?: number[];       // bytes to send verbatim (SysEx includes F0 and F7)
  expect?: (number | null)[]; // bytes a reply must match; null matches any byte
}
```

A step is exactly one of `send` or `expect`. Steps run in order.

## Runtime

`attach()` connects the required ports, then runs `profile.setup` on them, then
installs the initial mode. A failed step fails the attach with a `SurfaceError`,
and the surface moves to `"error"`.

- `send`: wrapped as SysEx if it starts with `F0`, otherwise as an unknown raw
  message, and sent on `outputPortId`.
- `expect`: succeeds on the first received message whose bytes match the pattern
  in length and in every non-null position. Non-matching messages are ignored.
  Replies received before the step starts are buffered and still match, so a
  reply can't be lost by timing.
- Errors: `"setup-failed"` (a send could not be made, or a step is malformed) and
  `"setup-timeout"` (an expect step got no matching reply in time). Both carry a
  `cause` where one exists.
- `detach()` does not run anything; it disconnects as before.

## Validation

`validateDeviceProfile()` reports: a setup that doesn't name a `steps` array or
both ports (`invalid-setup`); a step with neither or both of `send` and `expect`
(`setup-step-needs-send-or-expect`); bytes outside 0-255, or `null` in a `send`
(`setup-byte-out-of-range`); a SysEx `send` not ending in `F7`
(`setup-sysex-unterminated`); a port that is missing (`dangling-port-reference`),
the wrong direction (`setup-port-wrong-type`), or not `required`
(`setup-port-not-required`); and a step with no description (warning,
`setup-step-missing-description`).

## What this replaces

- `DeviceHandshake` (`required`, `steps` with `direction` and no bytes) is removed.
- `HandshakeExecutor` is removed. The surface sends and matches bytes itself,
  because the bytes are now in the profile.
- The `required` gate is removed. Declared setup always runs, which is why a
  profile can't silently skip the mode switch its addressing depends on.

## Not in this contract

- Device-wide configuration commands (brightness, LED feedback toggles) that
  aren't tied to connecting. These need a separate concept, not setup.
- Re-running setup on a mode change. Setup is connection-time only.
- Retries. A failed setup fails the attach, and the caller decides what to do.
