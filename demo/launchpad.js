import { createMidiInput, createMidiOutput } from "../dist/core/index.js";
import { requestWebMidiAccess } from "../dist/adapters/web-midi/index.js";
import { createLaunchpadApp, createLaunchpadSurface } from "./launchpad-surface.js";

const $ = (id) => document.getElementById(id);
const log = (line) => {
  const el = $("log");
  el.textContent += `[${new Date().toLocaleTimeString()}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
};

const app = createLaunchpadApp({
  onChange: (what, value) => {
    if (what === "transport") $("transport-status").textContent = value;
    if (what === "steps") $("steps-on").textContent = String(value);
  },
});
$("transport-status").textContent = app.transport.status;
$("steps-on").textContent = String(app.litSteps());

let access;
let input;
let output;
let session;

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
}

function setButtonsForLifecycle(state) {
  const attached = state === "attached";
  $("attach").disabled = attached || state === "attaching" || !access;
  $("detach").disabled = !attached;
  $("light-all").disabled = !attached;
  $("clear-all").disabled = !attached;
  for (const button of document.querySelectorAll("button.mode")) button.disabled = !attached;
}

function markMode(mode) {
  $("mode").textContent = mode;
  for (const button of document.querySelectorAll("button.mode")) {
    button.classList.toggle("active", button.dataset.mode === mode);
  }
}

function describe(message) {
  if (message.type === "sysex") {
    return `sysex ${Array.from(message.raw, (b) => b.toString(16).padStart(2, "0")).join(" ")}`;
  }
  const { raw, ...rest } = message;
  return JSON.stringify(rest);
}

$("request").addEventListener("click", async () => {
  try {
    access = await requestWebMidiAccess({ sysex: true });
    $("access-status").textContent = "Access granted (sysex).";
    refreshPortOptions();
    $("attach").disabled = false;
    access.discovery.onChange((change) => {
      log(`discovery: ${change.type} ${change.port.type} "${change.port.name ?? change.port.id}"`);
      refreshPortOptions();
    });
  } catch (err) {
    $("access-status").textContent = `Failed: ${err.message}`;
    log(`access error: ${err.message}`);
  }
});

$("attach").addEventListener("click", async () => {
  const rawInput = access.getInput($("input-select").value);
  const rawOutput = access.getOutput($("output-select").value);
  if (!rawInput || !rawOutput) {
    log("select both an input and an output port first");
    return;
  }

  input = createMidiInput(rawInput);
  output = createMidiOutput(rawOutput);
  input.onError((e) => log(`input error: ${e.code} ${e.message}`));
  output.onError((e) => log(`output error: ${e.code} ${e.message}`));
  input.onMessage((message) => log(`in:  ${describe(message)}`));

  const loggedSend = output.send.bind(output);
  output.send = (message) => {
    log(`out: ${describe(message)}`);
    loggedSend(message);
  };

  session = createLaunchpadSurface({ input, output, app, log });
  session.surface.onStateChange((change) => {
    $("lifecycle").textContent = change.to;
    setButtonsForLifecycle(change.to);
  });
  session.surface.navigation.onChange((change) => markMode(change.to.mode));

  try {
    await session.attach();
    markMode(session.surface.navigation.state.mode);
  } catch (err) {
    log(`attach failed: ${err.code ?? ""} ${err.message}`);
  }
});

$("detach").addEventListener("click", async () => {
  await session?.detach();
});

for (const button of document.querySelectorAll("button.mode")) {
  button.addEventListener("click", () => session?.surface.navigation.setMode(button.dataset.mode));
}

$("light-all").addEventListener("click", () => app.setAllSteps(true));
$("clear-all").addEventListener("click", () => app.setAllSteps(false));
