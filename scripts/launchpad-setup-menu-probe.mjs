// ECS-126 probe: the manual documents a firmware-level escape independent of software SysEx entirely: hold Session
// for ~0.5s to open the Setup menu, then press the bottom-most side-column button (Scene Launch) to force
// Programmer mode. This checks whether that combo actually lands on Programmer mode (readback 7F) regardless of
// current state. Pure readback + listener; never selects a layout itself.
//
// Usage: node scripts/launchpad-setup-menu-probe.mjs
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
const outputs = new midi.Output();
const inputNames = Array.from({ length: inputs.getPortCount() }, (_, i) => inputs.getPortName(i));
const outputNames = Array.from({ length: outputs.getPortCount() }, (_, i) => outputs.getPortName(i));
const inIndex = (re) => inputNames.findIndex((n) => re.test(n));
const outIndex = (re) => outputNames.findIndex((n) => re.test(n));

const dawOutIn = inIndex(/Launchpad Mini MK3.*DAW Out/);
const midiOutIn = inIndex(/Launchpad Mini MK3.*MIDI Out/);
const midiIn = outIndex(/Launchpad Mini MK3.*MIDI In/);
if ([dawOutIn, midiOutIn, midiIn].some((i) => i < 0)) {
  console.error("Launchpad Mini MK3 ports missing. Inputs:", inputNames, "Outputs:", outputNames);
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

const midiOut = new midi.Output();
midiOut.openPort(midiIn);
const send = (name, bytes) => {
  console.log(`[${stamp()}] out MIDI In  ${name}: ${hex(bytes)}`);
  midiOut.sendMessage(bytes);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const readback = async (label) => {
  send(`readback layout (${label})`, [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0xf7]);
  await pause(600);
  send(`readback DAW mode (${label})`, [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0xf7]);
  await pause(600);
};
const phase = async (text, ms) => {
  console.log(`\n>>> ${text} (${ms / 1000}s)\n`);
  await pause(ms);
};

console.log(`
Manual says: hold Session for ~0.5s to open the Setup menu, then press the bottom-most
side-column button (Scene Launch) to force Programmer mode — independent of any SysEx.

Schedule from start (t0):
  t=0s      readback current state
  t=0-15s   get the device into whatever state you want to test escaping from
            (a Custom mode, Session, DAW Faders — your call)
  t=15s     readback that state, for the record
  t=15-35s  perform the combo: hold Session ~0.5s+, then tap the bottom side-column button
  t=35s     readback again, to see whether it landed on Programmer mode (7F)
`);

await readback("current, before anything");
await phase("Phase 1 — get the device into the state you want to test escaping from.", 15000);
await readback("state to escape from");
await phase("Phase 2 — hold Session (~0.5s+), then tap the bottom side-column button (Scene Launch).", 20000);
await readback("after the Setup-menu combo");

console.log("\n>>> done. Did the final readback land on layout 7F (Programmer)?\n");

midiOut.closePort();
for (const port of openInputs) port.closePort?.();
process.exit(0);
