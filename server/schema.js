/**
 * Agent System Design Blueprint — canonical agent schema
 * Maps 1:1 to S1–S7 + core loop from Hyperautomation Labs blueprint
 */

export const ORCHESTRATION_PATTERNS = [
  {
    id: "prompt_chaining",
    name: "1 · Prompt chaining",
    freedom: 1,
    description:
      "Fixed sequence; each call cleans up the last. Draft → critique → polish.",
    when: "Task decomposes into known steps",
  },
  {
    id: "routing",
    name: "2 · Routing",
    freedom: 2,
    description:
      "A small model reads the request first and sends it down the right lane.",
    when: "Distinct categories, distinct prompts",
  },
  {
    id: "parallelization",
    name: "3 · Parallelization",
    freedom: 3,
    description:
      "Split work and run at the same time — or vote across multiple answers.",
    when: "Independent subtasks, or confidence needs votes",
  },
  {
    id: "orchestrator_workers",
    name: "4 · Orchestrator + workers",
    freedom: 4,
    description:
      "Lead model invents subtasks on the fly; workers return clean results.",
    when: "You can't predict subtasks in advance",
  },
  {
    id: "evaluator_optimizer",
    name: "5 · Evaluator + optimizer",
    freedom: 5,
    description:
      "One model generates, another judges; bounce until it passes.",
    when: "Clear criteria exist; generator + judge",
  },
];

export const DEFAULT_TOOLS = [
  {
    id: "web_search",
    name: "web_search",
    description: "Search the web for current information.",
    when: "Need facts not in context",
    whenNot: "Internal-only knowledge questions",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    },
    mockResponse: (args) => ({
      results: [
        {
          title: `Result for: ${args.query}`,
          snippet: `Simulated search hit for "${args.query}". Wire a real provider in Tools settings.`,
          url: "https://example.com",
        },
      ],
    }),
  },
  {
    id: "read_file",
    name: "read_file",
    description:
      "Read a real file from the agent's workspace folder by relative path. Reading a directory lists its entries.",
    when: "Need file contents on demand (JIT context), or to explore the workspace tree",
    whenNot: "Large bulk preloads — read only what the step needs",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root ('.' lists the root)" },
      },
      required: ["path"],
    },
  },
  {
    id: "write_file",
    name: "write_file",
    description:
      "Write a real file inside the agent's workspace folder (parent folders created automatically).",
    when: "Persist reports, templates, and draft artifacts",
    whenNot: "Paths outside the workspace — they are refused",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    id: "http_request",
    name: "http_request",
    description: "Call an external HTTP API.",
    when: "Integrate with external systems",
    whenNot: "Destructive production endpoints without human gate",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        url: { type: "string" },
        body: { type: "object" },
      },
      required: ["method", "url"],
    },
    mockResponse: (args) => ({
      status: 200,
      body: { mocked: true, method: args.method, url: args.url },
    }),
  },
  {
    id: "memory_write",
    name: "memory_write",
    description: "Write a note to long-term memory outside the context window.",
    when: "Capture decisions, progress, open threads that must survive compaction",
    whenNot: "Transient chat fluff",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
      },
      required: ["key", "value"],
    },
  },
  {
    id: "memory_read",
    name: "memory_read",
    description: "Retrieve notes from long-term memory by key or tag.",
    when: "Need prior decisions / progress after window reset",
    whenNot: "When the fact is already in the current window",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        tag: { type: "string" },
      },
    },
  },
];

