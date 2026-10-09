// ECS-150: finds which raw note-on velocity shows a given colour on a Push mk1 pad (the 64-pad RGB velocity-color
// LED family) -- no published or previously-confirmed byte table exists for this device's pads (see ECS-145's own
// research, docs/hardware-validation-push-mk1.md), so this steps the raw velocity by hand against a real pad and
// lets a human read the actual LED colour, one value at a time. Same technique as push-mk1-led-level-probe.mjs,
// adapted from CC to note-on since the pads are note-addressed.
//
// Usage: node scripts/push-mk1-pad-color-probe.mjs [note=36] [start=0]
//   note   the pad's note number to drive (default 36, bottom-left pad) -- any of notes 36-99 works
//   start  the velocity to begin at (default 0)
//
// At the prompt:
//   <Enter>       send the next velocity (current + 1, clamped at 127)
//   a number      jump straight to that velocity (0-127) and send it
//   b             step back by 1
//   q             quit -- turns the pad off and exits
import midi from "@julusian/midi";
import { findPort } from "./node-midi-transport.mjs";

const note = Number(process.argv[2] ?? 36);
let velocity = Number(process.argv[3] ?? 0);
if (!Number.isInteger(note) || note < 36 || note > 99) {
  console.error("note must be an integer 36-99 (a pad note)");
  process.exit(1);
}

const outPort = findPort("output", /ableton push.*user port/i);
if (outPort.index < 0) {
  console.error("Push User Port output not found. Outputs:", outPort.names);
  console.error("Hold the physical User button on the Push before running this.");
  process.exit(1);
}

const output = new midi.Output();
output.openPort(outPort.index);

const send = (v) => {
  velocity = Math.min(127, Math.max(0, v));
  output.sendMessage([0x90, note, velocity]);
  console.log(`note ${note} velocity = ${String(velocity).padStart(3)}  -- look at the pad now`);
};

console.log(`Driving note ${note} (pad) by hand. Watch that one pad's LED after every velocity sent.`);
console.log("<Enter> = +1, 'b' = -1, a number = jump to it, 'q' = quit (turns the pad off)\n");
send(velocity);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  const line = chunk.trim();
  if (line === "q") {
    output.sendMessage([0x90, note, 0]);
    console.log(`note ${note} velocity = 0  -- off, exiting`);
    output.closePort();
    process.exit(0);
  }
  if (line === "b") {
    send(velocity - 1);
    return;
  }
  if (line === "") {
    send(velocity + 1);
    return;
  }
  const jump = Number(line);
  if (Number.isInteger(jump) && jump >= 0 && jump <= 127) {
    send(jump);
  } else {
    console.log("Not understood -- <Enter>, 'b', 'q', or a number 0-127.");
  }
});
