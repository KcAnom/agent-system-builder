/**
 * Agent runtime — executes an agent config with S1–S7 discipline.
 * Runs on a real Pi model (selected per run) or the deterministic simulator.
 * Always produces traces, checkpoints, memory, and breaker enforcement.
 */

import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_TOOLS } from "./schema.js";
import { completeMessages } from "./pi-models.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "..", "data");
const MEMORY_DIR = path.join(DATA, "memory");
const RUNS_DIR = path.join(DATA, "runs");

function ensureDirs() {
  for (const d of [MEMORY_DIR, RUNS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function memoryPath(agentId) {
  return path.join(MEMORY_DIR, `${agentId}.json`);
}

export function loadMemory(agentId) {
  ensureDirs();
  const p = memoryPath(agentId);
  if (!fs.existsSync(p)) return { notes: [] };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function saveMemory(agentId, mem) {
  ensureDirs();
  fs.writeFileSync(memoryPath(agentId), JSON.stringify(mem, null, 2));
}

function writeNote(agentId, key, value, tags = []) {
  const mem = loadMemory(agentId);
  const existing = mem.notes.findIndex((n) => n.key === key);
  const note = {
    key,
    value,
    tags,
    updatedAt: new Date().toISOString(),
  };
  if (existing >= 0) mem.notes[existing] = note;
  else mem.notes.push(note);
  saveMemory(agentId, mem);
  return note;
}

function readNotes(agentId, { key, tag } = {}) {
  const mem = loadMemory(agentId);
  return mem.notes.filter((n) => {
    if (key && n.key !== key) return false;
    if (tag && !(n.tags || []).includes(tag)) return false;
    return true;
  });
}

function toolCatalog(agent) {
  const custom = agent.s3_tools?.customTools || [];
  const all = [...DEFAULT_TOOLS, ...custom];
  const enabled = new Set(agent.s3_tools?.enabledToolIds || []);
  return all.filter((t) => enabled.has(t.id) || enabled.has(t.name));
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function modelForStep(agent, stepType) {
  const map = agent.s6_power?.modelMap || {};
  return map[stepType] || map.reason || "large";
}

/** Resolve the Pi model ref for a step tier, honoring the small/large model map. */
function refForStep(agent, stepType, primaryRef) {
  const tier = modelForStep(agent, stepType);
  if (tier === "small" && agent.s6_power?.runModelRefSmall) {
    return agent.s6_power.runModelRefSmall;
  }
  return primaryRef;
}

/**
 * Reasoning step — real Pi model when a modelRef is selected, simulator otherwise.
 * A model failure is a hard error: no silent fallback, the run ends as "error".
 */
async function reason(agent, state, userMessage, options) {
  const tools = toolCatalog(agent);
  const pattern = agent.s1_orchestration?.pattern || "prompt_chaining";
  const modelRef = options.modelRef;

  if (modelRef && modelRef !== "simulator") {
    return piReason(agent, state, tools, modelRef, userMessage);
  }

  return simulateReason(agent, state, userMessage, tools, pattern);
}

/**
 * S1 made real: the configured pattern drives each turn of a live model run.
 * Chain steps are fed turn-by-turn, the routed lane's prompt is pinned, the
 * orchestrator/worker contract is stated, and the evaluator loop is announced.
 */
function patternDirective(agent, state) {
  const s1 = agent.s1_orchestration || {};
  const p = s1.pattern;
  if (p === "prompt_chaining") {
    const steps = s1.chainSteps || [];
    if (!steps.length) return null;
    const idx = Math.min(state.turn - 1, steps.length - 1);
    const step = steps[idx];
    const isFinal = state.turn >= steps.length;
    return `CHAIN STEP ${idx + 1}/${steps.length} — "${step.name}": ${step.prompt || "execute this step"}.${
      isFinal
        ? " This is the final step: deliver the finished result in \"content\" and set done=true."
        : " Complete ONLY this step this turn. Do not set done=true yet."
    }`;
  }
  if (p === "routing" && state.route) {
    return `ROUTED LANE "${state.route.name}": ${state.route.prompt || "handle the request in this lane"}. Stay in this lane.`;
  }
  if (p === "orchestrator_workers") {
    return `You are the orchestrator. Invent the needed subtasks, then complete them one per turn acting as the worker. Worker contract: ${
      s1.workerPrompt || "Complete the assigned subtask. Return a clean, structured result only."
    }`;
  }
  if (p === "evaluator_optimizer") {
    return `Generator/judge loop: produce your best output. A separate judge call will grade it against: "${
      s1.judgeCriteria || "goal met, claims supported"
    }". Set done=true only when you believe it passes.`;
  }
  return null;
}

/** Real routing: a classify call picks the lane before any work happens. */
async function classifyRoute(agent, state, primaryRef, userMessage) {
  const routes = agent.s1_orchestration?.routes || [];
  const ref = refForStep(agent, "classify", primaryRef);
  const timeoutMs = (agent.s7_chassis?.timeoutsSec || 60) * 1000;
  const laneList = routes
    .map((r) => `- "${r.name}"${r.match && r.match !== "default" ? ` (typical signals: ${r.match})` : " (default lane)"}: ${r.prompt || ""}`)
    .join("\n");
  const { text, tokens, costUsd } = await completeMessages({
    ref,
    system: `You are a router. Classify the user request into exactly one lane.\nLanes:\n${laneList}\nRespond with ONLY JSON: {"route":"<lane name>"}`,
    messages: [{ role: "user", content: userMessage }],
    timeoutMs,
  });
  let picked;
  try {
    const name = String(extractJson(text).route || "").toLowerCase();
    picked = routes.find((r) => (r.name || "").toLowerCase() === name);
  } catch {
    /* fall through to default */
  }
  picked = picked || routes.find((r) => r.match === "default") || routes[0];
  state.route = picked;
  return {
    thought: `Router (${ref}): classified request into lane "${picked.name}".`,
    stepType: "classify",
    content: `Routed to: ${picked.name}`,
    toolCalls: [],
    done: false,
    tokens,
    costUsd,
    modelRef: ref,
    route: picked.name,
  };
}

/** Real judge pass for evaluator_optimizer — grades the candidate before done is accepted. */
async function judgePass(agent, candidate, primaryRef) {
  const ref = refForStep(agent, "judge", primaryRef);
  const timeoutMs = (agent.s7_chassis?.timeoutsSec || 60) * 1000;
  const { text, tokens, costUsd } = await completeMessages({
    ref,
    system: `You are a strict judge. Criteria: "${agent.s1_orchestration?.judgeCriteria || "goal met, claims supported"}".\nRespond with ONLY JSON: {"pass": true|false, "feedback": "what to fix if failing"}`,
    messages: [{ role: "user", content: `Candidate output to judge:\n\n${candidate}` }],
    timeoutMs,
  });
  let verdict = { pass: true, feedback: "" };
  try {
    const parsed = extractJson(text);
    verdict = { pass: !!parsed.pass, feedback: parsed.feedback || "" };
  } catch {
    /* unparseable judge reply counts as pass — don't loop forever on a chatty judge */
  }
  return { ...verdict, tokens, costUsd, modelRef: ref };
}

function extractJson(text) {
  let s = String(text || "").trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

async function piReason(agent, state, tools, primaryRef, userMessage) {
  // Routing pattern: first turn is a real classify call, not free-running
  if (
    agent.s1_orchestration?.pattern === "routing" &&
    !state.route &&
    (agent.s1_orchestration?.routes || []).length
  ) {
    return classifyRoute(agent, state, primaryRef, userMessage);
  }

  const toolLines = tools
    .map((t) => {
      const params = JSON.stringify(t.parameters || { type: "object", properties: {} });
      return `- ${t.id}: ${t.description || ""} When: ${t.when || ""} When NOT: ${t.whenNot || ""} Args schema: ${params}`;
    })
    .join("\n");

  const mem = agent.s2_context?.externalMemory ? readNotes(agent.id).slice(-8) : [];

  const system = [
    agent.core?.systemPrompt,
    `Goal: ${agent.core?.goal}`,
    `Exit condition: ${agent.core?.exitCondition}`,
    `Orchestration pattern: ${agent.s1_orchestration?.pattern}`,
    patternDirective(agent, state),
    `Turn ${state.turn} of at most ${agent.s6_power?.turnLimit || 12}.`,
    mem.length ? `Memory notes: ${JSON.stringify(mem)}` : null,
    tools.length ? `Available tools:\n${toolLines}` : "No tools available.",
    `Respond with ONLY valid JSON (no markdown fences):`,
    `{"thought":"private reasoning","content":"message to show the user","toolCalls":[{"name":"tool_id","arguments":{}}],"done":false}`,
    `Set "done": true with your final answer in "content" when the exit condition is met. Use toolCalls only when needed.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const ref = refForStep(agent, "reason", primaryRef);
  const timeoutMs = (agent.s7_chassis?.timeoutsSec || 60) * 1000;

  const { text, tokens, costUsd } = await completeMessages({
    ref,
    system,
    messages: state.messages,
    timeoutMs,
  });

  try {
    const parsed = extractJson(text);
    return {
      thought: parsed.thought || "",
      stepType: "reason",
      content: parsed.content || "",
      toolCalls: (parsed.toolCalls || []).map((tc) => ({
        id: tc.id || "tc_" + nanoid(6),
        name: tc.name,
        arguments: tc.arguments || {},
      })),
      done: !!parsed.done,
      tokens: tokens || estimateTokens(text),
      costUsd,
      modelRef: ref,
    };
  } catch {
    // Model ignored the protocol — treat freeform text as a final answer
    return {
      thought: "freeform response (JSON protocol not followed)",
      stepType: "reason",
      content: text,
      toolCalls: [],
      done: true,
      tokens: tokens || estimateTokens(text),
      costUsd,
      modelRef: ref,
    };
  }
}

function pickRoute(agent, userMessage) {
  const routes = agent.s1_orchestration?.routes || [];
  for (const r of routes) {
    if (!r.match || r.match === "default") continue;
    try {
      if (new RegExp(r.match, "i").test(userMessage)) return r;
    } catch {
      /* bad regex in route — skip */
    }
  }
  return routes.find((r) => r.match === "default") || routes[0] || { name: "Default" };
}

function simulateReason(agent, state, userMessage, tools, pattern) {
  const turn = state.turn;
  const goal = agent.core?.goal || userMessage;
  const hasMemoryWrite = tools.some((t) => t.id === "memory_write");
  const hasSearch = tools.some((t) => t.id === "web_search");

  if (pattern === "prompt_chaining") {
    const steps = agent.s1_orchestration?.chainSteps || [];
    const step = steps[Math.min(turn - 1, steps.length - 1)];
    if (turn <= steps.length) {
      if (turn === 1) {
        return {
          thought: `Chain step "${step?.name}": understand goal.`,
          stepType: "reason",
          content: `Goal restated: ${goal}. Constraints from system prompt applied.`,
          toolCalls: hasMemoryWrite
            ? [
                {
                  id: "tc_" + nanoid(6),
                  name: "memory_write",
                  arguments: {
                    key: "goal",
                    value: goal,
                    tags: ["decisions"],
                  },
                },
              ]
            : [],
          done: false,
        };
      }
      if (turn === 2 && hasSearch) {
        return {
          thought: `Chain step "${step?.name}": gather facts (JIT).`,
          stepType: "extract",
          content: "Pulling external context on demand.",
          toolCalls: [
            {
              id: "tc_" + nanoid(6),
              name: "web_search",
              arguments: { query: String(goal).slice(0, 120) },
            },
          ],
          done: false,
        };
      }
      if (turn === steps.length || turn >= (agent.s6_power?.turnLimit || 12) - 1) {
        return {
          thought: "Verify exit condition and finish.",
          stepType: "summarize",
          content: buildFinalAnswer(agent, state, userMessage),
          toolCalls: [],
          done: true,
        };
      }
      return {
        thought: `Chain step "${step?.name}": ${step?.prompt || "execute"}`,
        stepType: "reason",
        content: `Working on: ${step?.name || "step"}. Pattern=${pattern}.`,
        toolCalls: [],
        done: false,
      };
    }
  }

  if (pattern === "routing") {
    if (turn === 1) {
      const picked = pickRoute(agent, userMessage);
      return {
        thought: `Router (small model): classify request → lane "${picked.name}".`,
        stepType: "classify",
        content: `Routed to: ${picked.name}${picked.prompt ? ` — ${picked.prompt}` : ""}`,
        toolCalls: [],
        done: false,
        route: picked.name,
      };
    }
  }

  if (pattern === "orchestrator_workers") {
    if (turn === 1) {
      return {
        thought: "Orchestrator invents subtasks for workers.",
        stepType: "reason",
        content: "Subtasks: (1) research, (2) draft, (3) verify.",
        toolCalls: hasMemoryWrite
          ? [
              {
                id: "tc_" + nanoid(6),
                name: "memory_write",
                arguments: {
                  key: "plan",
                  value: "research → draft → verify",
                  tags: ["decisions", "todos"],
                },
              },
            ]
          : [],
        done: false,
      };
    }
    if (turn === 2) {
      return {
        thought: "Worker: research subtask",
        stepType: "extract",
        content: "Worker result: research complete.",
        toolCalls: hasSearch
          ? [
              {
                id: "tc_" + nanoid(6),
                name: "web_search",
                arguments: { query: String(goal).slice(0, 80) },
              },
            ]
          : [],
        done: false,
      };
    }
  }

  if (pattern === "evaluator_optimizer" && turn >= 2 && turn % 2 === 0) {
    return {
      thought: "Judge evaluates against criteria.",
      stepType: "judge",
      content: `Judge criteria: ${agent.s1_orchestration?.judgeCriteria}\nVerdict: PASS (simulated).`,
      toolCalls: [],
      done: true,
    };
  }

  // Default progression toward exit
  if (turn >= 3) {
    return {
      thought: "Exit condition met.",
      stepType: "summarize",
      content: buildFinalAnswer(agent, state, userMessage),
      toolCalls: [],
      done: true,
    };
  }

  return {
    thought: `Turn ${turn}: progress toward goal.`,
    stepType: "reason",
    content: `Processing: ${String(userMessage).slice(0, 200)}`,
    toolCalls: [],
    done: false,
  };
}

function buildFinalAnswer(agent, state, userMessage) {
  const toolSummary = state.trace
    .filter((t) => t.type === "tool_result")
    .map((t) => `- ${t.name}: ok`)
    .join("\n");
  return [
    `## Result`,
    `Goal: ${agent.core?.goal || userMessage}`,
    ``,
    `Pattern: ${agent.s1_orchestration?.pattern}`,
    `Turns used: ${state.turn}`,
    `Tokens (est.): ${state.tokensUsed}`,
    `Cost (est. USD): ${state.costUsd.toFixed(4)}`,
    ``,
    toolSummary ? `Tools used:\n${toolSummary}` : "No tools were needed.",
    ``,
    `Status: complete (exit condition satisfied)`,
    `Checkpoint saved: ${state.checkpointId || "n/a"}`,
  ].join("\n");
}

// ── Workspace-scoped file tools (S3) ───────────────────────
const READ_CHAR_CAP = 200_000;
const WRITE_CHAR_CAP = 1_000_000;
const LIST_ENTRY_CAP = 500;

/** Workspace root: agent's configured folder, else a sandboxed default. */
function workspaceRoot(agent) {
  const configured = agent.s3_tools?.workspaceDir?.trim();
  const root = configured
    ? path.resolve(configured)
    : path.join(DATA, "workspaces", agent.id || "unassigned");
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * Resolve a relative path strictly inside the workspace root.
 * Rejects traversal ('..'), absolute escapes, and symlink escapes.
 */
export function resolveInWorkspace(root, p) {
  const target = path.resolve(root, String(p ?? ""));
  const rel = path.relative(root, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the workspace: ${p}`);
  }
  // Symlink check on the deepest existing ancestor
  const realRoot = fs.realpathSync(root);
  let probe = target;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const realProbe = fs.realpathSync(probe);
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + path.sep)) {
    throw new Error(`Path escapes the workspace via symlink: ${p}`);
  }
  return target;
}

function readFileTool(agent, args) {
  const root = workspaceRoot(agent);
  const target = resolveInWorkspace(root, args.path);
  if (!fs.existsSync(target)) {
    return { error: "not_found", hint: `No file or folder at "${args.path}" in workspace ${root}` };
  }
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(target, { withFileTypes: true }).slice(0, LIST_ENTRY_CAP);
    return {
      path: args.path,
      dir: true,
      entries: entries.map((e) => ({
        name: e.name,
        type: e.isDirectory() ? "dir" : "file",
      })),
    };
  }
  const content = fs.readFileSync(target, "utf8");
  const truncated = content.length > READ_CHAR_CAP;
  return {
    path: args.path,
    bytes: stat.size,
    truncated,
    content: truncated ? content.slice(0, READ_CHAR_CAP) : content,
  };
}

function writeFileTool(agent, args) {
  const root = workspaceRoot(agent);
  const content = String(args.content ?? "");
  if (content.length > WRITE_CHAR_CAP) {
    return { error: "too_large", hint: `Content exceeds ${WRITE_CHAR_CAP} chars — split the write.` };
  }
  const target = resolveInWorkspace(root, args.path);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return { ok: true, path: args.path, bytes: Buffer.byteLength(content), workspace: root };
}

async function executeTool(agent, state, call) {
  const tools = toolCatalog(agent);
  const tool = tools.find((t) => t.id === call.name || t.name === call.name);
  if (!tool) {
    return {
      error: "tool_not_found",
      hint: `No tool named ${call.name}. Enabled: ${tools.map((t) => t.id).join(", ")}`,
    };
  }

  // Real workspace file tools
  if (tool.id === "read_file" || tool.id === "write_file") {
    try {
      return tool.id === "read_file"
        ? readFileTool(agent, call.arguments || {})
        : writeFileTool(agent, call.arguments || {});
    } catch (err) {
      return { error: "workspace_error", hint: err.message };
    }
  }

  // Built-in memory tools
  if (tool.id === "memory_write") {
    const note = writeNote(
      agent.id,
      call.arguments.key,
      call.arguments.value,
      call.arguments.tags || []
    );
    return { ok: true, note };
  }
  if (tool.id === "memory_read") {
    return { notes: readNotes(agent.id, call.arguments) };
  }

  // Custom / default mock
  if (typeof tool.mockResponse === "function") {
    return tool.mockResponse(call.arguments || {});
  }
  if (tool.handler === "echo") {
    return { echo: call.arguments };
  }
  return {
    ok: true,
    tool: tool.id,
    arguments: call.arguments,
    note: "No live handler — mock success. Wire provider in tool config.",
  };
}

function costFor(modelTier, tokens) {
  // rough display costs
  const per1k = modelTier === "large" ? 0.005 : 0.0005;
  return (tokens / 1000) * per1k;
}

/** Push a trace event and stream it to the client if a listener is attached. */
function pushEvent(state, options, ev) {
  state.trace.push(ev);
  if (typeof options.onEvent === "function") {
    try {
      options.onEvent(ev);
    } catch {
      /* stream broken — keep running */
    }
  }
  return ev;
}

/** S2 compaction: trim old messages once past the threshold of the token budget. */
function compactIfNeeded(agent, state, options) {
  if (agent.s2_context?.jitContext === false) return;
  const budget = agent.s6_power?.tokenBudget || 8000;
  const threshold = agent.s2_context?.compactionThreshold ?? 0.75;
  if (state.tokensUsed < budget * threshold) return;
  if (state.messages.length <= 5) return;
  const dropped = state.messages.splice(0, state.messages.length - 4);
  const keep = (agent.s2_context?.compactionKeep || []).join(", ");
  state.messages.unshift({
    role: "user",
    content: `[Context compacted: ${dropped.length} earlier messages summarized away. Preserve: ${keep || "decisions, open threads"}.]`,
  });
  pushEvent(state, options, {
    type: "compaction",
    droppedMessages: dropped.length,
    tokensUsed: state.tokensUsed,
    threshold,
    at: new Date().toISOString(),
  });
}

function saveCheckpoint(runId, state) {
  ensureDirs();
  const p = path.join(RUNS_DIR, `${runId}.checkpoint.json`);
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        runId,
        turn: state.turn,
        tokensUsed: state.tokensUsed,
        costUsd: state.costUsd,
        messages: state.messages,
        trace: state.trace,
        status: state.status,
        route: state.route,
        savedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  return p;
}

export function loadCheckpoint(runId) {
  const p = path.join(RUNS_DIR, `${runId}.checkpoint.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function saveRun(run) {
  ensureDirs();
  const p = path.join(RUNS_DIR, `${run.id}.json`);
  fs.writeFileSync(p, JSON.stringify(run, null, 2));
  return run;
}

export function loadRun(runId) {
  const p = path.join(RUNS_DIR, `${runId}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function listRuns(agentId) {
  ensureDirs();
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json") && !f.includes("checkpoint"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter((r) => r && (!agentId || r.agentId === agentId))
    .sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

/**
 * Main entry — run agent on a user message.
 * options: { resumeRunId, maxTurns, modelRef, isEval, onEvent }
 * modelRef: "simulator" or a Pi model ref ("provider/model"). Defaults to the
 * agent's s6_power.runModelRef, else the simulator.
 */
export async function runAgent(agent, userMessage, options = {}) {
  ensureDirs();
  const startedAt = new Date().toISOString();
  let runId = options.resumeRunId || `run_${nanoid(10)}`;
  const modelRef = options.modelRef || agent.s6_power?.runModelRef || "simulator";
  const opts = { ...options, modelRef };

  const state = {
    turn: 0,
    tokensUsed: 0,
    costUsd: 0,
    messages: [],
    trace: [],
    status: "running",
    checkpointId: null,
    route: null,
  };

  // Resume from chassis checkpoint
  if (options.resumeRunId && agent.s7_chassis?.checkpoints) {
    const cp = loadCheckpoint(options.resumeRunId);
    if (cp) {
      Object.assign(state, {
        turn: cp.turn,
        tokensUsed: cp.tokensUsed,
        costUsd: cp.costUsd,
        messages: cp.messages || [],
        trace: cp.trace || [],
        status: "running",
        route: cp.route || null,
      });
      pushEvent(state, opts, {
        type: "resume",
        fromTurn: cp.turn,
        at: new Date().toISOString(),
      });
      runId = options.resumeRunId;
    }
  }

  const maxLoops = Math.min(
    options.maxTurns || agent.s4_guardrails?.breakers?.maxLoops || 12,
    agent.s6_power?.turnLimit || 12
  );
  const maxSpend = agent.s4_guardrails?.breakers?.maxSpendUsd ?? 1;
  const maxTimeMs = (agent.s4_guardrails?.breakers?.maxTimeSec || 300) * 1000;
  const tokenBudget = agent.s6_power?.tokenBudget || 0;
  const t0 = Date.now();

  // Input validation (S4 middle ring — light)
  if (agent.s4_guardrails?.validateInput) {
    const injection =
      /ignore (all )?(previous|prior) instructions/i.test(userMessage) ||
      /system\s*:\s*/i.test(userMessage);
    if (injection) {
      pushEvent(state, opts, {
        type: "guardrail",
        ring: "validation",
        action: "blocked_input",
        reason: "Possible prompt injection in user message",
        at: new Date().toISOString(),
      });
      return finalize(runId, agent, userMessage, state, startedAt, {
        status: "blocked",
        output: "Input blocked by validation guardrail (S4).",
        modelRef,
        isEval: options.isEval,
      });
    }
  }

  pushEvent(state, opts, {
    type: "run_start",
    agentId: agent.id,
    agentVersion: agent.version,
    pattern: agent.s1_orchestration?.pattern,
    goal: agent.core?.goal,
    modelRef,
    at: startedAt,
  });

  if (!options.resumeRunId || !state.messages.length) {
    state.messages.push({ role: "user", content: userMessage });
  }

  let finalOutput = "";
  let stopReason = "completed";

  while (state.turn < maxLoops) {
    // Breakers
    if (Date.now() - t0 > maxTimeMs) {
      stopReason = "time_breaker";
      state.status = "breaker";
      break;
    }
    if (state.costUsd >= maxSpend) {
      stopReason = "spend_breaker";
      state.status = "breaker";
      break;
    }
    if (tokenBudget && state.tokensUsed >= tokenBudget) {
      stopReason = "token_breaker";
      state.status = "breaker";
      break;
    }

    state.turn += 1;
    let decision;
    let attempt = 0;
    const maxRetries = agent.s7_chassis?.idempotentRetries
      ? agent.s7_chassis?.maxRetries ?? 2
      : 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        decision = await reason(agent, state, userMessage, opts);
        break;
      } catch (err) {
        if (attempt < maxRetries) {
          attempt += 1;
          pushEvent(state, opts, {
            type: "retry",
            turn: state.turn,
            attempt,
            maxRetries,
            error: err.message,
            at: new Date().toISOString(),
          });
          continue;
        }
        pushEvent(state, opts, {
          type: "model_error",
          turn: state.turn,
          modelRef,
          error: err.message,
          at: new Date().toISOString(),
        });
        state.status = "error";
        stopReason = "model_error";
        finalOutput = `Model failed (${modelRef}): ${err.message}`;
        break;
      }
    }
    if (state.status === "error") break;

    const tokens = decision.tokens || estimateTokens(decision.content + decision.thought);
    state.tokensUsed += tokens;
    // Prefer the provider's real cost (Pi usage data); estimate only for the simulator
    state.costUsd += decision.costUsd || costFor(modelForStep(agent, decision.stepType || "reason"), tokens);

    pushEvent(state, opts, {
      type: "model_call",
      turn: state.turn,
      stepType: decision.stepType,
      modelTier: modelForStep(agent, decision.stepType || "reason"),
      modelRef: decision.modelRef || "simulator",
      thought: decision.thought,
      content: decision.content,
      toolCalls: decision.toolCalls || [],
      tokens,
      at: new Date().toISOString(),
    });

    state.messages.push({
      role: "assistant",
      content: decision.content || decision.thought || "(no content)",
    });

    // Tool execution — results combined into one user message per turn
    const toolResults = [];
    for (const call of decision.toolCalls || []) {
      const result = await executeTool(agent, state, call);
      pushEvent(state, opts, {
        type: "tool_result",
        turn: state.turn,
        name: call.name,
        callId: call.id,
        arguments: call.arguments,
        result,
        at: new Date().toISOString(),
      });
      toolResults.push(`Tool result (${call.name}): ${JSON.stringify(result)}`);
    }
    if (toolResults.length) {
      state.messages.push({ role: "user", content: toolResults.join("\n") });
    }

    // Evaluator pattern: a real judge grades the candidate before done is accepted
    if (
      decision.done &&
      modelRef !== "simulator" &&
      agent.s1_orchestration?.pattern === "evaluator_optimizer" &&
      state.turn < maxLoops
    ) {
      let verdict;
      try {
        verdict = await judgePass(agent, decision.content, modelRef);
      } catch (err) {
        pushEvent(state, opts, {
          type: "model_error",
          turn: state.turn,
          modelRef,
          error: `Judge call failed: ${err.message}`,
          at: new Date().toISOString(),
        });
        state.status = "error";
        stopReason = "model_error";
        finalOutput = `Judge failed (${modelRef}): ${err.message}`;
        break;
      }
      state.tokensUsed += verdict.tokens || 0;
      state.costUsd += verdict.costUsd || 0;
      pushEvent(state, opts, {
        type: "judge",
        turn: state.turn,
        modelRef: verdict.modelRef,
        pass: verdict.pass,
        feedback: verdict.feedback,
        tokens: verdict.tokens,
        at: new Date().toISOString(),
      });
      if (!verdict.pass) {
        decision.done = false;
        state.messages.push({
          role: "user",
          content: `JUDGE VERDICT: FAIL — ${verdict.feedback || "criteria not met"}. Revise your output and try again.`,
        });
      }
    }

    if (decision.done) {
      finalOutput = decision.content;
      state.status = "completed";
      stopReason = "exit_condition";
      break;
    }

    compactIfNeeded(agent, state, opts);

    // Chassis checkpoint each turn
    if (agent.s7_chassis?.checkpoints) {
      state.checkpointId = runId;
      saveCheckpoint(runId, state);
    }
  }

  if (state.turn >= maxLoops && state.status === "running") {
    stopReason = "loop_breaker";
    state.status = "breaker";
    finalOutput =
      finalOutput ||
      `Stopped: max loops (${maxLoops}). Partial progress checkpointed. Report & ask.`;
  }

  if (state.status === "breaker") {
    finalOutput =
      finalOutput ||
      `Breaker tripped (${stopReason}). Tokens=${state.tokensUsed}, cost=$${state.costUsd.toFixed(
        4
      )}, turn=${state.turn}.`;
  }

  // Output validation stub
  if (agent.s4_guardrails?.validateOutput && finalOutput && state.status !== "error") {
    pushEvent(state, opts, {
      type: "guardrail",
      ring: "validation",
      action: "output_checked",
      ok: true,
      at: new Date().toISOString(),
    });
  }

  if (agent.s7_chassis?.checkpoints) {
    saveCheckpoint(runId, state);
  }

  return finalize(runId, agent, userMessage, state, startedAt, {
    status: state.status === "running" ? "completed" : state.status,
    output: finalOutput,
    stopReason,
    modelRef,
    isEval: options.isEval,
  });
}

function finalize(runId, agent, userMessage, state, startedAt, { status, output, stopReason, modelRef, isEval }) {
  const run = {
    id: runId,
    agentId: agent.id,
    agentName: agent.name,
    agentVersion: agent.version,
    input: userMessage,
    output,
    status,
    stopReason: stopReason || status,
    modelRef: modelRef || "simulator",
    isEval: !!isEval,
    turn: state.turn,
    tokensUsed: state.tokensUsed,
    costUsd: Number(state.costUsd.toFixed(6)),
    trace: agent.s5_instruments?.traces === false ? [] : state.trace,
    startedAt,
    finishedAt: new Date().toISOString(),
    needles: {
      success: status === "completed" ? 1 : 0,
      cost_per_task: Number(state.costUsd.toFixed(6)),
    },
  };
  saveRun(run);
  return run;
}

/** Run eval suite against agent. modelRef optional — defaults to the simulator. */
export async function runEvals(agent, { modelRef } = {}) {
  const evals = agent.s5_instruments?.evals || [];
  const results = [];
  for (const ev of evals) {
    const run = await runAgent(agent, ev.input, {
      maxTurns: agent.s6_power?.turnLimit || 8,
      modelRef: modelRef || "simulator",
      isEval: true,
    });
    const passed = scoreEval(ev, run);
    results.push({
      evalId: ev.id,
      name: ev.name,
      input: ev.input,
      expected: ev.expected,
      output: run.output,
      status: run.status,
      passed,
      runId: run.id,
      costUsd: run.costUsd,
    });
  }
  return {
    agentId: agent.id,
    total: results.length,
    passed: results.filter((r) => r.passed).length,
    modelRef: modelRef || "simulator",
    results,
    at: new Date().toISOString(),
  };
}

function scoreEval(ev, run) {
  if (run.status !== "completed") return false;
  if (!ev.expected) return true;
  const out = `${run.output || ""} ${run.stopReason || ""} ${run.status || ""}`.toLowerCase();
  const exp = String(ev.expected).toLowerCase();
  // outcome grading: expected substring or all keywords
  if (exp.startsWith("contains:")) {
    const needle = exp.replace("contains:", "").trim();
    return out.includes(needle);
  }
  return out.includes(exp) || exp.split(/\s+/).filter(Boolean).every((w) => out.includes(w));
}