export function createEmptyAgent(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id || null,
    name: partial.name || "Untitled Agent",
    description: partial.description || "",
    version: partial.version || "0.1.0",
    createdAt: partial.createdAt || now,
    updatedAt: now,

    // ── CORE LOOP ──────────────────────────────────────────
    core: {
      goal: partial.core?.goal || "",
      systemPrompt:
        partial.core?.systemPrompt ||
        "You are a careful agent. Prefer the simplest path. Use tools only when needed. Write important decisions to memory. Stop when the goal is done.",
      exitCondition:
        partial.core?.exitCondition ||
        "Goal is complete, or max turns reached, or budget exhausted, or human stop.",
      ruleZero: true, // always true — start simplest
    },

    // ── S1 ORCHESTRATION ───────────────────────────────────
    s1_orchestration: {
      pattern: partial.s1_orchestration?.pattern || "prompt_chaining",
      nested: partial.s1_orchestration?.nested || {
        router: false,
        workers: false,
        judge: false,
      },
      chainSteps: partial.s1_orchestration?.chainSteps || [
        { id: "step_1", name: "Understand", prompt: "Restate the goal and constraints." },
        { id: "step_2", name: "Plan", prompt: "List the minimal steps needed." },
        { id: "step_3", name: "Execute", prompt: "Do the work using tools if needed." },
        { id: "step_4", name: "Verify", prompt: "Check the exit condition. Summarize outcome." },
      ],
      routes: partial.s1_orchestration?.routes || [
        { id: "route_default", name: "Default", match: "default", prompt: "" },
      ],
      workerPrompt:
        partial.s1_orchestration?.workerPrompt ||
        "Complete the assigned subtask. Return a clean, structured result only.",
      judgeCriteria:
        partial.s1_orchestration?.judgeCriteria ||
        "Pass if the goal is met, claims are supported, and the output matches the exit condition.",
      escalationRule:
        partial.s1_orchestration?.escalationRule ||
        "Escalate to agentic lane when the request is open-ended or requires multi-step tool use.",
    },

    // ── S2 CONTEXT + MEMORY ────────────────────────────────
    s2_context: {
      systemPromptAltitude: partial.s2_context?.systemPromptAltitude || "heuristics", // rigid | heuristics | vague
      jitContext: partial.s2_context?.jitContext ?? true,
      compactionThreshold: partial.s2_context?.compactionThreshold ?? 0.75,
      compactionKeep: partial.s2_context?.compactionKeep || [
        "decisions",
        "constraints",
        "todos",
        "open_threads",
      ],
      externalMemory: partial.s2_context?.externalMemory ?? true,
      pointers: partial.s2_context?.pointers || [],
      seedNotes: partial.s2_context?.seedNotes || [],
    },

    // ── S3 TOOLS ───────────────────────────────────────────
    s3_tools: {
      // Conservative default: memory pump only. Side-effect tools must be opted in.
      enabledToolIds: partial.s3_tools?.enabledToolIds || [
        "memory_write",
        "memory_read",
      ],
      customTools: partial.s3_tools?.customTools || [],
      returnStyle: partial.s3_tools?.returnStyle || "actionable", // bare | actionable
    },

    // ── S4 GUARDRAILS ──────────────────────────────────────
    s4_guardrails: {
      permissions: partial.s4_guardrails?.permissions || "least_privilege",
      validateInput: partial.s4_guardrails?.validateInput ?? true,
      validateOutput: partial.s4_guardrails?.validateOutput ?? true,
      breakers: {
        maxSpendUsd: partial.s4_guardrails?.breakers?.maxSpendUsd ?? 1.0,
        maxLoops: partial.s4_guardrails?.breakers?.maxLoops ?? 12,
        maxTimeSec: partial.s4_guardrails?.breakers?.maxTimeSec ?? 300,
      },
      worstCase3am:
        partial.s4_guardrails?.worstCase3am ||
        "Runaway loops / spend — breakers cover it.",
    },

    // ── S5 INSTRUMENTS ─────────────────────────────────────
    s5_instruments: {
      traces: partial.s5_instruments?.traces ?? true,
      evals: partial.s5_instruments?.evals || [],
      driftNeedles: partial.s5_instruments?.driftNeedles || [
        "success_rate",
        "takeover_rate",
        "cost_per_task",
      ],
      outcomeGrading: partial.s5_instruments?.outcomeGrading ?? true,
    },

    // ── S6 POWER ───────────────────────────────────────────
    s6_power: {
      modelMap: partial.s6_power?.modelMap || {
        reason: "large",
        classify: "small",
        extract: "small",
        format: "small",
        summarize: "small",
        judge: "large",
      },
      promptCaching: partial.s6_power?.promptCaching ?? true,
      parallelWhereIndependent: partial.s6_power?.parallelWhereIndependent ?? true,
      tokenBudget: partial.s6_power?.tokenBudget ?? 8000,
      turnLimit: partial.s6_power?.turnLimit ?? 12,
    },

    // ── S7 CHASSIS ──────────────────────────────────────────
    s7_chassis: {
      checkpoints: partial.s7_chassis?.checkpoints ?? true,
      idempotentRetries: partial.s7_chassis?.idempotentRetries ?? true,
      maxRetries: partial.s7_chassis?.maxRetries ?? 2,
      degradedModes: partial.s7_chassis?.degradedModes ?? true,
      versionEverything: partial.s7_chassis?.versionEverything ?? true,
      timeoutsSec: partial.s7_chassis?.timeoutsSec ?? 30,
    },

    // Ship checklist progress (UI)
    checklist: partial.checklist || {},

    // Sketch provenance (which model designed it, from what intent) — preserved if present
    ...(partial._sketch ? { _sketch: partial._sketch } : {}),
  };
}

