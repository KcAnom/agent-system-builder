/**
 * Agent runtime — executes an agent config with S1–S7 discipline.
 * Uses a deterministic simulator + optional OpenAI-compatible LLM if OPENAI_API_KEY is set.
 * Always produces traces, checkpoints, memory, and breaker enforcement.
 */

import { nanoid } from "nanoid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { DEFAULT_TOOLS } from "./schema.js";

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

function isIrreversible(agent, toolId) {
  const line = agent.s4_guardrails?.irreversibilityLine || [];
  if (line.includes(toolId)) return true;
  const tool = DEFAULT_TOOLS.find((t) => t.id === toolId);
  return !!tool?.irreversible;
}

function estimateTokens(text) {
  return Math.ceil(String(text || "").length / 4);
}

function modelForStep(agent, stepType) {
  const map = agent.s6_power?.modelMap || {};
  return map[stepType] || map.reason || "large";
}

/**
 * Simulated reasoning step — produces structured plan / tool calls.
 * If OPENAI_API_KEY + OPENAI_BASE_URL (optional) set, uses real LLM.
 */
async function reason(agent, state, userMessage) {
  const tools = toolCatalog(agent);
  const pattern = agent.s1_orchestration?.pattern || "prompt_chaining";

  // Real LLM path
  if (process.env.OPENAI_API_KEY) {
    try {
      return await llmReason(agent, state, userMessage, tools);
    } catch (err) {
      state.trace.push({
        type: "llm_fallback",
        error: err.message,
        at: new Date().toISOString(),
      });
    }
  }

  // Deterministic simulator — demonstrates the loop for no-code builders
  return simulateReason(agent, state, userMessage, tools, pattern);
}

