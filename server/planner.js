/**
 * Model-guided system sketch from user intent.
 * Uses a model selected from the user's Pi models.json — not heuristics.
 */

import { completeChat } from "./pi-models.js";
import { ORCHESTRATION_PATTERNS, DEFAULT_TOOLS, createEmptyAgent } from "./schema.js";

const KNOWN_TOOLS = new Set(DEFAULT_TOOLS.map((t) => t.id));
const KNOWN_PATTERNS = new Set(ORCHESTRATION_PATTERNS.map((p) => p.id));

function catalogForPrompt() {
  const patterns = ORCHESTRATION_PATTERNS.map(
    (p) => `- ${p.id} (freedom ${p.freedom}/5): ${p.description} When: ${p.when}`
  ).join("\n");
  const tools = DEFAULT_TOOLS.map((t) => `- ${t.id}: ${t.description}`).join("\n");
  return { patterns, tools };
}

export function buildPlannerSystemPrompt() {
  const { patterns, tools } = catalogForPrompt();
  return `You are the System Architect for Agent System Studio.
You design agent SYSTEMS from user intent using the Agent System Design Blueprint.

RULE ZERO: start with the simplest thing that works. Prefer workflows / prompt_chaining when steps are known. Only grant more freedom when the problem is open-ended.

CRITICAL — DO NOT INVENT CAPABILITIES:
- Only enable tools the user's intent clearly needs.
- Default tools if unsure: memory_write, memory_read only.

Return ONLY valid JSON (no markdown fences) matching this shape:
{
  "name": "string",
  "description": "string",
  "reason": "why this design (1-3 sentences)",
  "inferredCapabilities": ["short tags you actually inferred"],
  "core": {
    "goal": "string",
    "systemPrompt": "string",
    "exitCondition": "string"
  },
  "s1_orchestration": {
    "pattern": one of: ${[...KNOWN_PATTERNS].join(" | ")},
    "nested": { "router": boolean, "workers": boolean, "judge": boolean },
    "escalationRule": "string",
    "judgeCriteria": "string",
    "chainSteps": [{ "id": "step_1", "name": "string", "prompt": "string" }],
    "routes": [{ "id": "r1", "name": "string", "match": "string", "prompt": "string" }]
  },
  "s2_context": {
    "systemPromptAltitude": "heuristics",
    "jitContext": true,
    "externalMemory": true,
    "compactionThreshold": 0.75
  },
  "s3_tools": {
    "enabledToolIds": ["memory_write", "memory_read", "... only if needed"]
  },
  "s4_guardrails": {
    "worstCase3am": "string grounded in enabled tools",
    "validateInput": true,
    "validateOutput": true,
    "breakers": { "maxSpendUsd": 1, "maxLoops": 10, "maxTimeSec": 180 }
  },
  "s5_instruments": {
    "traces": true,
    "outcomeGrading": true,
    "evals": [{ "id": "ev1", "name": "string", "input": "string", "expected": "contains:..." }]
  },
  "s6_power": {
    "modelMap": {
      "reason": "large",
      "classify": "small",
      "extract": "small",
      "format": "small",
      "summarize": "small",
      "judge": "large"
    },
    "promptCaching": true,
    "parallelWhereIndependent": true,
    "tokenBudget": 6000,
    "turnLimit": 10
  },
  "s7_chassis": {
    "checkpoints": true,
    "idempotentRetries": true,
    "degradedModes": true,
    "versionEverything": true,
    "maxRetries": 2,
    "timeoutsSec": 30
  }
}

Orchestration patterns:
${patterns}

Available tools (only these ids):
${tools}
`;
}

function extractJson(text) {
  let s = String(text || "").trim();
  // strip fences if model ignored instructions
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  // find first { ... last }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s);
}

/** Enforce least-privilege after the model returns — belt and suspenders. */
export function sanitizeSketch(raw, intent, modelRef) {
  const base = createEmptyAgent({
    name: raw.name || "Untitled System",
    description: raw.description || String(intent).slice(0, 160),
    core: raw.core,
    s1_orchestration: raw.s1_orchestration,
    s2_context: raw.s2_context,
    s3_tools: raw.s3_tools,
    s4_guardrails: raw.s4_guardrails,
    s5_instruments: raw.s5_instruments,
    s6_power: raw.s6_power,
    s7_chassis: raw.s7_chassis,
  });

  // Tools: only known ids
  let tools = (raw.s3_tools?.enabledToolIds || base.s3_tools.enabledToolIds || [])
    .filter((id) => KNOWN_TOOLS.has(id));
  if (!tools.length) tools = ["memory_write", "memory_read"];
  // Always allow memory pump if external memory on
  if (base.s2_context?.externalMemory) {
    if (!tools.includes("memory_write")) tools.push("memory_write");
    if (!tools.includes("memory_read")) tools.push("memory_read");
  }
  base.s3_tools.enabledToolIds = [...new Set(tools)];

  // Pattern must be known
  if (!KNOWN_PATTERNS.has(base.s1_orchestration.pattern)) {
    base.s1_orchestration.pattern = "prompt_chaining";
  }

  // Evals: at least one
  if (!base.s5_instruments.evals?.length) {
    base.s5_instruments.evals = [
      {
        id: "ev1",
        name: "Happy path",
        input: String(intent).slice(0, 200),
        expected: "contains:complete",
      },
    ];
  }

  // Annotate provenance — real model, not heuristic
  base._sketch = {
    source: "pi-model",
    modelRef,
    reason: raw.reason || "",
    inferredCapabilities: raw.inferredCapabilities || [],
    intent: String(intent),
    sketchedAt: new Date().toISOString(),
  };

  // Store preferred run model on the agent for later
  base.s6_power = {
    ...base.s6_power,
    sketchModelRef: modelRef,
    runModelRef: raw.runModelRef || modelRef,
  };

  return {
    sketch: {
      name: base.name,
      description: base.description,
      reason: raw.reason || "Designed by selected Pi model.",
      inferredCapabilities: raw.inferredCapabilities || [],
      intent: String(intent),
      modelRef,
      core: base.core,
      s1_orchestration: base.s1_orchestration,
      s2_context: base.s2_context,
      s3_tools: base.s3_tools,
      s4_guardrails: base.s4_guardrails,
      s5_instruments: base.s5_instruments,
      s6_power: base.s6_power,
      s7_chassis: base.s7_chassis,
      _sketch: base._sketch,
    },
  };
}

export async function sketchFromIntentWithModel(intent, modelRef) {
  if (!intent || !String(intent).trim()) {
    throw new Error("Intent is required");
  }
  if (!modelRef) {
    throw new Error("Select a model from your Pi instance");
  }

  const system = buildPlannerSystemPrompt();
  const user = `User intent:\n"""${String(intent).trim()}"""\n\nDesign the minimal agent system for this intent. JSON only.`;

  const content = await completeChat({
    ref: modelRef,
    system,
    user,
    temperature: 0.2,
    maxTokens: 4096,
  });

  let raw;
  try {
    raw = extractJson(content);
  } catch (err) {
    throw new Error(
      `Model did not return valid JSON. ${err.message}. First 300 chars: ${String(content).slice(0, 300)}`
    );
  }

  return sanitizeSketch(raw, intent, modelRef);
}
