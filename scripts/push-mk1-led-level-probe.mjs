// ECS-145: finds whether a Push mk1 monochrome utility button's LED has a visibly distinct, non-full brightness
// level between off (CC value 0) and full (CC value 127) -- neither research doc documents one for these
// CC-addressed buttons (only the 64-pad RGB velocity-color table has documented brightness tiers), so this steps
// the raw CC value by hand against a real button and lets a human read the actual LED, one value at a time.
//
// Usage: node scripts/push-mk1-led-level-probe.mjs [cc=85] [start=0]
//   cc     the controller number to drive (default 85, "Play") -- any monochrome utility button CC works
//   start  the value to begin at (default 0)
//
// At the prompt:
//   <Enter>       send the next value (current + 1, clamped at 127)
//   a number      jump straight to that value (0-127) and send it
//   b             step back by 1
//   q             quit -- turns the LED off and exits
import midi from "@julusian/midi";
import { findPort } from "./node-midi-transport.mjs";

const cc = Number(process.argv[2] ?? 85);
let value = Number(process.argv[3] ?? 0);
if (!Number.isInteger(cc) || cc < 0 || cc > 127) {
  console.error("cc must be an integer 0-127");
  process.exit(1);
}

const inPort = findPort("input", /ableton push.*user port/i);
const outPort = findPort("output", /ableton push.*user port/i);
if (outPort.index < 0) {
  console.error("Push User Port output not found. Outputs:", outPort.names);
  console.error("Hold the physical User button on the Push before running this.");
  process.exit(1);
}

const output = new midi.Output();
output.openPort(outPort.index);

// Not required to run the probe, but if the User Port input is also present, log presses so a press on the very
// button being lit is visible too -- useful since several of this profile's buttons (Play included) are also
// input-bound, and knowing whether a press arrived helps tell "the LED didn't change" apart from "I pressed the
// wrong button."
let input;
if (inPort.index >= 0) {
  input = new midi.Input();
  input.ignoreTypes(false, true, true);
  input.openPort(inPort.index);
  input.on("message", (_dt, bytes) => {
    const b = Uint8Array.from(bytes);
    if ((b[0] & 0xf0) === 0xb0 && b[1] === cc) console.log(`  (press on CC ${cc} read back: value ${b[2]})`);
  });
}

const send = (v) => {
  value = Math.min(127, Math.max(0, v));
  output.sendMessage([0xb0, cc, value]);
  console.log(`CC ${cc} = ${String(value).padStart(3)}  -- look at the button now`);
};

console.log(`Driving CC ${cc} by hand. Watch that one button's LED after every value sent.`);
console.log("<Enter> = +1, 'b' = -1, a number = jump to it, 'q' = quit (turns the LED off)\n");
send(value);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  const line = chunk.trim();
  if (line === "q") {
    output.sendMessage([0xb0, cc, 0]);
    console.log(`CC ${cc} = 0  -- off, exiting`);
    input?.closePort();
    output.closePort();
    process.exit(0);
  }
  if (line === "b") {
    send(value - 1);
    return;
  }
  if (line === "") {
    send(value + 1);
    return;
  }
  const jump = Number(line);
  if (Number.isInteger(jump) && jump >= 0 && jump <= 127) {
    send(jump);
  } else {
    console.log("Not understood -- <Enter>, 'b', 'q', or a number 0-127.");
  }
});
