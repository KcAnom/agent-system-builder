# Agent System Builder

No-code builder for **agent systems** based on the [Agent System Design Blueprint](https://hyperautomationlabs.co/free/agent-blueprint) (Hyperautomation Labs).

> A demo is a model with a prompt. A product is a model with a system around it.

Build agents as engineered systems: core loop + seven subsystems (S1–S7), ship checklist, run console with traces, human gates, breakers, evals, and checkpoints.

## Quick start

```bash
cd ~/agent-system-builder
npm install
npm start
```

Open **http://localhost:4747**

### Live LLM (optional)

By default the runtime uses a **deterministic simulator** so you can learn the loop without API keys. To use a real model:

```bash
export OPENAI_API_KEY=sk-...
# optional:
export OPENAI_BASE_URL=https://api.openai.com/v1
export OPENAI_MODEL=gpt-4o-mini
export OPENAI_SMALL_MODEL=gpt-4o-mini
npm start
```

Any OpenAI-compatible endpoint works (`OPENAI_BASE_URL`).

## What you get

| Layer | What the builder configures |
|-------|-----------------------------|
| **Core** | Goal, system prompt, exit condition, rule zero |
| **S1 Orchestration** | 5 patterns (chain → route → parallel → orch/workers → judge), nesting, escalation |
| **S2 Context + memory** | JIT context, compaction, external notes store |
| **S3 Tools** | Tool bay (few/sharp), custom tools, irreversible flags |
| **S4 Guardrails** | 3 A.M. case, irreversibility line, human gate, spend/loop/time breakers |
| **S5 Instruments** | Traces, eval suite, outcome grading |
| **S6 Power** | Model map by step, caching, parallelism, token/turn budgets |
| **S7 Chassis** | Checkpoints, idempotent retries, degraded modes, versioning |

### Runtime features

- Agent CRUD + import/export JSON bundles  
- Run console with turn metrics and cost estimate  
- **Human gate** for irreversible tools (`send_email`, `refund_payment`, …)  
- **Trace flight recorder** per run  
- **Checkpoint resume** after approval / crash  
- **External memory** notes (S2 pump)  
- **Eval suite** runner (outcome grading)  
- Blueprint **score** + ship checklist  

## Project layout

```
agent-system-builder/
├── server/
│   ├── index.js      # Express API + static host
│   ├── schema.js     # Agent schema (S1–S7), score, checklist
│   ├── store.js      # JSON file persistence
│   └── runtime.js    # Loop, tools, gates, breakers, evals
├── public/
│   ├── index.html    # No-code UI
│   ├── styles.css
│   └── app.js
├── data/             # agents, runs, memory (gitignored-ish)
├── package.json
└── README.md
```

## API (short)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/agents` | List |
| POST | `/api/agents` | Create |
| GET/PUT/DELETE | `/api/agents/:id` | Read / update / delete |
| POST | `/api/agents/:id/run` | `{ message, approvals?, resumeRunId? }` |
| POST | `/api/agents/:id/evals` | Run eval suite |
| GET | `/api/agents/:id/export` | Blueprint JSON bundle |
| GET | `/api/agents/:id/memory` | Long-term notes |
| GET | `/api/meta/patterns` | S1 pattern catalog |
| GET | `/api/meta/tools` | Default tool bay |

## Workflow

1. **Library** → open a seeded agent or create one.  
2. Walk **Core → S1…S7** like the printed sheet.  
3. Tick the **Ship** checklist (score updates on save).  
4. **Run** a message in the right rail — watch turns, tools, gates.  
5. Approve irreversible actions when paused.  
6. **Run evals** before you trust it.  
7. **Export** the JSON bundle for version control.

## Rule zero

Start with the simplest thing that works. Prefer **prompt chaining** / workflows when steps are known. Grant the model freedom one lane at a time.

## License

MIT — blueprint concepts © Hyperautomation Labs; this implementation is an independent teaching/tooling build.
