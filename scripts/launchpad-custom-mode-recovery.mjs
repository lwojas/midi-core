// ECS-126 probe: once the device has silently switched into a native custom mode (not Programmer, not the DAW
// Fader layout), can a software-sent SysEx still recover Programmer mode? Session/custom-mode switches on this
// device produce no MIDI message at all (docs/hardware-validation.md), so this checks whether the *outgoing*
// recovery commands still land even though the *incoming* state can't be observed.
//
// Usage: node scripts/launchpad-custom-mode-recovery.mjs [waitSeconds=20]
//
// Procedure:
//   1. Run this script.
//   2. During the wait window: on the device, enter DAW Fader view, then switch to a custom mode.
//   3. After the wait, the script sends readbacks, then a recovery attempt (enter-programmer-mode SysEx, DAW mode
//      off, Programmer layout select), then readbacks again, so the before/after state can be compared.
import midi from "@julusian/midi";

const waitSeconds = Number(process.argv[2] ?? 20);

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
const dawIn = outIndex(/Launchpad Mini MK3.*DAW In/);
const midiIn = outIndex(/Launchpad Mini MK3.*MIDI In/);
if ([dawOutIn, midiOutIn, dawIn, midiIn].some((i) => i < 0)) {
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

console.log(`listening on "${inputNames[dawOutIn]}" and "${inputNames[midiOutIn]}"`);
console.log(`\n>>> you have ${waitSeconds}s: on the device, enter DAW Fader view, then switch to a custom mode.\n`);
await pause(waitSeconds * 1000);

console.log("\n>>> window over. Reading back current state (sent on MIDI In) before attempting recovery.\n");
send("readback DAW mode", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0xf7]);
await pause(800);
send("readback layout", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0xf7]);
await pause(800);

console.log("\n>>> attempting recovery.\n");
send("enter-programmer-mode (0E 01)", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x0e, 0x01, 0xf7]);
await pause(500);
send("disable DAW mode (10 00)", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x00, 0xf7]);
await pause(500);
send("select Programmer layout (00 7F)", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x7f, 0xf7]);
await pause(800);

console.log("\n>>> reading back state after recovery.\n");
send("readback DAW mode", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0xf7]);
await pause(800);
send("readback layout", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0xf7]);
await pause(800);

console.log("\n>>> done. Compare the readback replies above/below the recovery attempt, and check the pads/buttons by hand.\n");

midiOut.closePort();
for (const port of openInputs) port.closePort?.();
process.exit(0);
