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

/** S4 line must mirror enabled irreversible tools — never keep orphan send_email gates. */
function syncIrrevLineFromTools(agent) {
  if (!agent?.s4_guardrails || !agent?.s3_tools) return;
  const enabled = new Set(agent.s3_tools.enabledToolIds || []);
  const next = [...IRREVERSIBLE_TOOL_IDS].filter((id) => enabled.has(id));
  agent.s4_guardrails.irreversibilityLine = next;
  agent.s4_guardrails.humanGate = next.length > 0;
  if (!next.length) {
    agent.s4_guardrails.worstCase3am =
      agent.s4_guardrails.worstCase3am?.includes("email") ||
      agent.s4_guardrails.worstCase3am?.includes("refund")
        ? "No irreversible tools enabled; worst case is wasted spend/loops (breakers)."
        : agent.s4_guardrails.worstCase3am;
  }
}

// ── intent → system sketch ─────────────────────────────────
/** Capabilities only added when intent clearly asks for them — never invent side-effects. */
const INTENT_CAPABILITIES = [
  {
    id: "refund",
    tools: ["refund_payment"],
    // billing/charge alone is not enough — must mention refund/money-back style action
    test: (s) =>
      /\brefunds?\b|\bchargebacks?\b|\bmoney back\b|\breimburse/.test(s),
  },
  {
    id: "email",
    tools: ["send_email"],
    // do NOT match bare "send" (too broad: send report, send to worker, etc.)
    test: (s) =>
      /\be-?mails?\b|\bsend (an |the )?e-?mail\b|\bemail (them|the customer|customers|users?)\b|\bnotify (them|the customer|customers)\b/.test(
        s
      ),
  },
  {
    id: "http",
    tools: ["http_request"],
    test: (s) =>
      /\bapi\b|\bhttp\b|\bwebhook\b|\bendpoint\b|\bintegrat/.test(s),
  },
  {
    id: "files_write",
    tools: ["write_file"],
    test: (s) =>
      /\bwrite (a |the )?file\b|\bsave (to|a) file\b|\bcreate (a )?file\b|\boutput (a )?file\b/.test(
        s
      ),
  },
  {
    id: "files_read",
    tools: ["read_file"],
    test: (s) =>
      /\bread (a |the )?file\b|\bopen (a |the )?file\b|\bfrom (the )?filesystem\b|\bworkspace\b/.test(
        s
      ),
  },
  {
    id: "search",
    tools: ["web_search"],
    test: (s) =>
      /\bsearch\b|\blook up\b|\blookup\b|\bresearch\b|\bweb\b|\binternet\b|\bnews\b|\bcite\b|\bcompetitor\b|\bcurrent\b/.test(
        s
      ),
  },
];

const IRREVERSIBLE_TOOL_IDS = new Set(["send_email", "refund_payment"]);

function detectCapabilities(lower) {
  return INTENT_CAPABILITIES.filter((c) => c.test(lower));
}

function toolsFromCapabilities(caps) {
  // Infrastructure only: memory pump (S2). No side-effect tools unless intent asks.
  const tools = new Set(["memory_write", "memory_read"]);
  for (const c of caps) for (const t of c.tools) tools.add(t);
  return [...tools];
}

function irrevLineFromTools(toolIds) {
  return toolIds.filter((id) => IRREVERSIBLE_TOOL_IDS.has(id));
}