// ── Semantic lint ────────────────────────────────────────────
// Deterministic design checks that presence-booleans can't catch.

const TOOL_NEED_PATTERNS = [
  {
    toolId: "read_file",
    label: "reading/searching workspace files",
    re: /\b(read|open|inspect|scan|search|locate|examine|explore|list)\b[^.\n]{0,80}\b(files?|folders?|director(?:y|ies)|workspace|artifacts?|codebase|repo(?:sitory)?|disk)\b/i,
  },
  {
    toolId: "write_file",
    label: "writing files/reports to disk",
    re: /\b(write|save|persist|create|emit|produce|generate)\b[^.\n]{0,80}\b(files?|report (?:file|to)|audit-report|\.md\b|\.json\b|\.txt\b|to disk|artifact)\b/i,
  },
  {
    toolId: "web_search",
    label: "searching the web",
    re: /\b(search|look up|browse|research)\b[^.\n]{0,50}\b(web|internet|online|news)\b/i,
  },
  {
    toolId: "http_request",
    label: "calling external APIs",
    re: /\b(call|hit|post to|fetch from|query|invoke)\b[^.\n]{0,50}\b(api|endpoint|webhook|external service)\b/i,
  },
];

function agentActionText(agent) {
  const steps = agent.s1_orchestration?.chainSteps || [];
  const routes = agent.s1_orchestration?.routes || [];
  return [
    agent.core?.goal,
    agent.core?.exitCondition,
    ...steps.map((s) => `${s.name || ""} ${s.prompt || ""}`),
    ...routes.map((r) => r.prompt || ""),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Tools the agent's own step prompts imply it needs but doesn't have. */
export function detectMissingTools(agent) {
  const text = agentActionText(agent);
  const enabled = new Set(agent.s3_tools?.enabledToolIds || []);
  return TOOL_NEED_PATTERNS.filter(
    (p) => !enabled.has(p.toolId) && p.re.test(text)
  ).map(({ toolId, label }) => ({ toolId, label }));
}

const NEGATIVE_EVAL_RE =
  /fail|violat|unverif|missing|incomplete|unauthorized|error|refus|reject|absent|negative/i;

/**
 * Semantic design lint. Returns findings: { id, severity: "error"|"warn", message }.
 * Empty array = clean.
 */
export function lintAgent(agent) {
  const findings = [];
  const steps = agent.s1_orchestration?.chainSteps || [];
  const evals = agent.s5_instruments?.evals || [];

  for (const miss of detectMissingTools(agent)) {
    findings.push({
      id: `tool_${miss.toolId}`,
      severity: "error",
      message: `Steps imply ${miss.label} but "${miss.toolId}" is not enabled — the agent cannot execute its own plan.`,
    });
  }

  if (agent.s1_orchestration?.pattern === "prompt_chaining" && steps.length === 0) {
    findings.push({
      id: "chain_empty",
      severity: "error",
      message: "Pattern is prompt_chaining but there are no chain steps.",
    });
  }

  const turnLimit = agent.s6_power?.turnLimit ?? 0;
  if (steps.length && turnLimit < steps.length * 2) {
    findings.push({
      id: "turns_tight",
      severity: "warn",
      message: `turnLimit ${turnLimit} is under 2× the ${steps.length} chain steps — a single tool call per step exhausts it.`,
    });
  }

  const maxLoops = agent.s4_guardrails?.breakers?.maxLoops ?? 0;
  if (steps.length && maxLoops < steps.length) {
    findings.push({
      id: "loops_tight",
      severity: "warn",
      message: `maxLoops ${maxLoops} is below the ${steps.length} chain steps — the breaker trips before the chain finishes.`,
    });
  }

  if (evals.length) {
    const hasNegative = evals.some(
      (e) => NEGATIVE_EVAL_RE.test(e.expected || "") || NEGATIVE_EVAL_RE.test(e.name || "")
    );
    if (!hasNegative) {
      findings.push({
        id: "evals_happy_only",
        severity: "warn",
        message: "All evals are happy-path — add at least one that exercises a failure/refusal mode.",
      });
    }
    for (const e of evals) {
      if (e.expected && !/^contains:/.test(e.expected)) {
        findings.push({
          id: `eval_expected_${e.id}`,
          severity: "warn",
          message: `Eval "${e.id}" expected "${e.expected}" is not in "contains:<needle>" form — the grader can't check it.`,
        });
      }
    }
  }

  const worst = agent.s4_guardrails?.worstCase3am || "";
  if (!worst || worst.length < 40 || /breakers cover it\.?$/i.test(worst.trim())) {
    findings.push({
      id: "worst_generic",
      severity: "warn",
      message: "3 A.M. worst case is generic — name a concrete failure this agent's tools make possible.",
    });
  }

  return findings;
}

/**
 * Score = 70% structural completeness + 30% semantic lint.
 * A design whose steps can't execute (lint errors) can no longer show 100.
 */
export function scoreAgent(agent) {
  const checks = [
    !!agent.core?.goal,
    !!agent.core?.systemPrompt,
    !!agent.core?.exitCondition,
    !!agent.s1_orchestration?.pattern,
    !!agent.s1_orchestration?.escalationRule,
    agent.s2_context?.jitContext === true,
    agent.s2_context?.externalMemory === true,
    (agent.s3_tools?.enabledToolIds || []).length > 0 &&
      (agent.s3_tools?.enabledToolIds || []).length <= 8,
    !!agent.s4_guardrails?.worstCase3am,
    agent.s4_guardrails?.breakers?.maxLoops > 0,
    agent.s5_instruments?.traces === true,
    (agent.s5_instruments?.evals || []).length >= 1,
    !!agent.s6_power?.modelMap,
    agent.s6_power?.tokenBudget > 0,
    agent.s7_chassis?.checkpoints === true,
    agent.s7_chassis?.idempotentRetries === true,
    agent.s7_chassis?.versionEverything === true,
  ];
  const passed = checks.filter(Boolean).length;
  const structuralPct = (passed / checks.length) * 100;

  const findings = lintAgent(agent);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const lintPct = Math.max(0, 100 - errors * 40 - warns * 15);

  return Math.round(structuralPct * 0.7 + lintPct * 0.3);
}

export function shipChecklist(agent) {
  return [
    {
      id: "s1_simplest",
      layer: "S1",
      label: "Simplest-thing test: could a workflow do this?",
      ok: agent.s1_orchestration?.pattern === "prompt_chaining" || !!agent.core?.goal,
    },
    {
      id: "s1_exit",
      layer: "S1",
      label: "Exit condition is explicit and code-checkable",
      ok: !!agent.core?.exitCondition,
    },
    {
      id: "s2_budget",
      layer: "S2",
      label: "JIT context on — pointers not payloads",
      ok: agent.s2_context?.jitContext === true,
    },
    {
      id: "s2_memory",
      layer: "S2",
      label: "External memory outlives the session",
      ok: agent.s2_context?.externalMemory === true,
    },
    {
      id: "s3_few",
      layer: "S3",
      label: "Few, sharp tools (≤ 8 enabled)",
      ok:
        (agent.s3_tools?.enabledToolIds || []).length > 0 &&
        (agent.s3_tools?.enabledToolIds || []).length <= 8,
    },
    {
      id: "s4_3am",
      layer: "S4",
      label: "3 A.M. worst case written down",
      ok: !!agent.s4_guardrails?.worstCase3am,
    },
    {
      id: "s4_breakers",
      layer: "S4",
      label: "Breakers set (spend / loops / time)",
      ok: !!agent.s4_guardrails?.breakers?.maxLoops,
    },
    {
      id: "s5_traces",
      layer: "S5",
      label: "Traces on every run",
      ok: agent.s5_instruments?.traces === true,
    },
    {
      id: "s5_evals",
      layer: "S5",
      label: "At least one real eval task",
      ok: (agent.s5_instruments?.evals || []).length >= 1,
    },
    {
      id: "s6_map",
      layer: "S6",
      label: "Model map by step type",
      ok: !!agent.s6_power?.modelMap?.reason,
    },
    {
      id: "s6_budget",
      layer: "S6",
      label: "Token budget + turn limit in code",
      ok: agent.s6_power?.tokenBudget > 0 && agent.s6_power?.turnLimit > 0,
    },
    {
      id: "s7_checkpoint",
      layer: "S7",
      label: "Crash = checkpoint, never restart",
      ok: agent.s7_chassis?.checkpoints === true,
    },
    {
      id: "s7_idempotent",
      layer: "S7",
      label: "Actions safe to attempt twice",
      ok: agent.s7_chassis?.idempotentRetries === true,
    },
    {
      id: "s7_versioned",
      layer: "S7",
      label: "Prompts / tools / models versioned",
      ok: agent.s7_chassis?.versionEverything === true,
    },
  ];
}
