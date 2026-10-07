// ECS-126 probe: does the Logo control (CC 99) actually report a press as input, and if so, does it keep
// reporting once the device has switched into a native custom mode? Pure listener, sends nothing, so it can't
// itself change device state — only the phase prompts tell you what to do by hand.
//
// Usage: node scripts/launchpad-logo-probe.mjs
import midi from "@julusian/midi";

const t0 = Date.now();
const stamp = () => `${String(Date.now() - t0).padStart(6)}ms`;
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");
const describe = (bytes) => {
  if (bytes[0] === 0xf0) return `SysEx ${hex(bytes)}`;
  const status = bytes[0] & 0xf0;
  const channel = (bytes[0] & 0x0f) + 1;
  const names = { 0x80: "note-off", 0x90: "note-on", 0xb0: "cc", 0xd0: "chan-pressure", 0xa0: "poly-pressure" };
  return `${names[status] ?? hex([bytes[0]])} ch${channel} ${hex(bytes.slice(1))}`;
};

const inputs = new midi.Input();
const inputNames = Array.from({ length: inputs.getPortCount() }, (_, i) => inputs.getPortName(i));
const inIndex = (re) => inputNames.findIndex((n) => re.test(n));

const dawOutIn = inIndex(/Launchpad Mini MK3.*DAW Out/);
const midiOutIn = inIndex(/Launchpad Mini MK3.*MIDI Out/);
if ([dawOutIn, midiOutIn].some((i) => i < 0)) {
  console.error("Launchpad Mini MK3 ports missing. Inputs:", inputNames);
  process.exit(1);
}

const label = { [dawOutIn]: "DAW Out", [midiOutIn]: "MIDI Out" };
const openInputs = [];
for (const index of [dawOutIn, midiOutIn]) {
  const port = new midi.Input();
  port.ignoreTypes(false, true, true); // keep SysEx
  port.on("message", (_dt, bytes) => {
    console.log(`[${stamp()}] in  ${label[index].padEnd(8)} ${describe(Uint8Array.from(bytes))}`);
  });
  port.openPort(index);
  openInputs.push(port);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const phase = async (text, ms) => {
  console.log(`\n>>> ${text} (${ms / 1000}s)\n`);
  await pause(ms);
};

await phase("Phase 1 — device should be in Programmer mode. Press the Logo button a couple of times.", 8000);
await phase("Phase 2 — on the device, enter DAW Fader view.", 5000);
await phase("Phase 3 — now switch to a custom mode.", 5000);
await phase("Phase 4 — press the Logo button a couple of times, while still in the custom mode.", 8000);

console.log("\n>>> done. Check above: did CC 99 (or anything) appear during phase 1 and/or phase 4?\n");

for (const port of openInputs) port.closePort?.();
process.exit(0);
