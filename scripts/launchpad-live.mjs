// ECS-79 live run: drives a real Launchpad Mini MK3 through midi-core's ControlSurface from the terminal.
// No browser, no permission prompt. Usage: node scripts/launchpad-live.mjs [seconds=30] [steps|mixer|transport]
import { createMidiInput, createMidiOutput } from "../dist/core/index.js";
import { createLaunchpadApp, createLaunchpadSurface } from "../demo/launchpad-surface.js";
import { createNodeInputTransport, createNodeOutputTransport, findPort } from "./node-midi-transport.mjs";

const seconds = Number(process.argv[2] ?? 30);
const startMode = process.argv[3] ?? "steps";
const stamp = () => new Date().toLocaleTimeString();
const log = (line) => console.log(`[${stamp()}] ${line}`);
const describe = (m) => {
  if (m.type === "sysex") return `sysex ${Array.from(m.raw, (b) => b.toString(16).padStart(2, "0")).join(" ")}`;
  const { raw, ...rest } = m;
  return JSON.stringify(rest);
};

const inPort = findPort("input", /Launchpad Mini MK3.*MIDI Out/);
const outPort = findPort("output", /Launchpad Mini MK3.*MIDI In/);
if (inPort.index < 0 || outPort.index < 0) {
  console.error("Launchpad Mini MK3 MIDI ports not found. Available inputs:", inPort.names, "outputs:", outPort.names);
  process.exit(1);
}
log(`input  [${inPort.index}] ${inPort.names[inPort.index]}`);
log(`output [${outPort.index}] ${outPort.names[outPort.index]}`);

const input = createMidiInput(createNodeInputTransport(inPort.index, inPort.names[inPort.index]));
const output = createMidiOutput(createNodeOutputTransport(outPort.index, outPort.names[outPort.index]));

const app = createLaunchpadApp({
  onChange: (what, value) => {
    if (what === "transport") log(`app: transport status = ${value}`);
  },
});

const session = createLaunchpadSurface({ input, output, app, log });
input.onMessage((m) => log(`in:  ${describe(m)}`));
const loggedSend = output.send.bind(output);
output.send = (m) => {
  log(`out: ${describe(m)}`);
  loggedSend(m);
};

const counts = { presses: 0, releases: 0 };
const stopCounting = input.onMessage((m) => {
  if (m.type === "note-on" && m.velocity > 0) counts.presses++;
  if (m.type === "note-off" || (m.type === "note-on" && m.velocity === 0)) counts.releases++;
});

try {
  await session.attach();
} catch (err) {
  console.error(`attach failed [${err.code}]: ${err.message}`);
  process.exit(1);
}
log(`surface attached, mode=${session.surface.navigation.state.mode}`);


log("LED sweep: lighting each pad in turn");
// The first page of the step grid, row by row, so the LEDs visible on the first page light up in turn.
for (let row = 0; row < 8; row++) {
  for (let column = 0; column < 8; column++) {
    app.steps.get(`step.${row}.${column}`).setValue(true);
  }
  await new Promise((r) => setTimeout(r, 120));
}
await new Promise((r) => setTimeout(r, 800));
log("LED sweep: clearing all steps");
app.setAllSteps(false);
await new Promise((r) => setTimeout(r, 800));

if (startMode !== session.surface.navigation.state.mode) session.surface.navigation.setMode(startMode);
await new Promise((r) => setTimeout(r, 100));
log(`press window: ${seconds}s in ${startMode} mode`);
await new Promise((r) => setTimeout(r, seconds * 1000));

const litAtEnd = app.litSteps();
log(`press window over. presses=${counts.presses} releases=${counts.releases} steps lit now=${litAtEnd}`);

stopCounting();
await session.detach();
await input.disconnect();
await output.disconnect();
log("detached and ports closed");
