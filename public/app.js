/* Agent System Studio — fleet · canvas · live operator */
const API = "";

const LAYERS = [
  {
    id: "s2",
    className: "s2",
    layer: "S2",
    name: "Context + memory",
    blurb: "Attention budget · JIT · pump",
  },
  {
    id: "s1",
    className: "s1",
    layer: "S1",
    name: "Orchestration",
    blurb: "Pattern · freedom lanes",
  },
  {
    id: "s3",
    className: "s3",
    layer: "S3",
    name: "Tools",
    blurb: "Few · sharp · documented",
  },
  {
    id: "s4",
    className: "s4",
    layer: "S4",
    name: "Guardrails",
    blurb: "3 A.M. · gates · breakers",
  },
  {
    id: "core",
    className: "core",
    layer: "CORE",
    name: "Model · tools · loop",
    blurb: "reason · decide · EXIT",
  },
  {
    id: "s5",
    className: "s5",
    layer: "S5",
    name: "Instruments",
    blurb: "Traces · evals · drift",
  },
  {
    id: "s6",
    className: "s6",
    layer: "S6",
    name: "Power",
    blurb: "Route · cache · budget",
  },
  {
    id: "ship",
    className: "ship",
    layer: "SHIP",
    name: "Ship checklist",
    blurb: "Score · evals · export",
  },
  {
    id: "s7",
    className: "s7",
    layer: "S7",
    name: "Chassis",
    blurb: "Checkpoint · never restart",
  },
];

const state = {
  agents: [],
  agent: null,
  score: 0,
  checklist: [],
  patterns: [],
  tools: [],
  lastRun: null,
  dirty: false,
  activeLayer: "core",
  sketch: null,
  piModels: [],
  piModelsMeta: null,
};