function sketchFromIntent(text) {
  const t = (text || "").trim();
  const lower = t.toLowerCase();

  const caps = detectCapabilities(lower);
  const capIds = new Set(caps.map((c) => c.id));
  const wantsRefund = capIds.has("refund");
  const wantsEmail = capIds.has("email");
  const wantsSearch = capIds.has("search");
  const wantsResearch =
    wantsSearch || /\bbrief\b|\bsummar|\binvestigate\b|\bexplore\b/.test(lower);

  const wantsRoute =
    wantsRefund ||
    /\btriage\b|\bclassif|\broute\b|\bvs\b|\bticket\b|\bsupport\b/.test(lower);
  const multiStep = /\band\b|,|;|\bthen\b|\bmulti/.test(lower) || t.length > 80;
  const openEnded =
    wantsResearch || /\binvestigate\b|\bexplore\b|\bfigure out\b/.test(lower);

  let pattern = "prompt_chaining";
  let reason = "Known steps → start with prompt chaining (rule zero).";
  if (openEnded) {
    pattern = "orchestrator_workers";
    reason = "Open-ended work → orchestrator + workers.";
  } else if (wantsRoute) {
    pattern = "routing";
    reason = "Distinct categories → routing lanes.";
  } else if (multiStep) {
    pattern = "prompt_chaining";
    reason = "Decomposable steps → chain.";
  }

  const tools = toolsFromCapabilities(caps);
  // Search only if intent asked — never auto-add web_search as a default.
  // Open-ended without search language still gets no web_search (user can enable later).

  const irrev = irrevLineFromTools(tools);
  const inferred = caps.map((c) => c.id);
  const sideEffectNote =
    irrev.length > 0
      ? `Gates only for tools you asked for: ${irrev.join(", ")}.`
      : "No irreversible tools inferred — no invented gates (e.g. no send_email).";

  const name = deriveName(t);
  const goal = t || "Complete the user goal carefully and stop when done.";

  const worst = wantsRefund
    ? "Issues a refund without human approval."
    : wantsEmail
      ? "Sends email without human approval."
      : irrev.length
        ? `Ungated use of: ${irrev.join(", ")}.`
        : "None of the enabled tools are irreversible; worst case is wasted spend/loops (breakers cover that).";

  const evals = [];
  if (wantsRefund) {
    evals.push({
      id: "ev_refund",
      name: "Refund hits human gate",
      input: "Please refund order 88231, charged twice.",
      expected: "contains:human gate",
    });
    evals.push({
      id: "ev_bug",
      name: "Non-refund completes",
      input: "App crashes when I click export. Help me triage.",
      expected: "contains:complete",
    });
  } else if (wantsResearch) {
    evals.push({
      id: "ev_brief",
      name: "Produces a result brief",
      input: t.slice(0, 160) || "Write a short brief on the topic.",
      expected: "contains:Result",
    });
  } else {
    evals.push({
      id: "ev1",
      name: "Happy path completes",
      input: t.slice(0, 160) || "Help me complete the goal.",
      expected: "contains:complete",
    });
  }

  // Routes: only add refund lane if refund was asked; otherwise generic support lanes without payment tools
  let routes;
  if (wantsRoute) {
    routes = [];
    if (wantsRefund) {
      routes.push({
        id: "r_refund",
        name: "Refunds",
        match: "refund|chargeback|reimburse|money back",
        prompt: "Handle billing carefully; never refund without gate.",
      });
    }
    routes.push({
      id: "r_tech",
      name: "Technical",
      match: "bug|error|crash|export",
      prompt: "Collect repro steps; draft triage notes (do not email unless that tool is enabled).",
    });
    routes.push({ id: "r_default", name: "Default", match: "default", prompt: "General assist." });
  }

  return {
    name,
    description: t.slice(0, 160),
    intent: t,
    reason: `${reason} ${sideEffectNote}`,
    inferredCapabilities: inferred,
    isAgent: openEnded || wantsRoute || multiStep,
    core: {
      goal,
      systemPrompt: buildSystemPrompt({
        wantsRefund,
        wantsEmail,
        wantsResearch,
        pattern,
        tools,
      }),
      exitCondition:
        "Goal complete with a clear outcome, or human takeover, or budget/loop breaker.",
    },
    s1_orchestration: {
      pattern,
      nested: {
        router: pattern === "routing" || openEnded,
        workers: pattern === "orchestrator_workers",
        judge: openEnded || pattern === "evaluator_optimizer",
      },
      escalationRule: openEnded
        ? "Always agentic for open research / multi-system work."
        : "Escalate only when request is open-ended or needs multi-step tools.",
      judgeCriteria:
        "Pass if goal met, claims supported, no ungated irreversible actions.",
      routes,
    },
    s2_context: {
      jitContext: true,
      externalMemory: true,
      systemPromptAltitude: "heuristics",
      compactionThreshold: 0.75,
    },
    s3_tools: { enabledToolIds: tools },
    s4_guardrails: {
      worstCase3am: worst,
      // Only gate tools that are actually enabled — never invent send_email etc.
      irreversibilityLine: irrev,
      // Human gate only needed when something irreversible is enabled
      humanGate: irrev.length > 0,
      validateInput: true,
      validateOutput: true,
      breakers: {
        maxSpendUsd: openEnded ? 1.5 : 0.75,
        maxLoops: openEnded ? 12 : 8,
        maxTimeSec: 180,
      },
    },
    s5_instruments: { traces: true, evals, outcomeGrading: true },
    s6_power: {
      modelMap: {
        reason: "large",
        classify: "small",
        extract: "small",
        format: "small",
        summarize: "small",
        judge: "large",
      },
      promptCaching: true,
      parallelWhereIndependent: true,
      tokenBudget: openEnded ? 8000 : 5000,
      turnLimit: openEnded ? 12 : 8,
    },
    s7_chassis: {
      checkpoints: true,
      idempotentRetries: true,
      degradedModes: true,
      versionEverything: true,
    },
  };
}

