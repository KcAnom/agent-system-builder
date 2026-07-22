import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import {
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  exportAgentBundle,
  duplicateAgent,
  seedIfEmpty,
} from "./store.js";
import {
  ORCHESTRATION_PATTERNS,
  DEFAULT_TOOLS,
  createEmptyAgent,
  scoreAgent,
  shipChecklist,
} from "./schema.js";
import {
  runAgent,
  runEvals,
  listRuns,
  loadRun,
  loadMemory,
  saveMemory,
} from "./runtime.js";
import { listSelectableModels, reloadRuntime, getPiPaths } from "./pi-models.js";
import { sketchFromIntentWithModel } from "./planner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 4747;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

seedIfEmpty();

// ── Meta / blueprint reference ─────────────────────────────
app.get("/api/health", async (_req, res) => {
  let pi = { readyCount: 0, modelsPath: null };
  try {
    const listed = await listSelectableModels();
    pi = {
      readyCount: listed.readyCount,
      totalModels: listed.models.length,
      modelsPath: listed.modelsPath,
    };
  } catch (err) {
    pi = { readyCount: 0, error: err.message, ...getPiPaths() };
  }
  res.json({
    ok: true,
    name: "Agent System Studio",
    blueprint: "Hyperautomation Labs — Agent System Design Blueprint",
    pi,
    // legacy flag: any sketch-capable model ready from Pi
    llm: pi.readyCount > 0,
    port: PORT,
  });
});

/** Models via Pi's ModelRuntime (builtin providers + models.json + auth.json). */
app.get("/api/models", async (_req, res) => {
  try {
    await reloadRuntime(); // pick up edits to ~/.pi config
    res.json(await listSelectableModels());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Model-guided sketch — requires modelRef from /api/models */
app.post("/api/sketch", async (req, res) => {
  const { intent, modelRef } = req.body || {};
  if (!intent || !String(intent).trim()) {
    return res.status(400).json({ error: "intent is required" });
  }
  if (!modelRef) {
    return res.status(400).json({ error: "modelRef is required — pick a model from your Pi instance" });
  }
  try {
    const result = await sketchFromIntentWithModel(intent, modelRef);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.get("/api/meta/patterns", (_req, res) => {
  res.json(ORCHESTRATION_PATTERNS);
});

app.get("/api/meta/tools", (_req, res) => {
  res.json(
    DEFAULT_TOOLS.map(({ mockResponse, ...t }) => ({
      ...t,
      hasMock: typeof mockResponse === "function",
    }))
  );
});

app.get("/api/meta/blank", (_req, res) => {
  res.json(createEmptyAgent());
});

// ── Agents CRUD ────────────────────────────────────────────
app.get("/api/agents", (_req, res) => {
  res.json(listAgents());
});

app.post("/api/agents", (req, res) => {
  const agent = createAgent(req.body || {});
  res.status(201).json({
    agent,
    score: scoreAgent(agent),
    checklist: shipChecklist(agent),
  });
});

app.get("/api/agents/:id", (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json({
    agent,
    score: scoreAgent(agent),
    checklist: shipChecklist(agent),
  });
});

app.put("/api/agents/:id", (req, res) => {
  const agent = updateAgent(req.params.id, req.body || {});
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json({
    agent,
    score: scoreAgent(agent),
    checklist: shipChecklist(agent),
  });
});

app.delete("/api/agents/:id", (req, res) => {
  const ok = deleteAgent(req.params.id);
  if (!ok) return res.status(404).json({ error: "Agent not found" });
  res.json({ ok: true });
});

app.post("/api/agents/:id/duplicate", (req, res) => {
  const agent = duplicateAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.status(201).json({ agent, score: scoreAgent(agent) });
});

app.get("/api/agents/:id/export", (req, res) => {
  const bundle = exportAgentBundle(req.params.id);
  if (!bundle) return res.status(404).json({ error: "Agent not found" });
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${bundle.agent.name.replace(/\s+/g, "-").toLowerCase()}.agent.json"`
  );
  res.json(bundle);
});

app.post("/api/agents/import", (req, res) => {
  const body = req.body || {};
  const raw = body.agent || body;
  const agent = createAgent({
    ...raw,
    id: undefined,
    name: raw.name ? `${raw.name}` : "Imported Agent",
  });
  res.status(201).json({ agent, score: scoreAgent(agent) });
});

// ── Memory (S2 external) ───────────────────────────────────
app.get("/api/agents/:id/memory", (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: "Agent not found" });
  res.json(loadMemory(req.params.id));
});

app.put("/api/agents/:id/memory", (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: "Agent not found" });
  const mem = req.body || { notes: [] };
  saveMemory(req.params.id, mem);
  res.json(mem);
});

app.delete("/api/agents/:id/memory", (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: "Agent not found" });
  saveMemory(req.params.id, { notes: [] });
  res.json({ ok: true });
});

// ── Run (core loop) ────────────────────────────────────────
app.post("/api/agents/:id/run", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const { message, resumeRunId, modelRef } = req.body || {};
  if (!message && !resumeRunId) {
    return res.status(400).json({ error: "message is required" });
  }
  try {
    const run = await runAgent(agent, message || "", { resumeRunId, modelRef });
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

/** Streaming run — NDJSON lines: {type:"event",event} … {type:"done",run} */
app.post("/api/agents/:id/run-stream", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const { message, resumeRunId, modelRef } = req.body || {};
  if (!message && !resumeRunId) {
    return res.status(400).json({ error: "message is required" });
  }
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache");
  const send = (obj) => res.write(JSON.stringify(obj) + "\n");
  try {
    const run = await runAgent(agent, message || "", {
      resumeRunId,
      modelRef,
      onEvent: (ev) => send({ type: "event", event: ev }),
    });
    send({ type: "done", run });
  } catch (err) {
    send({ type: "error", error: err.message || String(err) });
  }
  res.end();
});

app.get("/api/agents/:id/runs", (req, res) => {
  if (!getAgent(req.params.id)) return res.status(404).json({ error: "Agent not found" });
  res.json(listRuns(req.params.id));
});

app.get("/api/runs/:runId", (req, res) => {
  const run = loadRun(req.params.runId);
  if (!run) return res.status(404).json({ error: "Run not found" });
  res.json(run);
});

// ── Evals (S5) ─────────────────────────────────────────────
app.post("/api/agents/:id/evals", async (req, res) => {
  const agent = getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  try {
    const report = await runEvals(agent, { modelRef: req.body?.modelRef });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// SPA fallback
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

app.listen(PORT, "127.0.0.1", async () => {
  let piNote = "Pi models unavailable";
  try {
    const listed = await listSelectableModels();
    piNote = `Pi models available: ${listed.readyCount}`;
  } catch (err) {
    piNote = `Pi models error: ${err.message}`;
  }
  console.log(`\n  ⚙  Agent System Studio`);
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → Blueprint layers S1–S7 ready`);
  console.log(`  → ${piNote} (via Pi ModelRuntime)\n`);
});
