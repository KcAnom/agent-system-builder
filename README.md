# Agent System Studio

No-code studio for **designing and running agentic systems**, based on the [Agent System Design Blueprint](https://hyperautomationlabs.co/free/agent-blueprint) (Hyperautomation Labs).

> A demo is a model with a prompt. A product is a model with a system around it.

Describe intent → a model from your Pi instance designs the system → refine Core + S1–S7 → run it on a real model → inspect the streamed trace and output → eval → export.

## Quick start

```bash
cd ~/agent-system-builder
npm install
npm start
```

Open **http://localhost:4747** (server binds to 127.0.0.1 only).

## Models

All model access comes from your Pi instance:

- `~/.pi/agent/models.json` — providers + models
- `~/.pi/agent/auth.json` — credentials (API keys / OAuth)

Supported provider APIs: `openai-completions`, `openai-responses`, `anthropic-messages`.

- **Sketch** (left rail): pick an architect model, describe intent, review the sketch, create the system.
- **Run** (right rail): pick a run model — any ready Pi model, or the free deterministic **simulator** that demonstrates the loop without spending tokens.

## What the studio configures

| Layer | What you set |
|-------|--------------|
| **Core** | Goal, system prompt, exit condition, rule zero |
| **S1 Orchestration** | 5 patterns (chain → route → parallel → orch/workers → judge), nesting, escalation |
| **S2 Context + memory** | JIT context, compaction threshold, external notes store |
| **S3 Tools** | Tool bay (few/sharp), custom tools |
| **S4 Guardrails** | 3 A.M. case, input/output validation, spend/loop/time breakers |
| **S5 Instruments** | Traces, eval suite, outcome grading |
| **S6 Power** | Model map by step, run model, token/turn budgets |
| **S7 Chassis** | Checkpoints, retries, timeouts, versioning |

### Runtime features

- Streaming runs — trace events render live as the loop executes
- Token / spend / loop / time breakers actually enforced
- Context compaction when past the threshold of the token budget
- Checkpoint resume after crash
- External memory notes (S2 pump)
- Eval suite runner (simulator by default; real model optional)
- Blueprint score + ship checklist
- Agent CRUD + import/export JSON bundles

## Project layout

```
agent-system-builder/
├── server/
│   ├── index.js      # Express API + static host (127.0.0.1)
│   ├── schema.js     # Agent schema (S1–S7), score, checklist
│   ├── store.js      # JSON file persistence
│   ├── runtime.js    # Loop, tools, breakers, compaction, evals, streaming
│   ├── pi-models.js  # Pi provider/credential resolution + chat calls
│   └── planner.js    # Intent → system sketch via selected Pi model
├── public/           # No-code UI (index.html, app.js, styles.css)
├── data/             # agents, runs, memory
└── docs/             # future plans (Cloudflare tunnel — deferred)
```

## API (short)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents` | List |
| POST | `/api/agents` | Create |
| GET/PUT/DELETE | `/api/agents/:id` | Read / update / delete |
| POST | `/api/agents/:id/run` | `{ message, modelRef?, resumeRunId? }` |
| POST | `/api/agents/:id/run-stream` | Same, NDJSON streaming |
| POST | `/api/agents/:id/evals` | Run eval suite `{ modelRef? }` |
| GET | `/api/agents/:id/export` | Blueprint JSON bundle |
| GET | `/api/agents/:id/memory` | Long-term notes |
| GET | `/api/models` | Selectable Pi models + readiness |
| POST | `/api/sketch` | `{ intent, modelRef }` → system sketch |

## Rule zero

Start with the simplest thing that works. Prefer **prompt chaining** / workflows when steps are known. Grant the model freedom one lane at a time.

## License

MIT — blueprint concepts © Hyperautomation Labs; this implementation is an independent teaching/tooling build.
