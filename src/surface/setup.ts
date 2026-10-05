import type { MidiOutput } from "../core/types/output.js";
import type { DeviceSetup, DeviceSetupStep } from "../profile/types/setup.js";
import type { SurfacePorts } from "./bindings.js";
import type { SurfaceError } from "./types/errors.js";

export const DEFAULT_SETUP_TIMEOUT_MS = 2000;

function matchesPattern(bytes: Uint8Array, pattern: readonly (number | null)[]): boolean {
  return bytes.length === pattern.length && pattern.every((expected, index) => expected === null || bytes[index] === expected);
}

/**
 * Runs a profile's declared device setup in order. A `send` step goes out on
 * the setup's output port. An `expect` step waits on the input port for a
 * message matching its pattern, failing with `"setup-timeout"` after
 * `timeoutMs`. Non-matching messages are ignored, not consumed.
 *
 * Every message received during setup is buffered, so a reply that arrives
 * before its `expect` step starts (a synchronous loopback, or a device that
 * answers quickly) still matches. Callers connect the ports first; `attach()`
 * does this.
 */
export async function runDeviceSetup(setup: DeviceSetup, ports: SurfacePorts): Promise<void> {
  const input = ports.inputs[setup.inputPortId];
  const output = ports.outputs[setup.outputPortId];
  if (!input || !output) {
    throw { code: "port-unavailable", message: `Setup ports "${setup.inputPortId}" and "${setup.outputPortId}" were not both supplied.` } satisfies SurfaceError;
  }

  const timeoutMs = setup.timeoutMs ?? DEFAULT_SETUP_TIMEOUT_MS;
  const received: Uint8Array[] = [];
  let cursor = 0; // first buffered message no expect step has consumed yet
  let pending: PendingReply | undefined;
  const unsubscribe = input.onMessage((message) => {
    if (message.raw === undefined) return;
    received.push(message.raw);
    if (pending && matchesPattern(message.raw, pending.pattern)) {
      const { resolve } = pending;
      pending = undefined;
      cursor = received.length;
      resolve();
    }
  });

  try {
    for (const step of setup.steps) {
      if (step.send) {
        sendStep(step, output);
      } else if (step.expect) {
        const buffered = received.findIndex((bytes, index) => index >= cursor && matchesPattern(bytes, step.expect!));
        if (buffered >= 0) {
          cursor = buffered + 1;
        } else {
          await awaitReply(step, timeoutMs, (waiting) => (pending = waiting));
        }
      } else {
        throw { code: "setup-failed", message: `Setup step "${step.id}" has neither send nor expect.` } satisfies SurfaceError;
      }
    }
  } finally {
    unsubscribe();
  }
}

function sendStep(step: DeviceSetupStep, output: MidiOutput): void {
  const raw = Uint8Array.from(step.send!);
  try {
    output.send(raw[0] === 0xf0 ? { type: "sysex", raw } : { type: "unknown", raw });
  } catch (cause) {
    throw { code: "setup-failed", message: `Setup step "${step.id}" could not be sent.`, cause } satisfies SurfaceError;
  }
}

type PendingReply = { pattern: readonly (number | null)[]; resolve: () => void };

function awaitReply(step: DeviceSetupStep, timeoutMs: number, setPending: (waiting: PendingReply | undefined) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      setPending(undefined);
      reject({ code: "setup-timeout", message: `Setup step "${step.id}" got no reply matching the expected bytes within ${timeoutMs} ms.` } satisfies SurfaceError);
    }, timeoutMs);
    setPending({
      pattern: step.expect!,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
    });
  });
}
