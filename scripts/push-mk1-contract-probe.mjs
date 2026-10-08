// ECS-136 gate: resolves two hardware-unverified decisions from the architecture proposal, one at a time.
// Each run does exactly one thing, then exits -- no chained phases, no countdown.
//
// Usage: node scripts/push-mk1-contract-probe.mjs <step>
//   shift49       light CC 49 ("button-shift"), wait for a press, report what was pressed
//   shift35       light CC 35 ("button-shift-nav"), wait for a press, report what was pressed
//   shift34       light CC 34 ("button-select"), wait for a press, report what was pressed
//   encoder1-cw   show "turn clockwise" on the LCD, wait for Encoder 1 (CC 71) turns, report raw values
//   encoder1-ccw  show "turn counter-clockwise" on the LCD, wait for Encoder 1 (CC 71) turns, report raw values
import midi from "@julusian/midi";
import { findPort } from "./node-midi-transport.mjs";

const step = process.argv[2];
const STEPS = ["shift49", "shift35", "shift34", "encoder1-cw", "encoder1-ccw"];
if (!STEPS.includes(step)) {
  console.error(`Usage: node scripts/push-mk1-contract-probe.mjs <${STEPS.join("|")}>`);
  process.exit(1);
}

const inPort = findPort("input", /ableton push.*user port/i);
const outPort = findPort("output", /ableton push.*user port/i);
if (inPort.index < 0 || outPort.index < 0) {
  console.error("Push User Port not found. Inputs:", inPort.names, "Outputs:", outPort.names);
  console.error("Hold the physical User button on the Push before running this.");
  process.exit(1);
}

const input = new midi.Input();
input.ignoreTypes(false, true, true);
const output = new midi.Output();
input.openPort(inPort.index);
output.openPort(outPort.index);

const t0 = Date.now();
const stamp = () => `${String(Date.now() - t0).padStart(6)}ms`;
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(" ");

const listeners = new Set();
input.on("message", (_dt, bytes) => {
  const b = Uint8Array.from(bytes);
  const status = b[0] & 0xf0;
  const entry = status === 0xb0 ? { kind: "cc", cc: b[1], value: b[2] } : { kind: "other", raw: b };
  if (entry.kind === "cc") console.log(`[${stamp()}] cc ${String(entry.cc).padStart(3)} = ${String(entry.value).padStart(3)}  (${hex(b)})`);
  for (const l of listeners) l(entry);
});

function setButtonLight(cc, on) {
  output.sendMessage([0xb0, cc, on ? 127 : 0]);
}

/** F0 47 7F 15 {lineId} 00 45 00 [68 ASCII bytes] F7 -- line id is 0x18-0x1b (NOT 0-3), per midi-profiler's
 * research/push-mk1/sysex-mapping.md, hands-on confirmed in its VERIFICATION.md. */
const LCD_LINE_IDS = { 1: 0x18, 2: 0x19, 3: 0x1a, 4: 0x1b };
function lcdLine(lineNumber, text) {
  const padded = text.slice(0, 68).padEnd(68, " ");
  const ascii = Array.from(padded, (c) => c.charCodeAt(0));
  output.sendMessage([0xf0, 0x47, 0x7f, 0x15, LCD_LINE_IDS[lineNumber], 0x00, 0x45, 0x00, ...ascii, 0xf7]);
}

/** Waits for activity matching `predicate`. No deadline until the first match; then auto-finishes `quietMs`
 * after the last match. A generous `maxMs` backstop only guards against a truly dead run. */
function waitForQuiet(predicate, { quietMs = 1500, maxMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const matched = [];
    let quietTimer = null;
    const maxTimer = setTimeout(() => {
      cleanup();
      resolve(matched);
    }, maxMs);
    const onEvent = (entry) => {
      if (!predicate(entry)) return;
      matched.push(entry);
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        cleanup();
        resolve(matched);
      }, quietMs);
    };
    const cleanup = () => {
      listeners.delete(onEvent);
      clearTimeout(maxTimer);
      if (quietTimer) clearTimeout(quietTimer);
    };
    listeners.add(onEvent);
  });
}

async function shiftStep(cc, label) {
  console.log(`\nLighting CC ${cc} ("${label}"). If a button lights up, press that SAME button.`);
  console.log("If nothing lights up anywhere on the device, that's a valid result too -- just wait.\n");
  setButtonLight(cc, true);
  const pressed = await waitForQuiet((e) => e.kind === "cc" && e.value > 0);
  setButtonLight(cc, false);
  console.log(`\nResult: ${pressed.length ? `pressed CC ${[...new Set(pressed.map((e) => e.cc))].join(", ")}` : "nothing pressed (and/or nothing lit)"}`);
}

async function encoderStep(direction) {
  const text = `ENCODER 1 (LEFTMOST) -- TURN ${direction.toUpperCase()} NOW`;
  console.log(`\nLCD now shows: "${text}"`);
  console.log(`Turn Encoder 1 (leftmost of the 8 identical knobs) ${direction}, a few detents, at your own pace.\n`);
  lcdLine(1, text);
  const samples = await waitForQuiet((e) => e.kind === "cc" && e.cc === 71);
  lcdLine(1, "");
  const values = samples.map((e) => e.value);
  console.log(`\nResult: ${values.length ? `raw CC 71 values = [${values.join(", ")}]` : "no CC 71 events captured"}`);
}

switch (step) {
  case "shift49":
    await shiftStep(49, "button-shift");
    break;
  case "shift35":
    await shiftStep(35, "button-shift-nav");
    break;
  case "shift34":
    await shiftStep(34, "button-select");
    break;
  case "encoder1-cw":
    await encoderStep("clockwise");
    break;
  case "encoder1-ccw":
    await encoderStep("counter-clockwise");
    break;
}

input.closePort();
output.closePort();
process.exit(0);
