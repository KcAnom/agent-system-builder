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

export function saveAgent(agent) {
  ensure();
  if (!agent.id) agent.id = `agt_${nanoid(10)}`;
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

/** Compare agents ignoring volatile fields, so no-op saves don't bump versions. */
function significantJson(agent) {
  const { updatedAt, version, ...rest } = agent || {};
  return JSON.stringify(rest);
}

export function updateAgent(id, patch) {
  const existing = getAgent(id);
  if (!existing) return null;
  const merged = deepMerge(existing, patch);
  merged.id = id;
  const changed = significantJson(merged) !== significantJson(existing);
  if (!changed) return existing;
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

/** Seed one example agent on first boot */
export function seedIfEmpty() {
  ensure();
  if (listAgents().length > 0) return;

  createAgent({
    name: "Repo Insight Agent",
    description: "Reads a repository, maps its structure, and writes a findings report.",
    core: {
      goal: "Analyze a repository's structure and conventions, then write a concise findings report.",
      systemPrompt:
        "You are a repository analysis agent. Read files just-in-time, store key findings in memory, and produce a structured report. Do not invent file contents.",
      exitCondition: "Findings report written with structure, conventions, and open questions.",
    },
    s1_orchestration: {
      pattern: "prompt_chaining",
      escalationRule: "Escalate to orchestrator+workers when the repo is large or multi-language.",
    },
    s3_tools: {
      enabledToolIds: ["read_file", "write_file", "memory_write", "memory_read"],
    },
    s4_guardrails: {
      worstCase3am: "Wasted spend or loops on a large repo — breakers cover it.",
      breakers: { maxSpendUsd: 1.0, maxLoops: 10, maxTimeSec: 180 },
    },
    s5_instruments: {
      evals: [
        {
          id: "ev1",
          name: "Produces a report",
          input: "Analyze this repository and summarize its structure.",
          expected: "contains:Result",
        },
      ],
    },
  });
}