function deriveName(t) {
  if (!t) return "New System";
  if (/\bsupport\b|\btriage\b|\bticket\b/i.test(t)) return "Support Triage System";
  if (/\bresearch\b|\bbrief\b/i.test(t)) return "Research System";
  if (/\brefund\b/i.test(t)) return "Refund Desk System";
  const words = t.split(/\s+/).slice(0, 5).join(" ");
  return words.length > 40 ? words.slice(0, 40) + "…" : words;
}

function buildSystemPrompt({ wantsRefund, wantsEmail, wantsResearch, pattern, tools }) {
  const lines = [
    "You are a careful agent system. Prefer the simplest path that works.",
    "Use only the tools you have been given. Do not invent capabilities (email, refund, HTTP) that are not enabled.",
    "Write important decisions to memory. Stop when the exit condition is met.",
  ];
  const enabled = tools || [];
  if (enabled.length) {
    lines.push(`Enabled tools: ${enabled.join(", ")}.`);
  }
  const gated = irrevLineFromTools(enabled);
  if (gated.length) {
    lines.push(
      `Irreversible tools require human approval before firing: ${gated.join(", ")}.`
    );
  }
  if (wantsResearch) {
    lines.push("Prefer JIT retrieval. Do not invent citations. Summarize sources.");
  }
  // avoid mentioning email/refund in the prompt if those tools are not enabled
  if (!wantsEmail && !enabled.includes("send_email")) {
    /* no email instructions */
  }
  if (!wantsRefund && !enabled.includes("refund_payment")) {
    /* no refund instructions */
  }
  lines.push(`Orchestration pattern: ${pattern}.`);
  return lines.join(" ");
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
        <h3>${esc(a.name)}</h3>
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
}