// ── helpers ────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new Error(data?.error || res.statusText);
  return data;
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function toast(msg, kind = "ok") {
  const el = $("#toast");
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function scoreClass(n) {
  if (n >= 80) return "good";
  if (n >= 50) return "mid";
  return "low";
}

/** Options for any model <select>: simulator + every ready Pi model. */
function modelOptionsHtml(selectedRef, { simulatorLabel = "Simulator (no cost)", blankLabel = null } = {}) {
  const ready = state.piModels.filter((m) => m.ready);
  const blank = blankLabel ? `<option value="" ${!selectedRef ? "selected" : ""}>${esc(blankLabel)}</option>` : "";
  const sim = `<option value="simulator" ${selectedRef === "simulator" ? "selected" : ""}>${esc(simulatorLabel)}</option>`;
  const opts = ready
    .map(
      (m) =>
        `<option value="${escAttr(m.ref)}" ${selectedRef === m.ref ? "selected" : ""}>${esc(m.providerName)} · ${esc(m.modelName)}</option>`
    )
    .join("");
  return blank + sim + opts;
}

/** Single place dirty state changes — keeps the Save button honest. */
function setDirty(v) {
  state.dirty = v;
  const btn = $("#btnSave");
  if (btn) btn.textContent = v ? "Save •" : "Save";
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function escAttr(s) {
  return esc(s).replace(/'/g, "&#39;");
}

function freedomFor(pattern) {
  const p = state.patterns.find((x) => x.id === pattern);
  return p?.freedom || 1;
}

// ── fleet ──────────────────────────────────────────────────
async function loadFleet() {
  state.agents = await api("/api/agents");
  renderFleet();
}

function renderFleet() {
  const el = $("#fleetList");
  if (!state.agents.length) {
    el.innerHTML = `<div class="muted" style="padding:12px;font-size:12px">No systems yet. Sketch one from intent above.</div>`;
    return;
  }
  el.innerHTML = state.agents
    .map((a) => {
      const active = state.agent?.id === a.id ? "active" : "";
      return `
      <button type="button" class="fleet-item ${active}" data-id="${a.id}">
        <h3>${esc(a.name)} <span class="fleet-dup" data-dup="${a.id}" title="Duplicate">⧉</span></h3>
        <p>${esc(a.description || "No description")}</p>
        <div class="fleet-meta">
          <span class="tag">${esc(a.pattern || "—")}</span>
          <span class="tag">v${esc(a.version || "0.1.0")}</span>
          <span class="score ${scoreClass(a.score)}">${a.score}%</span>
        </div>
      </button>`;
    })
    .join("");
  $$(".fleet-item", el).forEach((btn) => {
    btn.addEventListener("click", () => openAgent(btn.dataset.id));
  });
  $$(".fleet-dup", el).forEach((d) => {
    d.addEventListener("click", async (e) => {
      e.stopPropagation();
      const data = await api(`/api/agents/${d.dataset.dup}/duplicate`, { method: "POST", body: "{}" });
      await loadFleet();
      await openAgent(data.agent.id);
      toast("Duplicated");
    });
  });
}

// ── open system ────────────────────────────────────────────
async function openAgent(id) {
  if (state.dirty && state.agent && state.agent.id !== id) {
    if (!confirm(`"${state.agent.name}" has unsaved changes. Discard them?`)) return;
  }
  const data = await api(`/api/agents/${id}`);
  state.agent = data.agent;
  state.score = data.score;
  state.checklist = data.checklist;
  setDirty(false);
  state.lastRun = null;
  state.activeLayer = "core";

  $("#welcome").classList.add("hidden");
  $("#systemView").classList.remove("hidden");
  $("#btnSave").disabled = false;
  $("#btnExport").disabled = false;
  $("#btnDelete").disabled = false;
  $("#btnRun").disabled = false;

  updateStageChrome();
  renderCanvas();
  renderInspector();
  resetRunPanel();
  syncRunModelToAgent();
  loadRuns();
  loadMemory();
  renderFleet();
}

function updateStageChrome() {
  const a = state.agent;
  if (!a) return;
  $("#stageName").textContent = a.name;
  $("#stageMeta").textContent = `${a.id} · v${a.version} · ${a.s1_orchestration?.pattern || "—"}`;
  const chip = $("#scoreChip");
  chip.textContent = `${state.score}%`;
  chip.className = `score-chip ${scoreClass(state.score)}`;
  updateBreakerCaps();
}

function layerStatus(id) {
  const a = state.agent;
  if (!a) return "bad";
  if (id === "core") {
    return a.core?.goal && a.core?.exitCondition ? "ok" : a.core?.goal ? "warn" : "bad";
  }
  if (id === "s1") return a.s1_orchestration?.pattern ? "ok" : "bad";
  if (id === "s2") {
    return a.s2_context?.jitContext && a.s2_context?.externalMemory ? "ok" : "warn";
  }
  if (id === "s3") {
    const n = a.s3_tools?.enabledToolIds?.length || 0;
    return n > 0 && n <= 8 ? "ok" : n ? "warn" : "bad";
  }
  if (id === "s4") {
    return a.s4_guardrails?.worstCase3am && a.s4_guardrails?.breakers?.maxLoops
      ? "ok"
      : "warn";
  }
  if (id === "s5") {
    const n = a.s5_instruments?.evals?.length || 0;
    return a.s5_instruments?.traces && n >= 1 ? "ok" : n ? "warn" : "bad";
  }
  if (id === "s6") return a.s6_power?.tokenBudget && a.s6_power?.turnLimit ? "ok" : "warn";
  if (id === "s7") return a.s7_chassis?.checkpoints ? "ok" : "bad";
  if (id === "ship") {
    const ok = (state.checklist || []).filter((c) => c.ok).length;
    const total = (state.checklist || []).length || 1;
    const pct = ok / total;
    return pct >= 0.85 ? "ok" : pct >= 0.5 ? "warn" : "bad";
  }
  return "warn";
}

function renderCanvas() {
  const grid = $("#canvasGrid");
  const a = state.agent;
  const fre = freedomFor(a.s1_orchestration?.pattern);
  grid.innerHTML = LAYERS.map((m) => {
    const st = layerStatus(m.id);
    const active = state.activeLayer === m.id ? "active" : "";
    const extra =
      m.id === "core"
        ? `<div class="loop">EXIT · ${esc((a.core?.exitCondition || "not set").slice(0, 48))}</div>`
        : m.id === "s1"
          ? `<div class="freedom-bar"><i style="width:${(fre / 5) * 100}%"></i></div>
             <div class="blurb">${esc(a.s1_orchestration?.pattern || "")} · freedom ${fre}/5</div>`
          : `<div class="blurb">${esc(m.blurb)}</div>`;
    return `
      <button type="button" class="mod ${m.className} ${active}" data-layer="${m.id}">
        <span class="status ${st}"></span>
        <div class="layer">${m.layer}</div>
        <div class="name">${m.id === "core" ? "MODEL" : esc(m.name)}</div>
        ${extra}
      </button>`;
  }).join("");

  $$(".mod", grid).forEach((btn) => {
    btn.addEventListener("click", () => {
      collectForm(); // keep edits from the current layer before switching
      state.activeLayer = btn.dataset.layer;
      renderCanvas();
      renderInspector();
    });
  });
}

// ── inspector ──────────────────────────────────────────────
function renderInspector() {
  const a = state.agent;
  const el = $("#inspector");
  if (!a) return;
  const layer = state.activeLayer;
  const heads = {
    core: ["The core", "Model + tools + loop", "If code decides the path it’s a workflow; if the model decides, it’s an agent."],
    s1: ["Subsystem 1", "Orchestration", "Five patterns, increasing freedom. Nest router → workers → judge."],
    s2: ["Subsystem 2", "Context + memory", "Window = attention budget. The pump to external memory is the product."],
    s3: ["Subsystem 3", "Tools", "Small surface. Sharp edges. Design returns the model can act on."],
    s4: ["Subsystem 4", "Guardrails", "Design for 3 A.M. Autonomy is earned in rings."],
    s5: ["Subsystem 5", "Instruments", "An agent without evals is a rumor."],
    s6: ["Subsystem 6", "Power", "Loops multiply cost. Match model to the step."],
    s7: ["Subsystem 7", "Chassis", "Crash = checkpoint, never restart. Boring is a compliment."],
    ship: ["Ship", "Blueprint checklist", "Every unticked box is a known production risk."],
  };
  const h = heads[layer] || heads.core;

  let body = "";
  if (layer === "core") body = formCore(a);
  else if (layer === "s1") body = formS1(a);
  else if (layer === "s2") body = formS2(a);
  else if (layer === "s3") body = formS3(a);
  else if (layer === "s4") body = formS4(a);
  else if (layer === "s5") body = formS5(a);
  else if (layer === "s6") body = formS6(a);
  else if (layer === "s7") body = formS7(a);
  else if (layer === "ship") body = formShip();

  el.innerHTML = `
    <div class="inspector-head">
      <div>
        <div class="eyebrow">${esc(h[0])}</div>
        <h2>${esc(h[1])}</h2>
        <p>${esc(h[2])}</p>
      </div>
      <button class="btn btn-primary btn-sm" id="btnSaveInline">Save layer</button>
    </div>
    ${body}`;

  $("#btnSaveInline")?.addEventListener("click", () => saveAgent());
  wireInspectorHandlers(layer);
}

function formCore(a) {
  return `
  <div class="form-grid">
    <div class="form-row">
      <div class="field"><label>Name</label><input id="f-name" type="text" value="${escAttr(a.name)}" /></div>
      <div class="field"><label>Version</label><input id="f-version" class="mono" type="text" value="${escAttr(a.version)}" readonly /></div>
    </div>
    <div class="field"><label>Description</label><input id="f-description" type="text" value="${escAttr(a.description || "")}" /></div>
    <div class="field"><label>Goal</label><textarea id="f-goal">${esc(a.core?.goal || "")}</textarea>
      <span class="hint">Open-ended → agent. Known steps → workflow / chain.</span></div>
    <div class="field"><label>System prompt</label><textarea id="f-system" class="mono" rows="5">${esc(a.core?.systemPrompt || "")}</textarea></div>
    <div class="field"><label>Exit condition</label><textarea id="f-exit" rows="2">${esc(a.core?.exitCondition || "")}</textarea></div>
  </div>`;
}

function formS1(a) {
  const current = a.s1_orchestration?.pattern;
  const patterns = state.patterns
    .map(
      (p) => `
    <button type="button" class="pattern-item ${p.id === current ? "selected" : ""}" data-id="${p.id}">
      <div class="name">${esc(p.name)} <span class="freedom">freedom ${p.freedom}/5</span></div>
      <div class="desc">${esc(p.description)}</div>
      <div class="when">when · ${esc(p.when)}</div>
    </button>`
    )
    .join("");

  // Pattern-specific editor: only show the controls the selected pattern uses
  let patternEditor = "";
  if (current === "prompt_chaining" || current === "parallelization") {
    const steps = (a.s1_orchestration?.chainSteps || [])
      .map(
        (s, i) => `
      <div class="step-row" data-i="${i}">
        <div class="idx">${i + 1}</div>
        <input data-k="name" value="${escAttr(s.name)}" placeholder="Name" />
        <input data-k="prompt" value="${escAttr(s.prompt)}" placeholder="Instruction" />
        <button type="button" class="btn btn-sm btn-ghost btn-rm-step">✕</button>
      </div>`
      )
      .join("");
    patternEditor = `
    <div class="card">
      <div class="card-head"><h3>Chain steps</h3><button class="btn btn-sm" id="btnAddStep" type="button">+ Step</button></div>
      <div class="step-list" id="chainSteps">${steps || '<div class="muted">No steps — add the sequence the run should follow.</div>'}</div>
      <span class="hint">Live runs feed step N's instruction on turn N.</span>
    </div>`;
  } else if (current === "routing") {
    const routes = (a.s1_orchestration?.routes || [])
      .map(
        (r, i) => `
      <div class="route-row" data-i="${i}">
        <input data-k="name" value="${escAttr(r.name || "")}" placeholder="Lane name" />
        <input data-k="match" class="mono" value="${escAttr(r.match || "")}" placeholder="signals regex or 'default'" />
        <input data-k="prompt" value="${escAttr(r.prompt || "")}" placeholder="Lane instruction" />
        <button type="button" class="btn btn-sm btn-ghost btn-rm-route">✕</button>
      </div>`
      )
      .join("");
    patternEditor = `
    <div class="card">
      <div class="card-head"><h3>Routes</h3><button class="btn btn-sm" id="btnAddRoute" type="button">+ Route</button></div>
      <div class="step-list" id="routeList">${routes || '<div class="muted">No lanes yet. Add one per request category.</div>'}</div>
      <span class="hint">Live runs classify with a real model call, then pin the winning lane's instruction.</span>
    </div>`;
  } else if (current === "orchestrator_workers") {
    patternEditor = `
    <div class="card">
      <h3>Worker contract</h3>
      <div class="field"><textarea id="f-worker" rows="3">${esc(a.s1_orchestration?.workerPrompt || "")}</textarea>
      <span class="hint">Injected into every live turn as the worker's contract.</span></div>
    </div>`;
  } else if (current === "evaluator_optimizer") {
    patternEditor = `
    <div class="card">
      <h3>Judge criteria</h3>
      <div class="field"><textarea id="f-judge" rows="3">${esc(a.s1_orchestration?.judgeCriteria || "")}</textarea>
      <span class="hint">Live runs make a real judge call against these criteria before "done" is accepted. A FAIL verdict bounces the output back with feedback.</span></div>
    </div>`;
  }

  const judgeField =
    current === "evaluator_optimizer"
      ? ""
      : `<div class="field" style="margin-top:10px"><label>Judge criteria (nested judge)</label><textarea id="f-judge" rows="2">${esc(a.s1_orchestration?.judgeCriteria || "")}</textarea></div>`;

  return `
  <div class="card"><h3>Pattern</h3><div class="pattern-list" id="patternList">${patterns}</div></div>
  ${patternEditor}
  <div class="field"><label>Escalation rule</label><textarea id="f-escalation" rows="2">${esc(a.s1_orchestration?.escalationRule || "")}</textarea></div>
  ${judgeField}
  <div class="form-row" style="margin-top:12px">
    <div class="switch-row"><div><span>Nest router</span><small>Front-door classify</small></div>
      <label class="toggle"><input type="checkbox" id="f-nest-router" ${a.s1_orchestration?.nested?.router ? "checked" : ""} /><i></i></label></div>
    <div class="switch-row"><div><span>Nest workers</span><small>Subtask hands</small></div>
      <label class="toggle"><input type="checkbox" id="f-nest-workers" ${a.s1_orchestration?.nested?.workers ? "checked" : ""} /><i></i></label></div>
  </div>
  <div class="switch-row" style="margin-top:8px"><div><span>Nest judge</span><small>Quality gate</small></div>
    <label class="toggle"><input type="checkbox" id="f-nest-judge" ${a.s1_orchestration?.nested?.judge ? "checked" : ""} /><i></i></label></div>`;
}

function formS2(a) {
  return `
  <div class="form-grid">
    <div class="field"><label>System-prompt altitude</label>
      <select id="f-altitude">
        <option value="rigid" ${a.s2_context?.systemPromptAltitude === "rigid" ? "selected" : ""}>Rigid</option>
        <option value="heuristics" ${a.s2_context?.systemPromptAltitude !== "rigid" && a.s2_context?.systemPromptAltitude !== "vague" ? "selected" : ""}>Heuristics</option>
        <option value="vague" ${a.s2_context?.systemPromptAltitude === "vague" ? "selected" : ""}>Vague</option>
      </select>
    </div>
    <div class="switch-row"><div><span>Just-in-time context</span><small>Pointers, not payloads</small></div>
      <label class="toggle"><input type="checkbox" id="f-jit" ${a.s2_context?.jitContext !== false ? "checked" : ""} /><i></i></label></div>
    <div class="switch-row"><div><span>External memory</span><small>Notes outlive the window</small></div>
      <label class="toggle"><input type="checkbox" id="f-extmem" ${a.s2_context?.externalMemory !== false ? "checked" : ""} /><i></i></label></div>
    <div class="form-row">
      <div class="field"><label>Compaction threshold</label>
        <input type="number" id="f-compact" min="0.3" max="0.95" step="0.05" value="${a.s2_context?.compactionThreshold ?? 0.75}" /></div>
      <div class="field"><label>Keep through compaction</label>
        <input type="text" id="f-compact-keep" class="mono" value="${escAttr((a.s2_context?.compactionKeep || []).join(", "))}" /></div>
    </div>
  </div>`;
}

function formS3(a) {
  const enabled = new Set(a.s3_tools?.enabledToolIds || []);
  const custom = a.s3_tools?.customTools || [];
  const all = [...state.tools, ...custom.map((t) => ({ ...t, custom: true }))];
  const tools = all
    .map((t) => {
      const id = t.id || t.name;
      return `
      <div class="tool-item ${t.irreversible ? "irreversible" : ""}">
        <label class="toggle"><input type="checkbox" data-tool="${escAttr(id)}" ${enabled.has(id) ? "checked" : ""} /><i></i></label>
        <div>
          <div class="tname">${esc(id)} ${t.irreversible ? '<span class="badge warn">irreversible</span>' : ""} ${t.custom ? '<span class="badge good">custom</span>' : ""}</div>
          <div class="tdesc">${esc(t.description || "")}</div>
        </div>
      </div>`;
    })
    .join("");
  return `
  <div class="card"><h3>Tool bay</h3><div class="tool-list" id="toolList">${tools}</div></div>
  <div class="card">
    <h3>Workspace</h3>
    <div class="field">
      <label>Folder for read_file / write_file</label>
      <input id="f-workspace" class="mono" placeholder="blank = sandboxed data/workspaces/${escAttr(a.id || "")}" value="${escAttr(a.s3_tools?.workspaceDir || "")}" />
      <span class="hint">Absolute path (e.g. a repo to analyze). Tools cannot escape this folder — traversal and symlink escapes are refused.</span>
    </div>
  </div>
  <div class="card">
    <h3>Custom tool</h3>
    <div class="form-row">
      <div class="field"><label>id</label><input id="f-custom-id" class="mono" placeholder="crm_lookup" /></div>
      <div class="field"><label>description</label><input id="f-custom-desc" placeholder="Look up a contact" /></div>
    </div>
    <button class="btn btn-sm" id="btnAddCustomTool" type="button" style="margin-top:8px">Add tool</button>
  </div>`;
}

function formS4(a) {
  const b = a.s4_guardrails?.breakers || {};
  return `
  <div class="rings">
    <div class="ring"><div class="rt">Outer · Permissions</div>Least privilege. Read before write.</div>
    <div class="ring"><div class="rt">Middle · Validation</div>Injection in · side-effects out.</div>
    <div class="ring"><div class="rt">Around · Breakers</div>Spend · loops · time · token fuses.</div>
  </div>
  <div class="form-grid">
    <div class="field"><label>3 A.M. worst case</label><textarea id="f-3am" rows="2">${esc(a.s4_guardrails?.worstCase3am || "")}</textarea></div>
    <div class="form-row">
      <div class="switch-row"><div><span>Validate input</span></div>
        <label class="toggle"><input type="checkbox" id="f-val-in" ${a.s4_guardrails?.validateInput !== false ? "checked" : ""} /><i></i></label></div>
      <div class="switch-row"><div><span>Validate output</span></div>
        <label class="toggle"><input type="checkbox" id="f-val-out" ${a.s4_guardrails?.validateOutput !== false ? "checked" : ""} /><i></i></label></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Max spend USD</label><input type="number" id="f-max-spend" step="0.1" value="${b.maxSpendUsd ?? 1}" /></div>
      <div class="field"><label>Max loops</label><input type="number" id="f-max-loops" value="${b.maxLoops ?? 12}" /></div>
    </div>
    <div class="field"><label>Max time (sec)</label><input type="number" id="f-max-time" value="${b.maxTimeSec ?? 300}" /></div>
  </div>`;
}

function formS5(a) {
  const evals = a.s5_instruments?.evals || [];
  const rows = evals
    .map(
      (e, i) => `
    <div class="eval-row" data-i="${i}">
      <input data-k="name" value="${escAttr(e.name || "")}" placeholder="Name" />
      <input data-k="input" value="${escAttr(e.input || "")}" placeholder="Input" />
      <input data-k="expected" class="mono" value="${escAttr(e.expected || "")}" placeholder="contains:…" />
      <button type="button" class="btn btn-sm btn-ghost btn-rm-eval">✕</button>
    </div>`
    )
    .join("");
  return `
  <div class="switch-row"><div><span>Traces every run</span><small>Flight recorder</small></div>
    <label class="toggle"><input type="checkbox" id="f-traces" ${a.s5_instruments?.traces !== false ? "checked" : ""} /><i></i></label></div>
  <div class="switch-row" style="margin-top:8px"><div><span>Outcome grading</span><small>Grade done, not path</small></div>
    <label class="toggle"><input type="checkbox" id="f-outcome" ${a.s5_instruments?.outcomeGrading !== false ? "checked" : ""} /><i></i></label></div>
  <div class="card" style="margin-top:12px">
    <div class="card-head"><h3>Eval set</h3>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" id="btnAddEval" type="button">+ Eval</button>
        <button class="btn btn-sm btn-good" id="btnRunEvals" type="button">Run suite</button>
      </div>
    </div>
    <div class="field" style="margin:8px 0"><label>Eval model</label>
      <select id="evalModel" class="model-select" style="width:100%">${modelOptionsHtml(state.lastEvalModel || "simulator")}</select>
      <span class="hint">Evals expecting real outputs need a real model — the simulator only proves plumbing.</span>
    </div>
    <div id="evalList">${rows || '<div class="muted">Add real tasks with known-good outcomes.</div>'}</div>
    <div class="output" id="evalReport" style="margin-top:8px;display:none"></div>
  </div>`;
}

function formS6(a) {
  const mm = a.s6_power?.modelMap || {};
  const opt = (cur, v) => `<option value="${v}" ${cur === v ? "selected" : ""}>${v}</option>`;
  const sel = (id, cur) =>
    `<select id="${id}">${opt(cur, "large")}${opt(cur, "small")}</select>`;
  return `
  <div class="card"><h3>Run models</h3>
    <div class="field"><label>Default run model (large tier)</label>
      <select id="f-run-model" class="model-select" style="width:100%">${modelOptionsHtml(a.s6_power?.runModelRef || "simulator")}</select></div>
    <div class="field" style="margin-top:8px"><label>Small-tier model (classify · judge · summarize)</label>
      <select id="f-run-model-small" class="model-select" style="width:100%">${modelOptionsHtml(a.s6_power?.runModelRefSmall || "", { blankLabel: "Same as run model" })}</select>
      <span class="hint">Steps mapped to "small" below use this cheaper model in live runs.</span></div>
  </div>
  <div class="card"><h3>Model map</h3>
    <div class="form-row">
      <div class="field"><label>reason</label>${sel("f-m-reason", mm.reason || "large")}</div>
      <div class="field"><label>classify</label>${sel("f-m-classify", mm.classify || "small")}</div>
    </div>
    <div class="form-row" style="margin-top:8px">
      <div class="field"><label>extract</label>${sel("f-m-extract", mm.extract || "small")}</div>
      <div class="field"><label>summarize</label>${sel("f-m-summarize", mm.summarize || "small")}</div>
    </div>
    <div class="form-row" style="margin-top:8px">
      <div class="field"><label>judge</label>${sel("f-m-judge", mm.judge || "large")}</div>
      <div class="field"><label>format</label>${sel("f-m-format", mm.format || "small")}</div>
    </div>
  </div>
  <div class="form-row" style="margin-top:10px">
    <div class="field"><label>Token budget</label><input type="number" id="f-token-budget" value="${a.s6_power?.tokenBudget ?? 8000}" /></div>
    <div class="field"><label>Turn limit</label><input type="number" id="f-turn-limit" value="${a.s6_power?.turnLimit ?? 12}" /></div>
  </div>`;
}

function formS7(a) {
  return `
  <div class="form-grid">
    <div class="switch-row"><div><span>Checkpoints</span><small>Resume, never restart from zero</small></div>
      <label class="toggle"><input type="checkbox" id="f-checkpoints" ${a.s7_chassis?.checkpoints !== false ? "checked" : ""} /><i></i></label></div>
    <div class="switch-row"><div><span>Idempotent retries</span><small>Retry a failed model call before erroring</small></div>
      <label class="toggle"><input type="checkbox" id="f-idempotent" ${a.s7_chassis?.idempotentRetries !== false ? "checked" : ""} /><i></i></label></div>
    <div class="switch-row"><div><span>Version everything</span><small>Prompts · tools · models</small></div>
      <label class="toggle"><input type="checkbox" id="f-versioned" ${a.s7_chassis?.versionEverything !== false ? "checked" : ""} /><i></i></label></div>
    <div class="form-row">
      <div class="field"><label>Max retries</label><input type="number" id="f-max-retries" value="${a.s7_chassis?.maxRetries ?? 2}" /></div>
      <div class="field"><label>Timeouts (sec)</label><input type="number" id="f-timeouts" value="${a.s7_chassis?.timeoutsSec ?? 30}" /></div>
    </div>
  </div>`;
}

function formShip() {
  const items = (state.checklist || [])
    .map(
      (c) => `
    <div class="check-item ${c.ok ? "ok" : "bad"}">
      <div class="dot"></div>
      <div class="ly">${esc(c.layer)}</div>
      <div>${esc(c.label)}</div>
    </div>`
    )
    .join("");
  const ok = (state.checklist || []).filter((c) => c.ok).length;
  const total = (state.checklist || []).length;
  return `
  <div class="card">
    <h3>Blueprint score ${state.score}% · ${ok}/${total} checks</h3>
    <p class="muted" style="margin:0;font-size:12px">Ship when instruments pass and breakers are set.</p>
  </div>
  <div class="check-list">${items}</div>`;
}

function wireInspectorHandlers(layer) {
  if (layer === "s1") {
    $$("#patternList .pattern-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        collectForm();
        state.agent.s1_orchestration.pattern = btn.dataset.id;
        setDirty(true);
        renderCanvas();
        renderInspector();
      });
    });
    $("#btnAddStep")?.addEventListener("click", () => {
      collectForm();
      state.agent.s1_orchestration.chainSteps.push({
        id: "step_" + Date.now(),
        name: "Step",
        prompt: "",
      });
      renderInspector();
    });
    $$(".btn-rm-step").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".step-row");
        collectForm();
        state.agent.s1_orchestration.chainSteps.splice(Number(row.dataset.i), 1);
        renderInspector();
      });
    });
    $$("#chainSteps .step-row input").forEach((inp) => {
      inp.addEventListener("change", () => {
        const row = inp.closest(".step-row");
        const i = Number(row.dataset.i);
        state.agent.s1_orchestration.chainSteps[i][inp.dataset.k] = inp.value;
        setDirty(true);
      });
    });
    $("#btnAddRoute")?.addEventListener("click", () => {
      collectForm();
      if (!state.agent.s1_orchestration.routes) state.agent.s1_orchestration.routes = [];
      state.agent.s1_orchestration.routes.push({
        id: "r_" + Date.now(),
        name: "Lane",
        match: "",
        prompt: "",
      });
      renderInspector();
    });
    $$(".btn-rm-route").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".route-row");
        collectForm();
        state.agent.s1_orchestration.routes.splice(Number(row.dataset.i), 1);
        renderInspector();
      });
    });
    $$("#routeList .route-row input").forEach((inp) => {
      inp.addEventListener("change", () => {
        const i = Number(inp.closest(".route-row").dataset.i);
        state.agent.s1_orchestration.routes[i][inp.dataset.k] = inp.value;
        setDirty(true);
      });
    });
  }
  if (layer === "s3") {
    $$("input[data-tool]").forEach((inp) => {
      inp.addEventListener("change", () => {
        const set = new Set(state.agent.s3_tools.enabledToolIds || []);
        if (inp.checked) set.add(inp.dataset.tool);
        else set.delete(inp.dataset.tool);
        state.agent.s3_tools.enabledToolIds = [...set];
        setDirty(true);
        renderCanvas();
      });
    });
    $("#btnAddCustomTool")?.addEventListener("click", () => {
      const id = $("#f-custom-id").value.trim();
      const description = $("#f-custom-desc").value.trim();
      if (!id) return toast("Tool id required", "err");
      if (!state.agent.s3_tools.customTools) state.agent.s3_tools.customTools = [];
      state.agent.s3_tools.customTools.push({
        id,
        name: id,
        description,
        parameters: { type: "object", properties: {} },
        handler: "echo",
      });
      if (!state.agent.s3_tools.enabledToolIds.includes(id)) {
        state.agent.s3_tools.enabledToolIds.push(id);
      }
      renderInspector();
      renderCanvas();
      toast("Custom tool added");
    });
  }
  if (layer === "s5") {
    $("#btnAddEval")?.addEventListener("click", () => {
      collectForm();
      if (!state.agent.s5_instruments.evals) state.agent.s5_instruments.evals = [];
      state.agent.s5_instruments.evals.push({
        id: "ev_" + Date.now(),
        name: "Eval",
        input: "",
        expected: "contains:Result",
      });
      renderInspector();
    });
    $$(".btn-rm-eval").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".eval-row");
        collectForm();
        state.agent.s5_instruments.evals.splice(Number(row.dataset.i), 1);
        renderInspector();
      });
    });
    $$("#evalList .eval-row input").forEach((inp) => {
      inp.addEventListener("change", () => {
        const i = Number(inp.closest(".eval-row").dataset.i);
        state.agent.s5_instruments.evals[i][inp.dataset.k] = inp.value;
      });
    });
    $("#btnRunEvals")?.addEventListener("click", runEvals);
  }
}

