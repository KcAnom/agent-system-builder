/**
 * Model access via the user's real Pi instance.
 * Thin wrapper over @earendil-works/pi-coding-agent's ModelRuntime — Pi's own
 * provider catalog, credential resolution (incl. OAuth refresh), and wire
 * protocols (openai-completions/responses, anthropic-messages, codex, …).
 * No provider logic is reimplemented here.
 */

import os from "os";
import path from "path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

const PI_AGENT = path.join(os.homedir(), ".pi", "agent");
const MODELS_PATH = path.join(PI_AGENT, "models.json");
const AUTH_PATH = path.join(PI_AGENT, "auth.json");

export function getPiPaths() {
  return { agentDir: PI_AGENT, modelsPath: MODELS_PATH, authPath: AUTH_PATH };
}

let runtimePromise = null;

/** Singleton ModelRuntime. Recreated on reload so config edits are picked up. */
function getRuntime() {
  runtimePromise ??= ModelRuntime.create({});
  return runtimePromise;
}

/** Re-create the runtime (picks up edits to models.json / auth.json). */
export function reloadRuntime() {
  runtimePromise = ModelRuntime.create({});
  return runtimePromise;
}

function refOf(model) {
  return `${model.provider}/${model.id}`;
}

/** Providers the user excluded from the studio (Pi itself still has them). */
const EXCLUDED_PROVIDERS = new Set([
  "anthropic",
  "google",
  "cloudflare-workers-ai",
  "kimi-coding",
  "mlx-local",
]);

function isSelectable(model) {
  return !EXCLUDED_PROVIDERS.has(model.provider);
}

/**
 * Models the UI can select — everything Pi reports as available
 * (credentials configured). Does not expose secret values.
 */
export async function listSelectableModels() {
  const rt = await getRuntime();
  const models = rt.snapshot.available
    .filter(isSelectable)
    .map((m) => ({
      ref: refOf(m),
      providerId: m.provider,
      providerName: rt.models.getProvider?.(m.provider)?.name || m.provider,
      modelId: m.id,
      modelName: m.name || m.id,
      api: m.api,
      baseUrl: m.baseUrl || null,
      reasoning: !!m.reasoning,
      contextWindow: m.contextWindow || null,
      maxTokens: m.maxTokens || null,
      supported: true,
      credential: { ok: true, type: "pi", source: "pi-runtime" },
      ready: true,
    }))
    .sort((a, b) => (a.providerName + a.modelName).localeCompare(b.providerName + b.modelName));

  return {
    modelsPath: MODELS_PATH,
    authPath: AUTH_PATH,
    models,
    readyCount: models.length,
  };
}

async function findModel(ref) {
  const rt = await getRuntime();
  const model = rt.snapshot.available.find((m) => refOf(m) === ref);
  if (!model) {
    throw new Error(`Model "${ref}" is not available in your Pi instance. Check /api/models.`);
  }
  if (!isSelectable(model)) {
    throw new Error(`Provider "${model.provider}" is excluded from Agent System Studio.`);
  }
  return { rt, model };
}

const zeroUsage = () => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

/** Convert plain {role, content} history into pi-ai message shapes. */
function toPiMessages(messages, model) {
  return (messages || []).map((m) =>
    m.role === "assistant"
      ? {
          role: "assistant",
          content: [{ type: "text", text: String(m.content ?? "") }],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: zeroUsage(),
          stopReason: "stop",
          timestamp: Date.now(),
        }
      : {
          role: "user",
          content: [{ type: "text", text: String(m.content ?? "") }],
          timestamp: Date.now(),
        }
  );
}

/**
 * Call a Pi model with a system prompt + message history.
 * messages: [{ role: "user" | "assistant", content: string }]
 * Returns { text, tokens, costUsd }.
 */
export async function completeMessages({ ref, system, messages, timeoutMs = 60000 }) {
  const { rt, model } = await findModel(ref);
  const msg = await rt.completeSimple(
    model,
    {
      systemPrompt: system || "",
      messages: toPiMessages(messages, model),
    },
    { timeoutMs }
  );

  if (msg.stopReason === "error" || msg.stopReason === "aborted" || msg.errorMessage) {
    throw new Error(msg.errorMessage || `Model ${ref} stopped: ${msg.stopReason}`);
  }
  const text = (msg.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  if (!text) throw new Error(`Empty response from ${ref}`);
  return {
    text,
    tokens: msg.usage?.totalTokens || 0,
    costUsd: msg.usage?.cost?.total || 0,
  };
}

/** Single-turn convenience wrapper (used by the planner). Returns assistant text. */
export async function completeChat({ ref, system, user }) {
  const { text } = await completeMessages({
    ref,
    system,
    messages: [{ role: "user", content: user }],
  });
  return text;
}