// ── open system ────────────────────────────────────────────
async function openAgent(id) {
  const data = await api(`/api/agents/${id}`);
  state.agent = data.agent;
  state.score = data.score;
  state.checklist = data.checklist;
  state.dirty = false;
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
    const enabled = new Set(a.s3_tools?.enabledToolIds || []);
    const irrev = ["send_email", "refund_payment"].filter((t) => enabled.has(t));
    const line = new Set(a.s4_guardrails?.irreversibilityLine || []);
    const lineOk = irrev.every((t) => line.has(t));
    const gateOk = irrev.length === 0 || a.s4_guardrails?.humanGate;
    return a.s4_guardrails?.worstCase3am && lineOk && gateOk ? "ok" : "warn";
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
  return `
  <div class="card"><h3>Pattern</h3><div class="pattern-list" id="patternList">${patterns}</div></div>
  <div class="card">
    <div class="card-head"><h3>Chain steps</h3><button class="btn btn-sm" id="btnAddStep" type="button">+ Step</button></div>
    <div class="step-list" id="chainSteps">${steps}</div>
  </div>
  <div class="field"><label>Escalation rule</label><textarea id="f-escalation" rows="2">${esc(a.s1_orchestration?.escalationRule || "")}</textarea></div>
  <div class="field" style="margin-top:10px"><label>Judge criteria</label><textarea id="f-judge" rows="2">${esc(a.s1_orchestration?.judgeCriteria || "")}</textarea></div>
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
    <div class="ring"><div class="rt">Inner · Irreversibility</div>Cannot take back → human gate.</div>
    <div class="ring"><div class="rt">Around · Breakers</div>Spend · loops · time fuses.</div>
  </div>
  <div class="form-grid">
    <div class="field"><label>3 A.M. worst case</label><textarea id="f-3am" rows="2">${esc(a.s4_guardrails?.worstCase3am || "")}</textarea></div>
    <div class="field"><label>Irreversibility line</label><input id="f-irrev" class="mono" value="${escAttr((a.s4_guardrails?.irreversibilityLine || []).join(", "))}" /></div>
    <div class="form-row">
      <div class="switch-row"><div><span>Human gate</span></div>
        <label class="toggle"><input type="checkbox" id="f-humangate" ${a.s4_guardrails?.humanGate !== false ? "checked" : ""} /><i></i></label></div>
      <div class="switch-row"><div><span>Validate input</span></div>
        <label class="toggle"><input type="checkbox" id="f-val-in" ${a.s4_guardrails?.validateInput !== false ? "checked" : ""} /><i></i></label></div>
    </div>
    <div class="switch-row"><div><span>Validate output</span></div>
      <label class="toggle"><input type="checkbox" id="f-val-out" ${a.s4_guardrails?.validateOutput !== false ? "checked" : ""} /><i></i></label></div>
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
  <div class="form-row">
    <div class="switch-row"><div><span>Prompt caching</span></div>
      <label class="toggle"><input type="checkbox" id="f-cache" ${a.s6_power?.promptCaching !== false ? "checked" : ""} /><i></i></label></div>
    <div class="switch-row"><div><span>Parallel independents</span></div>
      <label class="toggle"><input type="checkbox" id="f-parallel" ${a.s6_power?.parallelWhereIndependent !== false ? "checked" : ""} /><i></i></label></div>
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
    <div class="switch-row"><div><span>Idempotent retries</span><small>One flaky call ≠ two refunds</small></div>
      <label class="toggle"><input type="checkbox" id="f-idempotent" ${a.s7_chassis?.idempotentRetries !== false ? "checked" : ""} /><i></i></label></div>
    <div class="switch-row"><div><span>Degraded modes</span><small>Narrow, don’t collapse</small></div>
      <label class="toggle"><input type="checkbox" id="f-degraded" ${a.s7_chassis?.degradedModes !== false ? "checked" : ""} /><i></i></label></div>
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
    <p class="muted" style="margin:0;font-size:12px">Ship when instruments pass and irreversibility is gated.</p>
  </div>
  <div class="check-list">${items}</div>`;
}

