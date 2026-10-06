// ECS-96 spike: which Launchpad Mini MK3 port accepts DAW mode and the DAW Fader layout, and do fader moves arrive on channel 5?
// Usage: node scripts/launchpad-daw-spike.mjs <midi|daw> [seconds=15]
//   midi = send the SysEx on "MIDI In" (the port the sequencer's Programmer mode uses)
//   daw  = send the SysEx on "DAW In"
// Logs every message from both input ports with a timestamp, so readbacks and fader moves can be compared per port.
import midi from "@julusian/midi";

const sendTo = process.argv[2];
const seconds = Number(process.argv[3] ?? 15);
if (sendTo !== "midi" && sendTo !== "daw") {
  console.error("usage: node scripts/launchpad-daw-spike.mjs <midi|daw> [seconds=15]");
  process.exit(1);
}

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

const dawOut = inIndex(/Launchpad Mini MK3.*DAW Out/);
const midiOut = inIndex(/Launchpad Mini MK3.*MIDI Out/);
const dawIn = outIndex(/Launchpad Mini MK3.*DAW In/);
const midiIn = outIndex(/Launchpad Mini MK3.*MIDI In/);
if ([dawOut, midiOut, dawIn, midiIn].some((i) => i < 0)) {
  console.error("Launchpad Mini MK3 ports missing. Inputs:", inputNames, "Outputs:", outputNames);
  process.exit(1);
}

const label = { [dawOut]: "DAW Out", [midiOut]: "MIDI Out" };
const counts = { cc5: 0 };
for (const index of [dawOut, midiOut]) {
  const port = new midi.Input();
  port.ignoreTypes(false, true, true); // keep SysEx
  port.on("message", (_dt, bytes) => {
    const message = Uint8Array.from(bytes);
    if ((message[0] & 0xf0) === 0xb0 && (message[0] & 0x0f) === 4) counts.cc5++;
    console.log(`[${stamp()}] in  ${label[index].padEnd(8)} ${describe(message)}`);
  });
  port.openPort(index);
}

const sendOut = new midi.Output();
const sendIndex = sendTo === "midi" ? midiIn : dawIn;
sendOut.openPort(sendIndex);
const send = (name, bytes) => {
  console.log(`[${stamp()}] out ${sendTo === "midi" ? "MIDI In " : "DAW In  "} ${name}: ${hex(bytes)}`);
  sendOut.sendMessage(bytes);
};
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`sending on "${sendTo === "midi" ? outputNames[midiIn] : outputNames[dawIn]}"; listening on both inputs`);
await pause(300);

// Readback of DAW mode, then enable it.
send("readback DAW mode", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0xf7]);
await pause(800);
send("enable DAW mode", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x01, 0xf7]);
await pause(500);
send("readback DAW mode", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0xf7]);
await pause(800);

// Readback of layout, then set up a two-fader bank (manual example: CC 7 unipolar, CC 8 bipolar), then switch layout.
send("readback layout", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0xf7]);
await pause(800);
send("set DAW Fader bank", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x01, 0x00, 0x00, 0x00, 0x00, 0x07, 0x25, 0x01, 0x01, 0x08, 0x15, 0xf7]);
await pause(300);
send("select DAW Fader layout", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x0d, 0xf7]);
await pause(800);
send("readback layout", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0xf7]);

console.log(`\n>>> move the faders now (${seconds}s window). Use the top two faders in the fader layout.\n`);
await pause(seconds * 1000);
console.log(`>>> window over: channel 5 CC messages received=${counts.cc5}\n`);

// Restore: Programmer layout, then DAW mode off.
send("select Programmer layout", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0x7f, 0xf7]);
await pause(800);
send("readback layout", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x00, 0xf7]);
await pause(800);
send("disable DAW mode", [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0d, 0x10, 0x00, 0xf7]);
await pause(800);

sendOut.closePort();
inputs.closePort?.();
process.exit(0);
