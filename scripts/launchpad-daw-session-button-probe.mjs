// ECS-126 probe: enter midi-core's own DAW mode exactly as the profile does (DAW mode on, then the DAW Fader
// layout), confirm it's active, then see what happens on the wire when you press the now-lit Session button and a
// Custom-mode button *while DAW mode is genuinely active* — as opposed to the earlier probes, which tested pressing
// them from plain Programmer mode. This is the scenario the ticket actually describes.
//
// Usage: node scripts/launchpad-daw-session-button-probe.mjs
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
  t=0s      enter DAW mode + DAW Fader layout, exactly as the profile's "activate"/"showLayout" do
  t=1.5s    readback to confirm (expect layout 0D, DAW mode 01)
  t=1.5-20s press the Session button once (should be lit) and watch what arrives
  t=20-40s  press a Custom-mode button once (if labelled) and watch what arrives
  t=40s     readback again, to see whether DAW mode/layout survived
  t=42s     done — device is left in whatever state it ends in; recovery script available after
`);

send("DAW mode on (profile activate[0])", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x01, 0xf7]);
await pause(500);
send("select DAW Fader layout (profile showLayout)", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x0d, 0xf7]);
await pause(500);
await readback("after entering DAW mode");

await phase("Phase 1 — Session button should be lit now. Press it once.", 18500);
await phase("Phase 2 — press a Custom-mode button once, if the device has one labelled.", 20000);

await readback("after button presses");

console.log("\n>>> done. If layout/DAW-mode above no longer reads 0D/01, the buttons knocked it out of DAW mode. Run scripts/launchpad-custom-mode-recovery.mjs if you need Programmer mode back.\n");

midiOut.closePort();
for (const port of openInputs) port.closePort?.();
process.exit(0);