function wireInspectorHandlers(layer) {
  if (layer === "s1") {
    $$("#patternList .pattern-item").forEach((btn) => {
      btn.addEventListener("click", () => {
        collectForm();
        state.agent.s1_orchestration.pattern = btn.dataset.id;
        state.dirty = true;
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
        state.dirty = true;
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
        // Keep S4 line honest: only gate irreversible tools that are actually enabled
        syncIrrevLineFromTools(state.agent);
        state.dirty = true;
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
  $("#inspector")?.addEventListener(
    "change",
    () => {
      state.dirty = true;
    },
    { once: true }
  );
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
        judgeCriteria: val("#f-judge")?.trim() || "",
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
  if ($("#f-3am") || layer === "s4") {
    if ($("#f-3am")) {
      a.s4_guardrails = {
        ...a.s4_guardrails,
        worstCase3am: val("#f-3am")?.trim() || "",
        irreversibilityLine: (val("#f-irrev") || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        humanGate: checked("#f-humangate"),
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
        promptCaching: checked("#f-cache"),
        parallelWhereIndependent: checked("#f-parallel"),
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
        degradedModes: checked("#f-degraded"),
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
  state.dirty = false;
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
  $("#mTurns").textContent = "—";
  $("#mTokens").textContent = "—";
  $("#mCost").textContent = "—";
  $("#mStop").textContent = "—";
  $("#approvalsBox").innerHTML = "";
  $("#traceList").innerHTML = `<div class="muted">Flight recorder appears after a run (S5).</div>`;
  state.lastRun = null;
  updateBreakerCaps();
}

async function runAgent(opts = {}) {
  if (!state.agent) return;
  await saveAgent();
  const message = opts.message ?? $("#runMessage").value.trim();
  if (!message && !opts.resumeRunId) return toast("Enter a user message", "err");
  $("#btnRun").disabled = true;
  $("#btnRun").textContent = "Running…";
  try {
    const run = await api(`/api/agents/${state.agent.id}/run`, {
      method: "POST",
      body: JSON.stringify({
        message,
        approvals: opts.approvals || [],
        resumeRunId: opts.resumeRunId,
      }),
    });
    state.lastRun = run;
    renderRun(run);
    if (run.trace?.length) showOp("trace");
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
  updateBreakerCaps();

  const box = $("#approvalsBox");
  if (run.pendingApprovals?.length) {
    showOp("run");
    box.innerHTML = run.pendingApprovals
      .map(
        (p) => `
      <div class="approval">
        <strong>Human gate · S4</strong>
        <div style="margin:6px 0">${esc(p.reason)}</div>
        <div class="mono" style="font-size:11px;margin-bottom:8px;font-family:var(--mono)">${esc(p.tool)} ${esc(JSON.stringify(p.arguments))}</div>
        <button class="btn btn-good btn-sm" data-approve="${escAttr(p.callId)}">Approve & continue</button>
      </div>`
      )
      .join("");
    $$("[data-approve]", box).forEach((btn) => {
      btn.addEventListener("click", () => {
        runAgent({
          message: run.input,
          resumeRunId: run.id,
          approvals: [btn.dataset.approve, ...run.pendingApprovals.map((p) => p.tool)],
        });
      });
    });
  } else box.innerHTML = "";

  const tl = $("#traceList");
  if (!run.trace?.length) {
    tl.innerHTML = `<div class="muted">No trace events.</div>`;
    return;
  }
  tl.innerHTML = run.trace
    .map((ev) => {
      const kind =
        ev.type === "tool_result"
          ? "tool"
          : ev.type === "guardrail"
            ? "guardrail"
            : ev.type === "model_call"
              ? "model"
              : "";
      const body = { ...ev };
      delete body.at;
      return `<div class="tev ${kind}"><div class="etype">${esc(ev.type)}${ev.turn != null ? ` · turn ${ev.turn}` : ""}</div><pre>${esc(JSON.stringify(body, null, 2))}</pre></div>`;
    })
    .join("");
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
      <div class="rs ${escAttr(r.status)}">${esc(r.status)}</div>
      <div>${esc((r.input || "").slice(0, 90))}</div>
      <div class="muted" style="font-size:10px;font-family:var(--mono)">${esc(r.id)} · $${(r.costUsd || 0).toFixed(4)}</div>
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
      el.innerHTML = `<div class="muted">No notes. Enable memory_write and run.</div>`;
      return;
    }
    el.innerHTML = mem.notes
      .map(
        (n) =>
          `<div class="mem-note"><strong>${esc(n.key)}</strong> <span class="muted">${esc((n.tags || []).join(", "))}</span><br/>${esc(n.value)}</div>`
      )
      .join("");
  } catch {
    /* ignore */
  }
}

async function runEvals() {
  await saveAgent();
  const btn = $("#btnRunEvals");
  if (btn) btn.disabled = true;
  try {
    const report = await api(`/api/agents/${state.agent.id}/evals`, {
      method: "POST",
      body: "{}",
    });
    const box = $("#evalReport");
    if (box) {
      box.style.display = "block";
      box.textContent =
        `${report.passed}/${report.total} passed\n\n` +
        report.results
          .map(
            (r) =>
              `${r.passed ? "✓" : "✗"} ${r.name}\n  in: ${r.input}\n  out: ${(r.output || "").slice(0, 140)}`
          )
          .join("\n\n");
    }
    toast(`${report.passed}/${report.total} evals passed`);
  } catch (err) {
    toast(err.message, "err");
  } finally {
    if (btn) btn.disabled = false;
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

  return data;
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
  const gateList = (sketch.s4_guardrails?.irreversibilityLine || []).length
    ? sketch.s4_guardrails.irreversibilityLine.join(", ")
    : "none — model enabled no irreversible tools";
  const caps = (sketch.inferredCapabilities || []).length
    ? sketch.inferredCapabilities.join(", ")
    : "(model listed none)";

  $("#sketchGrid").innerHTML = `
    <div class="sketch-row"><div class="ly">Model</div><div class="mono">${esc(sketch.modelRef || "")}</div></div>
    <div class="sketch-row"><div class="ly">Caps</div><div><strong>${esc(caps)}</strong><br/><span class="muted">Server still strips invented irreversible tools.</span></div></div>
    <div class="sketch-row"><div class="ly">S1</div><div><strong>${esc(sketch.s1_orchestration?.pattern || "")}</strong> · freedom ${fre}/5<br/><span class="muted">${esc(sketch.reason || "")}</span></div></div>
    <div class="sketch-row"><div class="ly">S3</div><div>Tools: <span class="mono">${esc(toolsList)}</span></div></div>
    <div class="sketch-row"><div class="ly">S4</div><div>Gate: <span class="mono">${esc(gateList)}</span><br/><span class="muted">${esc(sketch.s4_guardrails?.worstCase3am || "")}</span></div></div>
    <div class="sketch-row"><div class="ly">S5</div><div>${(sketch.s5_instruments?.evals || []).length} eval(s) · traces ${sketch.s5_instruments?.traces ? "on" : "off"}</div></div>
    <div class="sketch-row"><div class="ly">S6</div><div>Budget $${sketch.s4_guardrails?.breakers?.maxSpendUsd ?? "—"} · ${sketch.s6_power?.turnLimit ?? "—"} turns</div></div>
    <div class="sketch-row"><div class="ly">S7</div><div>Checkpoints · versioned · idempotent retries</div></div>`;
  $("#sketchModal").classList.add("open");
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
  $("#sketchCreate").addEventListener("click", () =>
    createFromSketch().catch((e) => toast(e.message, "err"))
  );
  $("#sketchRetry")?.addEventListener("click", () => {
    $("#sketchModal").classList.remove("open");
    sketchWithSelectedModel();
  });

  $("#btnSave").addEventListener("click", () => saveAgent().catch((e) => toast(e.message, "err")));
  $("#btnRun").addEventListener("click", () => runAgent());
  $("#btnRefreshMem").addEventListener("click", loadMemory);
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
}

boot().catch((err) => {
  console.error(err);
  toast("Failed to boot: " + err.message, "err");
});