function simulateReason(agent, state, userMessage, tools, pattern) {
  const turn = state.turn;
  const goal = agent.core?.goal || userMessage;
  const hasMemoryWrite = tools.some((t) => t.id === "memory_write");
  const hasSearch = tools.some((t) => t.id === "web_search");
  const hasEmail = tools.some((t) => t.id === "send_email");

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
      const routes = agent.s1_orchestration?.routes || [];
      const picked = routes[0] || { name: "Default" };
      return {
        thought: `Router (small model): classify request → lane "${picked.name}".`,
        stepType: "classify",
        content: `Routed to: ${picked.name}`,
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
  if (turn >= 3 || state.pendingApprovals.length > 0) {
    // Only cross the irreversibility line when the *user message* asks for a side-effect
    // (do not inspect agent.goal — it often mentions refund/email as things to avoid)
    const msg = String(userMessage || "");
    const wantsEmail = /\b(send email|email (them|the customer|me)|notify (them|customer))\b/i.test(msg);
    const wantsRefund = /\brefund\b/i.test(msg);
    const hasRefund = tools.some((t) => t.id === "refund_payment");

    if (
      wantsRefund &&
      hasRefund &&
      agent.s4_guardrails?.humanGate &&
      !state.emailGated &&
      turn === 3
    ) {
      state.emailGated = true;
      return {
        thought: "Refund requested — crosses irreversibility line.",
        stepType: "reason",
        content:
          "Draft refund prepared. Human gate required before refund_payment fires.",
        toolCalls: [
          {
            id: "tc_" + nanoid(6),
            name: "refund_payment",
            arguments: {
              orderId: (msg.match(/\d{4,}/) || ["unknown"])[0],
              amount: 0,
              reason: "Customer requested refund",
            },
          },
        ],
        done: false,
      };
    }

    if (
      wantsEmail &&
      hasEmail &&
      agent.s4_guardrails?.humanGate &&
      !state.emailGated &&
      turn === 3
    ) {
      state.emailGated = true;
      return {
        thought: "Outbound email requested — hits irreversibility line.",
        stepType: "reason",
        content: "Requesting human approval before send_email.",
        toolCalls: [
          {
            id: "tc_" + nanoid(6),
            name: "send_email",
            arguments: {
              to: "user@example.com",
              subject: `Update: ${String(goal).slice(0, 40)}`,
              body: "Draft update from agent. Awaiting approval.",
            },
          },
        ],
        done: false,
      };
    }
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

async function llmReason(agent, state, userMessage, tools) {
  const base = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
  const model =
    modelForStep(agent, "reason") === "small"
      ? process.env.OPENAI_SMALL_MODEL || "gpt-4o-mini"
      : process.env.OPENAI_MODEL || "gpt-4o-mini";

  const toolDefs = tools.map((t) => ({
    type: "function",
    function: {
      name: t.name || t.id,
      description: `${t.description}\nWhen: ${t.when || ""}\nWhen NOT: ${t.whenNot || ""}`,
      parameters: t.parameters || { type: "object", properties: {} },
    },
  }));

  const mem = agent.s2_context?.externalMemory
    ? readNotes(agent.id).slice(-8)
    : [];

  const messages = [
    {
      role: "system",
      content: [
        agent.core?.systemPrompt,
        `Goal: ${agent.core?.goal}`,
        `Exit: ${agent.core?.exitCondition}`,
        `Orchestration pattern: ${agent.s1_orchestration?.pattern}`,
        `Memory notes: ${JSON.stringify(mem)}`,
        `Reply with JSON: {"thought":"","content":"","toolCalls":[{"name":"","arguments":{}}],"done":false}`,
      ].join("\n\n"),
    },
    ...state.messages,
    { role: "user", content: userMessage },
  ];

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      tools: toolDefs.length ? toolDefs : undefined,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    throw new Error(`LLM error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const choice = data.choices?.[0]?.message;
  const usage = data.usage?.total_tokens || estimateTokens(JSON.stringify(messages));

  // native tool calls
  if (choice?.tool_calls?.length) {
    return {
      thought: choice.content || "tool use",
      stepType: "reason",
      content: choice.content || "",
      toolCalls: choice.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments || "{}"),
      })),
      done: false,
      tokens: usage,
    };
  }

  // JSON content protocol
  try {
    const parsed = JSON.parse(choice?.content || "{}");
    return {
      thought: parsed.thought || "",
      stepType: "reason",
      content: parsed.content || choice?.content || "",
      toolCalls: parsed.toolCalls || [],
      done: !!parsed.done,
      tokens: usage,
    };
  } catch {
    return {
      thought: "llm freeform",
      stepType: "reason",
      content: choice?.content || "",
      toolCalls: [],
      done: true,
      tokens: usage,
    };
  }
}

async function executeTool(agent, state, call, options = {}) {
  const tools = toolCatalog(agent);
  const tool = tools.find((t) => t.id === call.name || t.name === call.name);
  if (!tool) {
    return {
      error: "tool_not_found",
      hint: `No tool named ${call.name}. Enabled: ${tools.map((t) => t.id).join(", ")}`,
    };
  }

  // Permissions / irreversibility
  if (isIrreversible(agent, tool.id) && agent.s4_guardrails?.humanGate) {
    if (!options.approvals?.includes(call.id) && !options.approvals?.includes(tool.id)) {
      state.pendingApprovals.push({
        callId: call.id,
        tool: tool.id,
        arguments: call.arguments,
        reason: "Irreversible action — human gate required (S4).",
      });
      return {
        error: "human_gate_required",
        hint: `Action ${tool.id} crosses the irreversibility line. Approve in the Run console to continue.`,
        pending: true,
      };
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
        pendingApprovals: state.pendingApprovals,
        trace: state.trace,
        status: state.status,
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
 * options: { resumeRunId, approvals: string[], maxTurns }
 */
export async function runAgent(agent, userMessage, options = {}) {
  ensureDirs();
  const startedAt = new Date().toISOString();
  let runId = options.resumeRunId || `run_${nanoid(10)}`;

  const state = {
    turn: 0,
    tokensUsed: 0,
    costUsd: 0,
    messages: [],
    pendingApprovals: [],
    trace: [],
    status: "running",
    checkpointId: null,
    emailGated: false,
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
        pendingApprovals: [],
        trace: cp.trace || [],
        status: "running",
      });
      state.trace.push({
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
  const t0 = Date.now();

  // Input validation (S4 middle ring — light)
  if (agent.s4_guardrails?.validateInput) {
    const injection =
      /ignore (all )?(previous|prior) instructions/i.test(userMessage) ||
      /system\s*:\s*/i.test(userMessage);
    if (injection) {
      state.trace.push({
        type: "guardrail",
        ring: "validation",
        action: "blocked_input",
        reason: "Possible prompt injection in user message",
        at: new Date().toISOString(),
      });
      const run = finalize(runId, agent, userMessage, state, startedAt, {
        status: "blocked",
        output: "Input blocked by validation guardrail (S4).",
      });
      return run;
    }
  }

  state.trace.push({
    type: "run_start",
    agentId: agent.id,
    agentVersion: agent.version,
    pattern: agent.s1_orchestration?.pattern,
    goal: agent.core?.goal,
    at: startedAt,
  });

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

    state.turn += 1;
    const decision = await reason(agent, state, userMessage);

    const tokens = decision.tokens || estimateTokens(decision.content + decision.thought);
    state.tokensUsed += tokens;
    state.costUsd += costFor(modelForStep(agent, decision.stepType || "reason"), tokens);

    state.trace.push({
      type: "model_call",
      turn: state.turn,
      stepType: decision.stepType,
      modelTier: modelForStep(agent, decision.stepType || "reason"),
      thought: decision.thought,
      content: decision.content,
      toolCalls: decision.toolCalls || [],
      tokens,
      at: new Date().toISOString(),
    });

    state.messages.push({
      role: "assistant",
      content: decision.content,
    });

    // Tool execution
    for (const call of decision.toolCalls || []) {
      const result = await executeTool(agent, state, call, {
        approvals: options.approvals || [],
      });
      state.trace.push({
        type: "tool_result",
        turn: state.turn,
        name: call.name,
        callId: call.id,
        arguments: call.arguments,
        result,
        at: new Date().toISOString(),
      });
      state.messages.push({
        role: "tool",
        content: JSON.stringify(result),
      });
    }

    // Human gate pause
    if (state.pendingApprovals.length) {
      stopReason = "awaiting_approval";
      state.status = "awaiting_approval";
      finalOutput =
        decision.content +
        "\n\n⏸ Paused at irreversibility line. Approve pending actions to continue.";
      break;
    }

    if (decision.done) {
      finalOutput = decision.content;
      state.status = "completed";
      stopReason = "exit_condition";
      break;
    }

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
  if (agent.s4_guardrails?.validateOutput && finalOutput) {
    state.trace.push({
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
  });
}

function finalize(runId, agent, userMessage, state, startedAt, { status, output, stopReason }) {
  const run = {
    id: runId,
    agentId: agent.id,
    agentName: agent.name,
    agentVersion: agent.version,
    input: userMessage,
    output,
    status,
    stopReason: stopReason || status,
    turn: state.turn,
    tokensUsed: state.tokensUsed,
    costUsd: Number(state.costUsd.toFixed(6)),
    pendingApprovals: state.pendingApprovals,
    trace: agent.s5_instruments?.traces === false ? [] : state.trace,
    startedAt,
    finishedAt: new Date().toISOString(),
    needles: {
      success: status === "completed" ? 1 : 0,
      takeover: status === "awaiting_approval" ? 1 : 0,
      cost_per_task: Number(state.costUsd.toFixed(6)),
    },
  };
  saveRun(run);
  return run;
}

/** Run eval suite against agent */
export async function runEvals(agent) {
  const evals = agent.s5_instruments?.evals || [];
  const results = [];
  for (const ev of evals) {
    const run = await runAgent(agent, ev.input, { maxTurns: agent.s6_power?.turnLimit || 8 });
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
    results,
    at: new Date().toISOString(),
  };
}

function scoreEval(ev, run) {
  if (run.status !== "completed" && run.status !== "awaiting_approval") return false;
  if (!ev.expected) return run.status === "completed";
  const out = `${run.output || ""} ${run.stopReason || ""} ${run.status || ""}`.toLowerCase();
  const exp = String(ev.expected).toLowerCase();
  // outcome grading: expected substring or all keywords
  if (exp.startsWith("contains:")) {
    const needle = exp.replace("contains:", "").trim();
    return out.includes(needle);
  }
  return out.includes(exp) || exp.split(/\s+/).filter(Boolean).every((w) => out.includes(w));
}
