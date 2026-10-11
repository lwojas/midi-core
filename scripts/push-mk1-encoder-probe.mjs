// ECS-140 live run: verifies the parameter-encoder routing (volume/send/effects, representative roles) added in
// this ticket against a real Push mk1 (User Mode), through the same demo app/surface `push-mk1-live.mjs` uses.
// Turn Encoder 1 (leftmost), Encoder 2 and Encoder 3 and watch the logged volume/send/fx.cutoff values move; after
// `switchAfter` seconds the script calls `selectTrack(2)` itself so the next turns should move track 2's values
// instead of track 1's, with track 1's values no longer changing.
// Usage: node scripts/push-mk1-encoder-probe.mjs [seconds=30] [switchAfter=15]
import { createMidiInput, createMidiOutput } from "../dist/core/index.js";
import { createPushMk1App, createPushMk1Surface } from "../demo/push-mk1-surface.js";
import { createNodeInputTransport, createNodeOutputTransport, findPort } from "./node-midi-transport.mjs";

const seconds = Number(process.argv[2] ?? 30);
const switchAfter = Number(process.argv[3] ?? 15);
const stamp = () => new Date().toLocaleTimeString();
const log = (line) => console.log(`[${stamp()}] ${line}`);

const inPort = findPort("input", /ableton push.*user port/i);
const outPort = findPort("output", /ableton push.*user port/i);
if (inPort.index < 0 || outPort.index < 0) {
  console.error("Push User Port not found. Available inputs:", inPort.names, "outputs:", outPort.names);
  console.error("Hold the physical User button on the Push before running this.");
  process.exit(1);
}
log(`input  [${inPort.index}] ${inPort.names[inPort.index]}`);
log(`output [${outPort.index}] ${outPort.names[outPort.index]}`);

const input = createMidiInput(createNodeInputTransport(inPort.index, inPort.names[inPort.index]));
const output = createMidiOutput(createNodeOutputTransport(outPort.index, outPort.names[outPort.index]));

const app = createPushMk1App({
  onChange: (what, value) => {
    if (what === "volume" || what === "send" || what === "fx.cutoff") log(`app: ${what} track ${value.track} = ${value.value}`);
  },
});

const session = createPushMk1Surface({ input, output, app, log });
input.onMessage((m) => {
  if (m.type === "control-change" && [71, 72, 73].includes(m.controller)) log(`in:  CC ${m.controller} = ${m.value}`);
});

await session.attach();
log("Track 1 selected. Turn Encoder 1 (volume), Encoder 2 (send), Encoder 3 (effects).");
log(`Track 1 volume=${app.volumes.get(1).getValue()} send=${app.sends.get(1).getValue()} fx.cutoff=${app.fxCutoffs.get(1).getValue()}`);
log(`Track 2 volume=${app.volumes.get(2).getValue()} send=${app.sends.get(2).getValue()} fx.cutoff=${app.fxCutoffs.get(2).getValue()}`);

setTimeout(() => {
  session.selectTrack(2);
  log("Selected track 2 -- turn Encoder 1 again; track 1's volume should now stay put, track 2's should move.");
}, switchAfter * 1000);

setTimeout(async () => {
  await session.detach();
  log(`Final: track 1 volume=${app.volumes.get(1).getValue()}, track 2 volume=${app.volumes.get(2).getValue()}`);
  process.exit(0);
}, seconds * 1000);
