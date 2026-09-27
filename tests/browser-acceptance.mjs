import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chromeCandidates = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
];

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function exists(file) {
  try { await import("node:fs/promises").then(fs => fs.access(file)); return true; }
  catch { return false; }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function waitForValue(operation, label, timeout = 15_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) { lastError = error; }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` ${lastError.message}` : ""}`);
}

async function stopProcess(process) {
  if (!process || process.exitCode !== null || process.killed) return;
  const exited = new Promise(resolve => process.once("exit", resolve));
  process.kill("SIGTERM");
  await Promise.race([exited, delay(3_000)]);
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const pending = new Map();
    let sequence = 0;
    socket.addEventListener("error", reject, { once: true });
    socket.addEventListener("open", () => {
      socket.addEventListener("message", event => {
        const message = JSON.parse(String(event.data));
        if (!message.id || !pending.has(message.id)) return;
        const { resolve: settle, reject: fail, timer } = pending.get(message.id);
        clearTimeout(timer);
        pending.delete(message.id);
        if (message.error) fail(new Error(message.error.message));
        else settle(message.result);
      });
      resolve({
        socket,
        send(method, params = {}) {
          return new Promise((settle, fail) => {
            const id = ++sequence;
            const timer = setTimeout(() => { pending.delete(id); fail(new Error(`CDP timeout: ${method}`)); }, 10_000);
            pending.set(id, { resolve: settle, reject: fail, timer });
            socket.send(JSON.stringify({ id, method, params }));
          });
        }
      });
    }, { once: true });
  });
}

let dataDirectory;
let browserProfile;
let serverProcess;
let browserProcess;
let cdp;

try {
  const browserExecutable = await waitForValue(async () => {
    for (const candidate of chromeCandidates) if (await exists(candidate)) return candidate;
    return null;
  }, "an installed Chromium browser", 1_000);
  dataDirectory = await mkdtemp(path.join(os.tmpdir(), "trustbuilder-browser-data-"));
  browserProfile = await mkdtemp(path.join(os.tmpdir(), "trustbuilder-browser-profile-"));
  const serverPort = await freePort();

  serverProcess = spawn(process.execPath, [path.join(project, "server.mjs")], {
    cwd: project,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(serverPort), TRUSTBUILDER_DATA_DIR: dataDirectory, OPENAI_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let serverErrors = "";
  serverProcess.stderr.on("data", chunk => { serverErrors += chunk.toString(); });
  const baseUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start. ${serverErrors}`)), 10_000);
    serverProcess.stdout.on("data", chunk => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}/`); }
    });
    serverProcess.once("error", reject);
  });

  const debuggingPort = await freePort();
  browserProcess = spawn(browserExecutable, [
    "--headless=new", "--disable-gpu", "--disable-breakpad", "--disable-crash-reporter", "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    `--user-data-dir=${browserProfile}`, `--remote-debugging-port=${debuggingPort}`, baseUrl
  ], { stdio: "ignore" });

  const target = await waitForValue(async () => {
    const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
    const targets = await response.json();
    return targets.find(item => item.type === "page" && item.url.startsWith(baseUrl));
  }, "browser page");
  cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  async function evaluate(expression) {
    const response = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "Browser evaluation failed.");
    return response.result.value;
  }

  async function waitForText(text, label = text) {
    return waitForValue(() => evaluate(`document.body?.innerText.includes(${JSON.stringify(text)})`), label);
  }

  await waitForText("Sign in to TrustBuilder", "login screen");
  assert.equal(await evaluate(`document.querySelector('#authEmail') && document.querySelector('#authPassword') ? true : false`), true);
  await evaluate(`(() => {
    document.querySelector('#authEmail').value = 'priya.shah@example.com';
    document.querySelector('#authPassword').value = 'TrustBuilder!2026';
    document.querySelector('#authForm').requestSubmit();
    return true;
  })()`);
  try { await waitForText("Facilitator dashboard", "facilitator login"); }
  catch (error) {
    console.error("Rendered login state:\n" + await evaluate(`document.body.innerText`));
    throw error;
  }

  assert.equal(await evaluate(`(() => { const button = [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Use Cases'); if (!button) return false; button.click(); return true; })()`), true);
  await waitForText("Regulatory Document Analysis", "existing use case");
  await waitForText("Add Use Case", "add-use-case action");

  await evaluate(`(() => {
    document.querySelector('#useCaseIntentText').value = 'Automated regulatory document review.';
    [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Add Use Case').click();
    return true;
  })()`);
  const firstQuestion = "What decision should this use case help the reviewer make?";
  await waitForText(firstQuestion, "contextual first probe");
  assert.match(await evaluate(`document.body.innerText`), /Automated regulatory document review/i);
  assert.equal(await evaluate(`document.querySelector('.use-case-active > .card .status')?.textContent.trim()`), "Draft");

  await evaluate(`(() => {
    document.querySelector('#useCaseProbeAnswer').value = 'Determine which findings require immediate action.';
    [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Submit answer').click();
    return true;
  })()`);
  const nextQuestion = await waitForValue(async () => {
    const text = await evaluate(`[...document.querySelectorAll('.use-case-conversation .turn.ai p')].at(-1)?.textContent.trim() || ''`);
    return text && text !== firstQuestion ? text : null;
  }, "answer-driven follow-up");
  assert.match(nextQuestion, /evidence/i);
  assert.match(await evaluate(`document.body.innerText`), /Determine which findings require immediate action/i);

  await evaluate(`(() => {
    document.querySelector('#useCaseIntentText').value = 'FDA inspection observation risk classification.';
    [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Add Use Case').click();
    return true;
  })()`);
  const relationshipQuestion = await waitForValue(async () => {
    const text = await evaluate(`[...document.querySelectorAll('.use-case-conversation .turn.ai p')].at(-1)?.textContent.trim() || ''`);
    return /remain separate/i.test(text) && /dependency/i.test(text) ? text : null;
  }, "overlap clarification");
  assert.match(relationshipQuestion, /overlap/i);
  const finalText = await evaluate(`document.body.innerText`);
  for (const label of ["Confirmed", "Assumptions", "Open questions", "Dependencies", "Risks", "Related use cases"]) assert.match(finalText, new RegExp(label, "i"));
  assert.equal(await evaluate(`document.querySelector('.use-case-active > .card .status')?.textContent.trim()`), "Draft");

  console.log(JSON.stringify({
    passed: true,
    facilitatorLogin: true,
    existingUseCaseVisible: true,
    firstQuestion,
    nextQuestion,
    relationshipQuestion,
    draftOnly: true,
    knowledgePanelsVisible: true
  }, null, 2));
} finally {
  try { cdp?.socket.close(); } catch {}
  await stopProcess(browserProcess);
  await stopProcess(serverProcess);
  const temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
  for (const target of [dataDirectory, browserProfile].filter(Boolean)) {
    const resolved = path.resolve(target);
    if (!resolved.startsWith(temporaryRoot)) throw new Error(`Refusing to remove non-temporary path: ${resolved}`);
    try { await rm(resolved, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { console.warn(`Temporary cleanup deferred for ${resolved}: ${error.code || error.message}`); }
  }
}
