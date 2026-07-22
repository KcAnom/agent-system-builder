/**
 * Model-guided system sketch from user intent.
 *
 * Pipeline (evaluator_optimizer applied to the architect itself):
 *   1. Extract requirements — intent → numbered requirements + ambiguities
 *   2. Generate sketch — requirements ride along in the prompt, past user
 *      corrections included so repeated mistakes stop repeating
 *   3. Critique — model judges per-requirement coverage; deterministic lint
 *      (schema.js) checks tool/step consistency and budgets
 *   4. Repair — up to REPAIR_ROUNDS passes while critical issues remain
 *
 * Uses a model selected from the user's Pi models.json — not heuristics.
 */

import { completeChat } from "./pi-models.js";
import {
  ORCHESTRATION_PATTERNS,
  DEFAULT_TOOLS,
  createEmptyAgent,
  lintAgent,
  detectMissingTools,
} from "./schema.js";
import { loadRecentCorrections } from "./store.js";

const KNOWN_TOOLS = new Set(DEFAULT_TOOLS.map((t) => t.id));
const KNOWN_PATTERNS = new Set(ORCHESTRATION_PATTERNS.map((p) => p.id));
const REPAIR_ROUNDS = 2;

function catalogForPrompt() {
  const patterns = ORCHESTRATION_PATTERNS.map(
    (p) => `- ${p.id} (freedom ${p.freedom}/5): ${p.description} When: ${p.when}`
  ).join("\n");
  const tools = DEFAULT_TOOLS.map((t) => `- ${t.id}: ${t.description}`).join("\n");
  return { patterns, tools };
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

/** Chat call that must return JSON; one retry with an explicit nudge on parse failure. */
async function chatJson({ ref, system, user }) {
  let content = await completeChat({ ref, system, user });
  try {
    return extractJson(content);
  } catch (firstErr) {
    content = await completeChat({
      ref,
      system,
      user: `${user}\n\nYour previous reply was not valid JSON (${firstErr.message}). Reply again with ONLY the JSON object — no prose, no markdown fences.`,
    });
    try {
      return extractJson(content);
    } catch (err) {
      throw new Error(
        `Model did not return valid JSON after retry. ${err.message}. First 300 chars: ${String(content).slice(0, 300)}`
      );
    }
  }
}

// ── Pass 1: requirements ─────────────────────────────────────

const REQUIREMENTS_SYSTEM = `You extract requirements from a user's intent for an agent system.
Do NOT design anything. Do NOT add requirements the user did not state. Do NOT improve or expand their wording.

Return ONLY valid JSON:
{
  "requirements": ["numbered, atomic, verbatim-faithful requirement statements"],
  "ambiguities": ["places where the intent could be read more than one way, with the readings"]
}

Rules:
- One requirement per distinct thing the user asked for, including conditions ("if X then Y" is its own requirement — preserve what triggers what).
- Preserve the user's causal structure exactly. If a pronoun's antecedent is unclear, that is an ambiguity — list it, don't resolve it silently.
- Ambiguities that would change the design materially must be listed even if you have a preferred reading.`;

export async function extractRequirements(intent, modelRef) {
  const parsed = await chatJson({
    ref: modelRef,
    system: REQUIREMENTS_SYSTEM,
    user: `User intent:\n"""${String(intent).trim()}"""`,
  });
  return {
    requirements: Array.isArray(parsed.requirements) ? parsed.requirements.map(String) : [],
    ambiguities: Array.isArray(parsed.ambiguities) ? parsed.ambiguities.map(String) : [],
  };
}

// ── Pass 2: sketch ───────────────────────────────────────────

export function buildPlannerSystemPrompt() {
  const { patterns, tools } = catalogForPrompt();
  return `You are the System Architect for Agent System Studio.
You design agent SYSTEMS from user intent using the Agent System Design Blueprint.

RULE ZERO: start with the simplest thing that works. Prefer workflows / prompt_chaining when steps are known. Only grant more freedom when the problem is open-ended.

REQUIREMENT COVERAGE — the contract:
- You will receive a numbered requirement list extracted from the intent. EVERY requirement must be covered by at least one chain step (or route) AND exercised by at least one eval.
- Preserve the user's causal structure exactly. If a requirement says "if X happens, do Y", the design must do Y precisely when X happens — never invert the condition.
- If an ambiguity is listed, state your chosen reading explicitly in "reason" — never resolve it silently.

TOOLS — capability must match the plan:
- Only enable tools the intent clearly needs, BUT every action your step prompts describe must be executable with the enabled tools. A step that reads/searches files requires read_file; a step that writes a report to disk requires write_file. Never write a step the toolset cannot perform.
- Default tools if genuinely no side effects are needed: memory_write, memory_read only.

BUDGETS — size to the design, do not echo examples:
- turnLimit ≥ 2× the number of chain steps + 2. maxLoops ≥ steps + 2. tokenBudget ≥ 1500 × steps.
- Breaker values (spend/loops/time) must reflect the actual work, not copied sample numbers.

EVALS — must be falsifiable:
- "expected" is always "contains:<needle>" where the needle would genuinely appear in a correct run's output.
- Include at least one negative eval (a failure, refusal, missing-input, or unauthorized-extra case), and cover each key requirement with at least one eval.

Return ONLY valid JSON (no markdown fences) matching this shape:
{
  "name": "string",
  "description": "string",
  "reason": "why this design, including your reading of any listed ambiguity (1-4 sentences)",
  "inferredCapabilities": ["short tags you actually inferred"],
  "requirementCoverage": [{ "requirement": "string (verbatim from the list)", "coveredBy": ["step_1", "ev2"] }],
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
    "enabledToolIds": ["every tool the steps actually need, nothing more"]
  },
  "s4_guardrails": {
    "worstCase3am": "concrete failure the enabled tools make possible, plus the mitigation",
    "validateInput": true,
    "validateOutput": true,
    "breakers": { "maxSpendUsd": number, "maxLoops": number, "maxTimeSec": number }
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
    "tokenBudget": number,
    "turnLimit": number
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

function correctionsBlock() {
  const recent = loadRecentCorrections(5);
  if (!recent.length) return "";
  const lines = recent.map((c) => {
    const changes = (c.changes || [])
      .slice(0, 6)
      .map((ch) => `    ${ch.path}: "${ch.from}" → "${ch.to}"`)
      .join("\n");
    return `- ${c.name || c.agentId}:\n${changes}`;
  });
  return `\n\nPAST USER CORRECTIONS to sketches from this studio — the user had to fix these by hand. Do not repeat these mistakes:\n${lines.join("\n")}`;
}

async function generateSketch(intent, reqs, modelRef) {
  const system = buildPlannerSystemPrompt();
  const reqList = reqs.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const ambList = reqs.ambiguities.length
    ? `\nAmbiguities to address explicitly in "reason":\n${reqs.ambiguities.map((a) => `- ${a}`).join("\n")}`
    : "";
  const user = `User intent:\n"""${String(intent).trim()}"""\n\nExtracted requirements (cover every one):\n${reqList}${ambList}${correctionsBlock()}\n\nDesign the minimal agent system for this intent. JSON only.`;
  return chatJson({ ref: modelRef, system, user });
}

// ── Pass 3: critique ─────────────────────────────────────────

const CRITIQUE_SYSTEM = `You are a strict design reviewer for agent system sketches. Judge the sketch ONLY against the requirement list — no outside best practices.

Return ONLY valid JSON:
{
  "requirementCoverage": [{ "requirement": "string", "covered": boolean, "coveredBy": ["step or eval ids"], "note": "string" }],
  "issues": [{ "severity": "critical" | "minor", "message": "string", "fix": "concrete instruction for the repair pass" }]
}

Critical issues (any one blocks shipping):
- A requirement not covered by any step or route.
- The sketch inverts or alters a conditional requirement ("if X then Y" implemented as "if not-X then Y", or Y triggered on the wrong branch).
- A step describes an action the enabled tools cannot perform.
- An eval whose expected needle could not appear in a correct run.
Minor: weak eval coverage, vague exit condition, budget mismatches.`;

async function critiqueSketch(rawSketch, reqs, modelRef) {
  const reqList = reqs.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const parsed = await chatJson({
    ref: modelRef,
    system: CRITIQUE_SYSTEM,
    user: `Requirements:\n${reqList}\n\nSketch JSON:\n${JSON.stringify(rawSketch)}`,
  });
  return {
    requirementCoverage: Array.isArray(parsed.requirementCoverage) ? parsed.requirementCoverage : [],
    issues: Array.isArray(parsed.issues) ? parsed.issues : [],
  };
}

// ── Pass 4: repair ───────────────────────────────────────────

async function repairSketch(rawSketch, issues, reqs, modelRef) {
  const system = buildPlannerSystemPrompt();
  const reqList = reqs.requirements.map((r, i) => `${i + 1}. ${r}`).join("\n");
  const issueList = issues
    .map((i) => `- [${i.severity}] ${i.message}${i.fix ? ` FIX: ${i.fix}` : ""}`)
    .join("\n");
  const user = `Your previous sketch has design defects found in review. Fix every listed issue and return the FULL corrected sketch JSON (same shape as before). Change only what the issues require.\n\nRequirements (cover every one):\n${reqList}\n\nIssues:\n${issueList}\n\nPrevious sketch JSON:\n${JSON.stringify(rawSketch)}\n\nJSON only.`;
  return chatJson({ ref: modelRef, system, user });
}

// ── Sanitize ─────────────────────────────────────────────────

/** Enforce least-privilege + step/tool consistency after the model returns. */
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

  // Step/tool consistency: if the steps describe file/web/http actions the
  // toolset can't perform, add the tool instead of shipping a dead plan.
  const autoAddedTools = [];
  for (const miss of detectMissingTools(base)) {
    base.s3_tools.enabledToolIds.push(miss.toolId);
    autoAddedTools.push(miss.toolId);
  }
  base.s3_tools.enabledToolIds = [...new Set(base.s3_tools.enabledToolIds)];

  // Budgets scale with the chain — echoed sample numbers get floored up.
  const stepCount = (base.s1_orchestration.chainSteps || []).length;
  if (stepCount > 0) {
    base.s6_power.turnLimit = Math.max(base.s6_power.turnLimit || 0, stepCount * 2 + 2);
    base.s6_power.tokenBudget = Math.max(base.s6_power.tokenBudget || 0, stepCount * 1500);
    base.s4_guardrails.breakers.maxLoops = Math.max(
      base.s4_guardrails.breakers.maxLoops || 0,
      stepCount + 2
    );
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
    requirementCoverage: raw.requirementCoverage || [],
    autoAddedTools,
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

// ── Orchestrated pipeline ────────────────────────────────────

export async function sketchFromIntentWithModel(intent, modelRef) {
  if (!intent || !String(intent).trim()) {
    throw new Error("Intent is required");
  }
  if (!modelRef) {
    throw new Error("Select a model from your Pi instance");
  }

  const reqs = await extractRequirements(intent, modelRef);

  let raw = await generateSketch(intent, reqs, modelRef);
  let { sketch } = sanitizeSketch(raw, intent, modelRef);

  let critique = { requirementCoverage: [], issues: [] };
  let rounds = 0;
  for (let round = 0; round < REPAIR_ROUNDS; round++) {
    critique = await critiqueSketch(raw, reqs, modelRef);
    const lintFindings = lintAgent(sketch);
    const critical = [
      ...critique.issues.filter((i) => i.severity === "critical"),
      ...lintFindings
        .filter((f) => f.severity === "error")
        .map((f) => ({ severity: "critical", message: f.message, fix: "" })),
    ];
    if (!critical.length) break;

    rounds++;
    raw = await repairSketch(raw, [...critical, ...critique.issues.filter((i) => i.severity === "minor")], reqs, modelRef);
    ({ sketch } = sanitizeSketch(raw, intent, modelRef));
  }

  sketch._sketch = {
    ...sketch._sketch,
    requirements: reqs.requirements,
    ambiguities: reqs.ambiguities,
    critique,
    lint: lintAgent(sketch),
    repairRounds: rounds,
  };

  return { sketch };
}
