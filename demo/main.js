import { createMidiInput, createMidiOutput } from "../dist/core/index.js";
import { requestWebMidiAccess } from "../dist/adapters/web-midi/index.js";

const $ = (id) => document.getElementById(id);
const log = (line) => {
  const el = $("log");
  el.textContent += `[${new Date().toLocaleTimeString()}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
};

let access; // WebMidiAccess
let input; // MidiInput
let output; // MidiOutput

function refreshPortOptions() {
  const ports = access.discovery.listPorts();
  for (const [select, type] of [[$("input-select"), "input"], [$("output-select"), "output"]]) {
    const previous = select.value;
    select.innerHTML = "";
    for (const port of ports.filter((p) => p.type === type)) {
      const option = document.createElement("option");
      option.value = port.id;
      option.textContent = `${port.name ?? port.id}${port.manufacturer ? ` (${port.manufacturer})` : ""}`;
      select.appendChild(option);
    }
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }
  $("connect").disabled = access.discovery.listPorts().length === 0;
}

$("request").addEventListener("click", async () => {
  try {
    access = await requestWebMidiAccess({ sysex: false });
    $("access-status").textContent = "Access granted.";
    refreshPortOptions();
    access.discovery.onChange((change) => {
      log(`discovery: ${change.type} ${change.port.type} "${change.port.name ?? change.port.id}"`);
      refreshPortOptions();
    });
  } catch (err) {
    $("access-status").textContent = `Failed: ${err.message}`;
    log(`access error: ${err.message}`);
  }
});

$("connect").addEventListener("click", async () => {
  const inputId = $("input-select").value;
  const outputId = $("output-select").value;
  const rawInput = access.getInput(inputId);
  const rawOutput = access.getOutput(outputId);
  if (!rawInput || !rawOutput) {
    log("select both an input and an output port first");
    return;
  }

  input = createMidiInput(rawInput);
  output = createMidiOutput(rawOutput);

  input.onStateChange((state) => ($("input-state").textContent = state));
  output.onStateChange((state) => ($("output-state").textContent = state));
  input.onError((err) => log(`input error: ${err.code} ${err.message}`));
  output.onError((err) => log(`output error: ${err.code} ${err.message}`));

  input.onMessage((message) => log(`in:  ${JSON.stringify(stripRaw(message))}`));

  await Promise.all([input.connect(), output.connect()]);

  $("input-state").textContent = input.state;
  $("output-state").textContent = output.state;
  for (const id of ["disconnect", "send-note-on", "send-note-off", "send-cc"]) $(id).disabled = false;
  $("connect").disabled = true;
});

$("disconnect").addEventListener("click", async () => {
  await Promise.all([input?.disconnect(), output?.disconnect()]);
  for (const id of ["disconnect", "send-note-on", "send-note-off", "send-cc"]) $(id).disabled = true;
  $("connect").disabled = false;
});

$("send-note-on").addEventListener("click", () => sendAndLog({ type: "note-on", channel: 0, note: 60, velocity: 100 }));
$("send-note-off").addEventListener("click", () => sendAndLog({ type: "note-off", channel: 0, note: 60, velocity: 0 }));
$("send-cc").addEventListener("click", () => sendAndLog({ type: "control-change", channel: 0, controller: 7, value: 100 }));

function sendAndLog(message) {
  output.send(message);
  log(`out: ${JSON.stringify(message)}`);
}

function stripRaw({ raw, ...rest }) {
  return rest;
}