// ── collect / save ─────────────────────────────────────────
function val(id) {
  return $(id)?.value;
}
function checked(id) {
  return !!$(id)?.checked;
}

function collectForm() {
  const a = state.agent;
  if (!a) return a;
  const layer = state.activeLayer;

  if (layer === "core" || $("#f-name")) {
    if ($("#f-name")) {
      a.name = val("#f-name").trim() || a.name;
      a.description = val("#f-description")?.trim() || "";
      a.core = {
        ...a.core,
        goal: val("#f-goal")?.trim() || "",
        systemPrompt: val("#f-system") || a.core.systemPrompt,
        exitCondition: val("#f-exit")?.trim() || "",
        ruleZero: true,
      };
    }
  }
  if ($("#f-escalation") || layer === "s1") {
    if ($("#f-escalation")) {
      a.s1_orchestration = {
        ...a.s1_orchestration,
        escalationRule: val("#f-escalation")?.trim() || "",
        judgeCriteria: $("#f-judge") ? val("#f-judge")?.trim() || "" : a.s1_orchestration.judgeCriteria,
        workerPrompt: $("#f-worker") ? val("#f-worker")?.trim() || "" : a.s1_orchestration.workerPrompt,
        nested: {
          router: checked("#f-nest-router"),
          workers: checked("#f-nest-workers"),
          judge: checked("#f-nest-judge"),
        },
      };
    }
  }
  if ($("#f-jit") || layer === "s2") {
    if ($("#f-jit")) {
      a.s2_context = {
        ...a.s2_context,
        systemPromptAltitude: val("#f-altitude") || "heuristics",
        jitContext: checked("#f-jit"),
        externalMemory: checked("#f-extmem"),
        compactionThreshold: Number(val("#f-compact")) || 0.75,
        compactionKeep: (val("#f-compact-keep") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
    }
  }
  if ($("#f-workspace")) {
    a.s3_tools = { ...a.s3_tools, workspaceDir: val("#f-workspace")?.trim() || "" };
  }
  if ($("#f-3am") || layer === "s4") {
    if ($("#f-3am")) {
      a.s4_guardrails = {
        ...a.s4_guardrails,
        worstCase3am: val("#f-3am")?.trim() || "",
        validateInput: checked("#f-val-in"),
        validateOutput: checked("#f-val-out"),
        breakers: {
          maxSpendUsd: Number(val("#f-max-spend")) || 1,
          maxLoops: Number(val("#f-max-loops")) || 12,
          maxTimeSec: Number(val("#f-max-time")) || 300,
        },
      };
    }
  }
  if ($("#f-traces") || layer === "s5") {
    if ($("#f-traces")) {
      a.s5_instruments = {
        ...a.s5_instruments,
        traces: checked("#f-traces"),
        outcomeGrading: checked("#f-outcome"),
      };
    }
  }
  if ($("#f-token-budget") || layer === "s6") {
    if ($("#f-token-budget")) {
      a.s6_power = {
        ...a.s6_power,
        modelMap: {
          reason: val("#f-m-reason") || "large",
          classify: val("#f-m-classify") || "small",
          extract: val("#f-m-extract") || "small",
          summarize: val("#f-m-summarize") || "small",
          judge: val("#f-m-judge") || "large",
          format: val("#f-m-format") || "small",
        },
        runModelRef: val("#f-run-model") || "simulator",
        runModelRefSmall: val("#f-run-model-small") || "",
        tokenBudget: Number(val("#f-token-budget")) || 8000,
        turnLimit: Number(val("#f-turn-limit")) || 12,
      };
    }
  }
  if ($("#f-checkpoints") || layer === "s7") {
    if ($("#f-checkpoints")) {
      a.s7_chassis = {
        ...a.s7_chassis,
        checkpoints: checked("#f-checkpoints"),
        idempotentRetries: checked("#f-idempotent"),
        versionEverything: checked("#f-versioned"),
        maxRetries: Number(val("#f-max-retries")) || 2,
        timeoutsSec: Number(val("#f-timeouts")) || 30,
      };
    }
  }
  return a;
}

async function saveAgent() {
  if (!state.agent) return;
  collectForm();
  const data = await api(`/api/agents/${state.agent.id}`, {
    method: "PUT",
    body: JSON.stringify(state.agent),
  });
  state.agent = data.agent;
  state.score = data.score;
  state.checklist = data.checklist;
  setDirty(false);
  updateStageChrome();
  renderCanvas();
  if (state.activeLayer === "ship") renderInspector();
  else {
    // refresh version field if on core
    if ($("#f-version")) $("#f-version").value = state.agent.version;
  }
  await loadFleet();
  toast("System saved · v" + state.agent.version);
  return data;
}

// ── run / operator ─────────────────────────────────────────
function showOp(id) {
  $$(".op-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.op === id));
  $$(".op-body").forEach((b) => b.classList.toggle("active", b.id === `op-${id}`));
}

function updateBreakerCaps() {
  const b = state.agent?.s4_guardrails?.breakers || {};
  const maxSpend = b.maxSpendUsd ?? 1;
  const maxLoops = b.maxLoops ?? 12;
  const run = state.lastRun;
  const spend = run?.costUsd || 0;
  const loops = run?.turn || 0;
  $("#bSpendV").textContent = `$${spend.toFixed(3)} / $${maxSpend}`;
  $("#bLoopsV").textContent = `${loops} / ${maxLoops}`;
  $("#bStatusV").textContent = run?.status || "idle";
  const sp = Math.min(100, (spend / maxSpend) * 100);
  const lp = Math.min(100, (loops / maxLoops) * 100);
  $("#bSpendBar").style.width = sp + "%";
  $("#bLoopsBar").style.width = lp + "%";
  $("#bSpend").classList.toggle("hot", sp > 85);
  $("#bLoops").classList.toggle("hot", lp > 85);
}

function resetRunPanel() {
  $("#runOutput").textContent = "Run the system to see the loop.";
  $("#runModelUsed").textContent = "";
  $("#mTurns").textContent = "—";
  $("#mTokens").textContent = "—";
  $("#mCost").textContent = "—";
  $("#mStop").textContent = "—";
  $("#traceList").innerHTML = `<div class="muted">Flight recorder appears after a run (S5).</div>`;
  state.lastRun = null;
  updateBreakerCaps();
}

/** One readable line per trace event, raw JSON behind a click. */
function traceEventHtml(ev) {
  const kind =
    ev.type === "tool_result"
      ? "tool"
      : ev.type === "guardrail"
        ? "guardrail"
        : ev.type === "model_call"
          ? "model"
          : ev.type === "model_error"
            ? "error"
            : "";
  let summary = ev.type;
  if (ev.type === "run_start") {
    summary = `▶ start · ${ev.pattern || ""} · ${ev.modelRef || "simulator"}`;
  } else if (ev.type === "model_call") {
    const head = ev.thought || ev.content || "";
    summary = `turn ${ev.turn} · ${ev.stepType || "reason"} · ${String(head).slice(0, 100)}`;
  } else if (ev.type === "tool_result") {
    const ok = ev.result?.error ? `✗ ${ev.result.error}` : "✓ ok";
    summary = `tool ${ev.name} → ${ok}`;
  } else if (ev.type === "guardrail") {
    summary = `guardrail · ${ev.action}${ev.reason ? ` — ${ev.reason}` : ""}`;
  } else if (ev.type === "compaction") {
    summary = `compaction · dropped ${ev.droppedMessages} messages at ${ev.tokensUsed} tokens`;
  } else if (ev.type === "model_error") {
    summary = `✗ model failed · ${ev.modelRef || ""} · ${ev.error || ""}`;
  } else if (ev.type === "judge") {
    summary = `judge · ${ev.pass ? "PASS" : "FAIL"}${ev.feedback ? ` — ${ev.feedback}` : ""}`;
  } else if (ev.type === "nudge") {
    summary = `⚠ nudge · ${ev.reason || "artifact missing"}`;
  } else if (ev.type === "retry") {
    summary = `retry ${ev.attempt}/${ev.maxRetries} · ${ev.error || ""}`;
  } else if (ev.type === "resume") {
    summary = `resumed from checkpoint · turn ${ev.fromTurn}`;
  }
  const body = { ...ev };
  delete body.at;
  return `<div class="tev ${kind}">
    <details>
      <summary><span class="etype">${esc(ev.type)}</span> ${esc(summary)}</summary>
      <pre>${esc(JSON.stringify(body, null, 2))}</pre>
    </details>
  </div>`;
}

function appendTraceEvent(ev) {
  const tl = $("#traceList");
  if (tl.dataset.live !== "1") {
    tl.innerHTML = "";
    tl.dataset.live = "1";
  }
  tl.insertAdjacentHTML("beforeend", traceEventHtml(ev));
  tl.scrollTop = tl.scrollHeight;
  // live metric updates while the run streams
  if (ev.type === "model_call") {
    $("#mTurns").textContent = ev.turn;
    const t = Number($("#mTokens").textContent) || 0;
    $("#mTokens").textContent = t + (ev.tokens || 0);
    $("#bLoopsV").textContent = `${ev.turn} / ${state.agent?.s4_guardrails?.breakers?.maxLoops ?? 12}`;
  }
}

async function runSystem(opts = {}) {
  if (!state.agent) return;
  if (state.dirty) await saveAgent();
  const message = opts.message ?? $("#runMessage").value.trim();
  if (!message && !opts.resumeRunId) return toast("Enter a user message", "err");
  const modelRef = $("#runModel")?.value || "simulator";

  $("#btnRun").disabled = true;
  $("#btnRun").textContent = "Running…";
  $("#mTokens").textContent = "0";
  $("#runOutput").textContent = "Streaming…";
  $("#runModelUsed").textContent = `· ${modelRef}`;
  const tl = $("#traceList");
  tl.dataset.live = "0";
  showOp("trace");

  try {
    const res = await fetch(`/api/agents/${state.agent.id}/run-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, resumeRunId: opts.resumeRunId, modelRef }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === "event") appendTraceEvent(msg.event);
        else if (msg.type === "done") {
          state.lastRun = msg.run;
          renderRun(msg.run);
          if (msg.run.status === "error") toast(msg.run.output || "Model failed", "err");
        } else if (msg.type === "error") {
          throw new Error(msg.error);
        }
      }
    }
    loadRuns();
    loadMemory();
  } catch (err) {
    toast(err.message, "err");
  } finally {
    $("#btnRun").disabled = false;
    $("#btnRun").textContent = "▶ Run system";
  }
}

function renderRun(run) {
  $("#mTurns").textContent = run.turn;
  $("#mTokens").textContent = run.tokensUsed;
  $("#mCost").textContent = `$${(run.costUsd || 0).toFixed(4)}`;
  $("#mStop").textContent = run.stopReason || run.status;
  $("#runOutput").textContent = run.output || "(empty)";
  $("#runModelUsed").textContent = `· ${run.modelRef || "simulator"}`;
  updateBreakerCaps();
  showOp("run");

  const tl = $("#traceList");
  tl.dataset.live = "0";
  if (!run.trace?.length) {
    tl.innerHTML = `<div class="muted">No trace events.</div>`;
    return;
  }
  tl.innerHTML = run.trace.map(traceEventHtml).join("");
}

async function loadRuns() {
  if (!state.agent) return;
  const runs = await api(`/api/agents/${state.agent.id}/runs`);
  const el = $("#runsList");
  if (!runs.length) {
    el.innerHTML = `<div class="muted">No runs yet.</div>`;
    return;
  }
  el.innerHTML = runs
    .slice(0, 25)
    .map(
      (r) => `
    <div class="run-item" data-id="${r.id}">
      <div class="rs ${escAttr(r.status)}">${esc(r.status)}${r.isEval ? ' <span class="badge good">eval</span>' : ""}</div>
      <div>${esc((r.input || "").slice(0, 90))}</div>
      <div class="muted" style="font-size:10px;font-family:var(--mono)">${esc(r.modelRef || "simulator")} · $${(r.costUsd || 0).toFixed(4)}</div>
    </div>`
    )
    .join("");
  $$(".run-item", el).forEach((item) => {
    item.addEventListener("click", async () => {
      const run = await api(`/api/runs/${item.dataset.id}`);
      state.lastRun = run;
      renderRun(run);
      showOp("run");
    });
  });
}

async function loadMemory() {
  if (!state.agent) return;
  try {
    const mem = await api(`/api/agents/${state.agent.id}/memory`);
    const el = $("#memoryList");
    if (!mem.notes?.length) {
      el.innerHTML = `<div class="muted">No notes. Add one below, or enable memory_write and run.</div>`;
      return;
    }
    el.innerHTML = mem.notes
      .map(
        (n) => `
      <div class="mem-note">
        <strong>${esc(n.key)}</strong> <span class="muted">${esc((n.tags || []).join(", "))}</span>
        <button type="button" class="btn btn-sm btn-ghost mem-rm" data-key="${escAttr(n.key)}" title="Delete note">✕</button>
        <br/>${esc(n.value)}
      </div>`
      )
      .join("");
    $$(".mem-rm", el).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const notes = mem.notes.filter((n) => n.key !== btn.dataset.key);
        await api(`/api/agents/${state.agent.id}/memory`, {
          method: "PUT",
          body: JSON.stringify({ notes }),
        });
        loadMemory();
      });
    });
  } catch {
    /* ignore */
  }
}

async function addMemoryNote() {
  if (!state.agent) return;
  const key = $("#memKey").value.trim();
  const value = $("#memValue").value.trim();
  if (!key || !value) return toast("Key and value required", "err");
  const tags = ($("#memTags").value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const mem = await api(`/api/agents/${state.agent.id}/memory`);
  const notes = (mem.notes || []).filter((n) => n.key !== key);
  notes.push({ key, value, tags, updatedAt: new Date().toISOString() });
  await api(`/api/agents/${state.agent.id}/memory`, {
    method: "PUT",
    body: JSON.stringify({ notes }),
  });
  $("#memKey").value = "";
  $("#memValue").value = "";
  $("#memTags").value = "";
  loadMemory();
  toast("Note saved");
}

async function clearMemory() {
  if (!state.agent) return;
  if (!confirm("Delete all memory notes for this system?")) return;
  await api(`/api/agents/${state.agent.id}/memory`, { method: "DELETE" });
  loadMemory();
  toast("Memory cleared");
}

async function runEvals() {
  if (state.dirty) await saveAgent();
  const btn = $("#btnRunEvals");
  const modelRef = $("#evalModel")?.value || "simulator";
  state.lastEvalModel = modelRef;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Running…";
  }
  try {
    const report = await api(`/api/agents/${state.agent.id}/evals`, {
      method: "POST",
      body: JSON.stringify({ modelRef }),
    });
    const box = $("#evalReport");
    if (box) {
      box.style.display = "block";
      box.textContent =
        `${report.passed}/${report.total} passed · model: ${report.modelRef}\n\n` +
        report.results
          .map(
            (r) =>
              `${r.passed ? "✓" : "✗"} ${r.name}\n  in: ${r.input}\n  out: ${(r.output || "").slice(0, 140)}`
          )
          .join("\n\n");
    }
    toast(`${report.passed}/${report.total} evals passed · ${report.modelRef}`);
  } catch (err) {
    toast(err.message, "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Run suite";
    }
  }
}

// ── Pi models + model-guided sketch ────────────────────────
const SKETCH_MODEL_KEY = "agentStudio.sketchModelRef";

async function loadPiModels() {
  const data = await api("/api/models");
  state.piModels = data.models || [];
  state.piModelsMeta = data;
  const sel = $("#sketchModel");
  if (!sel) return data;

  const ready = state.piModels.filter((m) => m.ready);
  const notReady = state.piModels.filter((m) => !m.ready);

  const opt = (m, disabled) => {
    const label = `${m.providerName} · ${m.modelName}`;
    const note = disabled
      ? " (no credentials)"
      : m.reasoning
        ? " · reasoning"
        : "";
    return `<option value="${escAttr(m.ref)}" ${disabled ? "disabled" : ""}>${esc(label)}${esc(note)}</option>`;
  };

  let html = "";
  if (ready.length) {
    html += `<optgroup label="Ready (${ready.length})">${ready.map((m) => opt(m, false)).join("")}</optgroup>`;
  }
  if (notReady.length) {
    html += `<optgroup label="Configured but missing auth (${notReady.length})">${notReady.map((m) => opt(m, true)).join("")}</optgroup>`;
  }
  if (!html) {
    html = `<option value="">No models in ~/.pi/agent/models.json</option>`;
  }
  sel.innerHTML = html;

  const saved = localStorage.getItem(SKETCH_MODEL_KEY);
  if (saved && ready.some((m) => m.ref === saved)) {
    sel.value = saved;
  } else if (ready[0]) {
    sel.value = ready[0].ref;
  }

  const hint = $("#modelHint");
  if (hint) {
    hint.textContent = ready.length
      ? `${ready.length} ready from ${data.modelsPath} · credentials via auth.json`
      : `No ready models. Log into providers in Pi first. (${data.modelsPath})`;
  }

  const pill = $("#modePill");
  if (pill) {
    if (ready.length) {
      pill.textContent = `Pi · ${ready.length} models`;
      pill.className = "pill live";
    } else {
      pill.textContent = "Pi · no auth";
      pill.className = "pill sim";
    }
  }

  sel.addEventListener("change", () => {
    if (sel.value) localStorage.setItem(SKETCH_MODEL_KEY, sel.value);
  });

  populateRunModels();
  return data;
}

const RUN_MODEL_KEY = "agentStudio.runModelRef";

/** Fill the operator-rail run-model picker: simulator + ready Pi models. */
function populateRunModels() {
  const sel = $("#runModel");
  if (!sel) return;
  const ready = state.piModels.filter((m) => m.ready);
  sel.innerHTML =
    `<option value="simulator">Simulator (no cost)</option>` +
    ready
      .map((m) => `<option value="${escAttr(m.ref)}">${esc(m.providerName)} · ${esc(m.modelName)}</option>`)
      .join("");
  const saved = localStorage.getItem(RUN_MODEL_KEY);
  if (saved && (saved === "simulator" || ready.some((m) => m.ref === saved))) {
    sel.value = saved;
  }
  sel.addEventListener("change", () => {
    localStorage.setItem(RUN_MODEL_KEY, sel.value);
  });
}

/** Prefer the agent's own run model when it's ready; else keep the current pick. */
function syncRunModelToAgent() {
  const sel = $("#runModel");
  if (!sel || !state.agent) return;
  const ref = state.agent.s6_power?.runModelRef;
  if (ref && state.piModels.some((m) => m.ref === ref && m.ready)) {
    sel.value = ref;
  }
}

function selectedSketchModel() {
  return $("#sketchModel")?.value || "";
}

function showSketchInModal(sketch) {
  state.sketch = sketch;
  $("#sketchName").value = sketch.name || "";
  $("#sketchGoal").value = sketch.core?.goal || "";
  $("#sketchModelLabel").textContent = sketch.modelRef || selectedSketchModel() || "—";
  $("#sketchIntro").textContent =
    sketch.reason || "Designed by your selected Pi model. Review, then create.";

  const fre = freedomFor(sketch.s1_orchestration?.pattern);
  const toolsList = (sketch.s3_tools?.enabledToolIds || []).join(", ") || "memory only";
  const caps = (sketch.inferredCapabilities || []).length
    ? sketch.inferredCapabilities.join(", ")
    : "(model listed none)";

  $("#sketchGrid").innerHTML = `
    <div class="sketch-row"><div class="ly">Model</div><div class="mono">${esc(sketch.modelRef || "")}</div></div>
    <div class="sketch-row"><div class="ly">Caps</div><div><strong>${esc(caps)}</strong></div></div>
    <div class="sketch-row"><div class="ly">S1</div><div><strong>${esc(sketch.s1_orchestration?.pattern || "")}</strong> · freedom ${fre}/5<br/><span class="muted">${esc(sketch.reason || "")}</span></div></div>
    <div class="sketch-row"><div class="ly">S3</div><div>Tools: <span class="mono">${esc(toolsList)}</span></div></div>
    <div class="sketch-row"><div class="ly">S4</div><div>Breakers: $${sketch.s4_guardrails?.breakers?.maxSpendUsd ?? "—"} · ${sketch.s4_guardrails?.breakers?.maxLoops ?? "—"} loops · ${sketch.s4_guardrails?.breakers?.maxTimeSec ?? "—"}s<br/><span class="muted">${esc(sketch.s4_guardrails?.worstCase3am || "")}</span></div></div>
    <div class="sketch-row"><div class="ly">S5</div><div>${(sketch.s5_instruments?.evals || []).length} eval(s) · traces ${sketch.s5_instruments?.traces ? "on" : "off"}</div></div>
    <div class="sketch-row"><div class="ly">S6</div><div>Token budget ${sketch.s6_power?.tokenBudget ?? "—"} · ${sketch.s6_power?.turnLimit ?? "—"} turns</div></div>
    <div class="sketch-row"><div class="ly">S7</div><div>Checkpoints · versioned · idempotent retries</div></div>
    ${sketchQualityRows(sketch)}`;
  $("#sketchModal").classList.add("open");
}

function sketchQualityRows(sketch) {
  const meta = sketch._sketch || {};
  const rows = [];

  const reqs = meta.requirements || [];
  if (reqs.length) {
    const coverage = meta.critique?.requirementCoverage || [];
    const items = reqs
      .map((r, i) => {
        const cov = coverage.find((c) => c.requirement === r) || coverage[i];
        const ok = cov ? cov.covered !== false : true;
        return `<div>${ok ? "✓" : "✗"} ${esc(r)}</div>`;
      })
      .join("");
    rows.push(
      `<div class="sketch-row"><div class="ly">Reqs</div><div>${items}</div></div>`
    );
  }

  if ((meta.ambiguities || []).length) {
    rows.push(
      `<div class="sketch-row"><div class="ly">Ambig</div><div class="muted">${meta.ambiguities
        .map((a) => esc(a))
        .join("<br/>")}</div></div>`
    );
  }

  const issues = [
    ...(meta.critique?.issues || []).map((i) => `[${i.severity}] ${i.message}`),
    ...(meta.lint || []).map((f) => `[lint:${f.severity}] ${f.message}`),
  ];
  if (issues.length) {
    rows.push(
      `<div class="sketch-row"><div class="ly">Issues</div><div class="muted">${issues
        .map((i) => esc(i))
        .join("<br/>")}</div></div>`
    );
  }

  const notes = [];
  if ((meta.autoAddedTools || []).length)
    notes.push(`Auto-added tools the steps need: ${meta.autoAddedTools.join(", ")}`);
  if (meta.repairRounds) notes.push(`Design repaired ${meta.repairRounds}× in review`);
  if (notes.length) {
    rows.push(
      `<div class="sketch-row"><div class="ly">Review</div><div class="muted">${notes
        .map((n) => esc(n))
        .join("<br/>")}</div></div>`
    );
  }

  return rows.join("");
}

async function auditSketch() {
  const sketch = state.sketch;
  if (!sketch) return;
  const modelRef = sketch.modelRef || selectedSketchModel();
  if (!modelRef) {
    toast("Select a ready model first", "err");
    return;
  }
  const btn = $("#sketchAudit");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Auditing…";
  // placeholder row so the user sees the audit is running
  let row = $("#sketchAuditRow");
  if (!row) {
    row = document.createElement("div");
    row.className = "sketch-row";
    row.id = "sketchAuditRow";
    $("#sketchGrid").appendChild(row);
  }
  row.innerHTML = `<div class="ly">Audit</div><div class="muted">Unified Compliance Auditor running on ${esc(modelRef)}…</div>`;
  try {
    const result = await api("/api/sketch/audit", {
      method: "POST",
      body: JSON.stringify({ sketch, modelRef }),
    });
    row.innerHTML = `<div class="ly">Audit</div><div><span class="muted">status: ${esc(result.status || "?")}</span><pre style="white-space:pre-wrap;max-height:220px;overflow:auto;margin:6px 0 0;font-size:11px">${esc(result.output || "(no output)")}</pre></div>`;
    toast("Sketch audited — read the verdict before creating");
  } catch (err) {
    row.innerHTML = `<div class="ly">Audit</div><div class="muted">Audit failed: ${esc(err.message)}</div>`;
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = prev || "Audit sketch";
  }
}

async function sketchWithSelectedModel() {
  const intent = $("#intentInput").value.trim();
  const modelRef = selectedSketchModel();
  if (!intent) {
    toast("Describe what the system should do", "err");
    return;
  }
  if (!modelRef) {
    toast("Select a ready model from your Pi instance", "err");
    return;
  }

  const btn = $("#btnSketch");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Model designing…";
  try {
    const result = await api("/api/sketch", {
      method: "POST",
      body: JSON.stringify({ intent, modelRef }),
    });
    showSketchInModal(result.sketch);
    toast("Sketch ready · " + modelRef);
  } catch (err) {
    toast(err.message, "err");
  } finally {
    btn.disabled = false;
    btn.textContent = prev || "Sketch with model →";
  }
}

async function createFromSketch() {
  const sketch = state.sketch;
  if (!sketch) return;
  sketch.name = $("#sketchName").value.trim() || sketch.name;
  if (sketch.core) sketch.core.goal = $("#sketchGoal").value.trim() || sketch.core.goal;
  sketch.description = sketch.intent || sketch.description;
  const data = await api("/api/agents", {
    method: "POST",
    body: JSON.stringify(sketch),
  });
  $("#sketchModal").classList.remove("open");
  state.sketch = null;
  await loadFleet();
  await openAgent(data.agent.id);
  toast("System created by " + (sketch.modelRef || "model"));
}

// ── boot ───────────────────────────────────────────────────
async function boot() {
  try {
    await api("/api/health");
  } catch {
    $("#modePill").textContent = "Offline";
  }

  state.patterns = await api("/api/meta/patterns");
  state.tools = await api("/api/meta/tools");

  try {
    await loadPiModels();
  } catch (err) {
    $("#sketchModel").innerHTML = `<option value="">Failed to load Pi models</option>`;
    $("#modelHint").textContent = err.message;
    toast("Could not load ~/.pi models: " + err.message, "err");
  }

  await loadFleet();

  $("#btnSketch").addEventListener("click", () => sketchWithSelectedModel());
  $("#btnWelcomeSketch").addEventListener("click", () => {
    $("#intentInput").focus();
    toast("Pick a Pi model, type intent, then Sketch with model");
  });
  $("#sketchCancel").addEventListener("click", () => $("#sketchModal").classList.remove("open"));
  $("#sketchAudit")?.addEventListener("click", () => auditSketch());
  $("#sketchCreate").addEventListener("click", () =>
    createFromSketch().catch((e) => toast(e.message, "err"))
  );
  $("#sketchRetry")?.addEventListener("click", () => {
    $("#sketchModal").classList.remove("open");
    sketchWithSelectedModel();
  });

  $("#btnSave").addEventListener("click", () => saveAgent().catch((e) => toast(e.message, "err")));
  $("#btnRun").addEventListener("click", () => runSystem());
  $("#btnRefreshMem").addEventListener("click", loadMemory);
  $("#btnAddNote").addEventListener("click", () => addMemoryNote().catch((e) => toast(e.message, "err")));
  $("#btnClearMem").addEventListener("click", () => clearMemory().catch((e) => toast(e.message, "err")));
  $("#btnExport").addEventListener("click", () => {
    if (state.agent) window.open(`/api/agents/${state.agent.id}/export`, "_blank");
  });
  $("#btnDelete").addEventListener("click", async () => {
    if (!state.agent) return;
    if (!confirm(`Delete "${state.agent.name}"?`)) return;
    await api(`/api/agents/${state.agent.id}`, { method: "DELETE" });
    state.agent = null;
    $("#systemView").classList.add("hidden");
    $("#welcome").classList.remove("hidden");
    $("#stageName").textContent = "No system selected";
    $("#stageMeta").textContent = "Describe intent on the left, or open a system from the fleet.";
    $("#scoreChip").textContent = "—";
    $("#scoreChip").className = "score-chip";
    $("#btnSave").disabled = true;
    $("#btnExport").disabled = true;
    $("#btnDelete").disabled = true;
    $("#btnRun").disabled = true;
    resetRunPanel();
    await loadFleet();
    toast("Deleted");
  });

  $("#btnImport").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      const data = await api("/api/agents/import", {
        method: "POST",
        body: JSON.stringify(json),
      });
      await loadFleet();
      await openAgent(data.agent.id);
      toast("Imported");
    } catch (err) {
      toast(err.message, "err");
    }
    e.target.value = "";
  });

  $$(".op-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => showOp(btn.dataset.op));
  });

  $("#intentInput").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      $("#btnSketch").click();
    }
  });

  // Score chip → Ship checklist
  $("#scoreChip").addEventListener("click", () => {
    if (!state.agent) return;
    collectForm();
    state.activeLayer = "ship";
    renderCanvas();
    renderInspector();
  });

  // Dirty tracking + Cmd+S save
  $("#inspector").addEventListener("change", () => setDirty(true));
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (state.agent) saveAgent().catch((err) => toast(err.message, "err"));
    }
  });
}

boot().catch((err) => {
  console.error(err);
  toast("Failed to boot: " + err.message, "err");
});
