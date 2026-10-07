// ECS-126 probe: passively log the device's actual layout code (readback only, never a layout *select*) while you
// switch between Session view and a Custom mode by hand, pressing buttons in each so we can compare what arrives.
// Timer-paced (see the printed schedule) so it can run unattended/in the background.
//
// Usage: node scripts/launchpad-session-vs-custom-probe.mjs
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
Schedule from start (t0):
  t=0s     readback current state
  t=0-20s  switch the device to Session view by hand (any time in this window)
  t=20s    readback Session's layout code
  t=20-50s press pads / top-row / side-column buttons in Session view
  t=50-70s switch the device to a Custom mode by hand
  t=70s    readback the custom mode's layout code
  t=70-100s press pads / top-row / side-column buttons in the custom mode
  t=100s   done
`);

await readback("current, before anything");
await phase("Phase 1 — switch the device to Session view by hand.", 20000);
await readback("Session");
await phase("Phase 2 — press pads, top-row and side-column buttons in Session view.", 30000);
await phase("Phase 3 — now switch the device to a Custom mode by hand.", 20000);
await readback("Custom mode");
await phase("Phase 4 — press pads, top-row and side-column buttons in the Custom mode.", 30000);

console.log("\n>>> done. Run scripts/launchpad-custom-mode-recovery.mjs afterwards to force Programmer mode back on.\n");

midiOut.closePort();
for (const port of openInputs) port.closePort?.();
process.exit(0);
