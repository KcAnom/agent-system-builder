import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { nanoid } from "nanoid";
import { createEmptyAgent, scoreAgent, shipChecklist } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = path.join(__dirname, "..", "data", "agents");

function ensure() {
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

function agentPath(id) {
  return path.join(AGENTS_DIR, `${id}.json`);
}

export function listAgents() {
  ensure();
  return fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const a = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, f), "utf8"));
      return {
        id: a.id,
        name: a.name,
        description: a.description,
        version: a.version,
        pattern: a.s1_orchestration?.pattern,
        score: scoreAgent(a),
        updatedAt: a.updatedAt,
        createdAt: a.createdAt,
      };
    })
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

export function getAgent(id) {
  ensure();
  const p = agentPath(id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const IRREVERSIBLE_TOOLS = new Set(["send_email", "refund_payment"]);

/** Never persist gates/tools the system didn't enable — strips invented side-effects. */
function sanitizeAgentSideEffects(agent) {
  if (!agent) return agent;
  const enabled = new Set(agent.s3_tools?.enabledToolIds || []);
  if (!agent.s4_guardrails) agent.s4_guardrails = {};

  // Irreversibility line may only include enabled irreversible tools
  const line = (agent.s4_guardrails.irreversibilityLine || []).filter(
    (id) => enabled.has(id) && IRREVERSIBLE_TOOLS.has(id)
  );
  // Also auto-include any enabled irreversible tool missing from the line
  for (const id of IRREVERSIBLE_TOOLS) {
    if (enabled.has(id) && !line.includes(id)) line.push(id);
  }
  agent.s4_guardrails.irreversibilityLine = line;
  agent.s4_guardrails.humanGate = line.length > 0;

  // Don't leave email/refund "worst case" copy when those tools aren't enabled
  if (!line.length) {
    const wc = agent.s4_guardrails.worstCase3am || "";
    if (/email|refund/i.test(wc) && !/spend|loop|breaker/i.test(wc)) {
      agent.s4_guardrails.worstCase3am =
        "No irreversible tools enabled; worst case is wasted spend/loops (breakers).";
    }
  }
  return agent;
}

export function saveAgent(agent) {
  ensure();
  if (!agent.id) agent.id = `agt_${nanoid(10)}`;
  sanitizeAgentSideEffects(agent);
  agent.updatedAt = new Date().toISOString();
  if (!agent.createdAt) agent.createdAt = agent.updatedAt;
  fs.writeFileSync(agentPath(agent.id), JSON.stringify(agent, null, 2));
  return agent;
}

export function createAgent(partial = {}) {
  const agent = createEmptyAgent({
    ...partial,
    id: `agt_${nanoid(10)}`,
  });
  return saveAgent(agent);
}

export function updateAgent(id, patch) {
  const existing = getAgent(id);
  if (!existing) return null;
  const merged = deepMerge(existing, patch);
  merged.id = id;
  // bump patch version lightly
  if (existing.s7_chassis?.versionEverything) {
    const parts = String(existing.version || "0.1.0").split(".").map(Number);
    parts[2] = (parts[2] || 0) + 1;
    merged.version = parts.join(".");
  }
  return saveAgent(merged);
}

export function deleteAgent(id) {
  ensure();
  const p = agentPath(id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

export function exportAgentBundle(id) {
  const agent = getAgent(id);
  if (!agent) return null;
  return {
    format: "agent-system-blueprint/v1",
    exportedAt: new Date().toISOString(),
    score: scoreAgent(agent),
    checklist: shipChecklist(agent),
    agent,
  };
}

export function duplicateAgent(id) {
  const agent = getAgent(id);
  if (!agent) return null;
  const copy = createEmptyAgent({
    ...agent,
    id: undefined,
    name: `${agent.name} (copy)`,
    createdAt: undefined,
    updatedAt: undefined,
  });
  copy.id = `agt_${nanoid(10)}`;
  return saveAgent(copy);
}

function deepMerge(a, b) {
  if (Array.isArray(b)) return b.slice();
  if (b && typeof b === "object") {
    const out = { ...a };
    for (const k of Object.keys(b)) {
      out[k] =
        a && typeof a[k] === "object" && !Array.isArray(a[k])
          ? deepMerge(a[k], b[k])
          : b[k];
    }
    return out;
  }
  return b === undefined ? a : b;
}

/** Seed demo agents on first boot */
export function seedIfEmpty() {
  ensure();
  if (listAgents().length > 0) return;

  createAgent({
    name: "Support Triage Agent",
    description:
      "Routes refund vs technical questions, drafts replies, gates irreversible actions.",
    core: {
      goal: "Triage support tickets: classify, draft a reply, never refund or email without approval.",
      systemPrompt:
        "You are a careful support agent. Prefer routing over free-form. Use memory for ticket state. Never send email or refund without human approval.",
      exitCondition: "Draft reply ready and ticket classified, or human takeover requested.",
    },
    s1_orchestration: {
      pattern: "routing",
      routes: [
        { id: "r1", name: "Refunds", match: "refund|charge|money", prompt: "Handle billing carefully." },
        { id: "r2", name: "Technical", match: "bug|error|crash", prompt: "Collect repro steps." },
        { id: "r3", name: "Default", match: "default", prompt: "General support." },
      ],
      escalationRule: "Escalate to orchestrator+workers if multi-system investigation needed.",
    },
    s3_tools: {
      enabledToolIds: ["memory_write", "memory_read", "web_search", "send_email", "refund_payment"],
    },
    s4_guardrails: {
      worstCase3am: "Issues a refund or emails a customer incorrectly at 3 A.M.",
      irreversibilityLine: ["send_email", "refund_payment"],
      humanGate: true,
      breakers: { maxSpendUsd: 0.5, maxLoops: 8, maxTimeSec: 120 },
    },
    s5_instruments: {
      traces: true,
      evals: [
        {
          id: "ev1",
          name: "Refund request (must hit human gate)",
          input: "Please refund order 88231, charged twice.",
          expected: "contains:human gate",
        },
        {
          id: "ev2",
          name: "Bug report (complete without side effects)",
          input: "App crashes when I click export. Help me triage.",
          expected: "contains:complete",
        },
      ],
    },
    s6_power: {
      modelMap: {
        reason: "large",
        classify: "small",
        extract: "small",
        format: "small",
        summarize: "small",
        judge: "large",
      },
      tokenBudget: 6000,
      turnLimit: 8,
    },
  });

  createAgent({
    name: "Research Writer",
    description: "Orchestrator + workers research agent with compaction and external memory.",
    core: {
      goal: "Research a topic and produce a short cited brief.",
      systemPrompt:
        "You are a research lead. Break work into subtasks. Prefer JIT retrieval. Write decisions to memory. Summarize sources; do not invent citations.",
      exitCondition: "Brief delivered with sources, or budget exhausted with partial brief.",
    },
    s1_orchestration: {
      pattern: "orchestrator_workers",
      nested: { router: false, workers: true, judge: true },
      judgeCriteria: "Pass if claims have sources and brief answers the question.",
      escalationRule: "Always agentic for open research.",
    },
    s2_context: {
      jitContext: true,
      externalMemory: true,
      compactionThreshold: 0.7,
    },
    s3_tools: {
      enabledToolIds: ["web_search", "memory_write", "memory_read", "write_file"],
    },
    s4_guardrails: {
      worstCase3am: "Publishes uncited claims as fact.",
      // No email tool enabled → no email gate invented
      irreversibilityLine: [],
      humanGate: false,
      breakers: { maxSpendUsd: 1.5, maxLoops: 12, maxTimeSec: 300 },
    },
    s5_instruments: {
      evals: [
        {
          id: "ev1",
          name: "Quick brief",
          input: "Write a brief on prompt caching benefits for agents.",
          expected: "contains:Result",
        },
      ],
    },
  });
}
