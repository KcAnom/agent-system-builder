/**
 * Load providers + credentials from the user's real Pi instance (~/.pi/agent).
 * No placeholder models. Credentials come from auth.json / env refs in models.json.
 */

import fs from "fs";
import os from "os";
import path from "path";

const PI_AGENT = path.join(os.homedir(), ".pi", "agent");
const MODELS_PATH = path.join(PI_AGENT, "models.json");
const AUTH_PATH = path.join(PI_AGENT, "auth.json");

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function resolveEnvRef(value) {
  if (typeof value !== "string") return value;
  // "$DEEPSEEK_API_KEY" or "${DEEPSEEK_API_KEY}"
  const m = value.match(/^\$\{?([A-Z0-9_]+)\}?$/);
  if (m) return process.env[m[1]] || "";
  return value;
}

export function getPiPaths() {
  return { agentDir: PI_AGENT, modelsPath: MODELS_PATH, authPath: AUTH_PATH };
}

export function loadModelsConfig() {
  const cfg = readJson(MODELS_PATH);
  if (!cfg?.providers) {
    throw new Error(`No Pi models found at ${MODELS_PATH}`);
  }
  return cfg;
}

export function loadAuth() {
  return readJson(AUTH_PATH) || {};
}

/**
 * Resolve API credential for a provider without logging secrets.
 * Returns { type, token, source } or null.
 */
export function resolveCredential(providerId, providerCfg) {
  const auth = loadAuth();
  const entry = auth[providerId];

  if (entry?.type === "api_key" && entry.key) {
    return { type: "api_key", token: entry.key, source: "auth.json" };
  }
  if (entry?.type === "oauth" && entry.access) {
    return {
      type: "oauth",
      token: entry.access,
      refresh: entry.refresh,
      expires: entry.expires,
      source: "auth.json",
    };
  }
  // Some providers share keys under aliases
  if (providerId.includes("deepseek") && auth["deepseek-openai"]?.key) {
    return {
      type: "api_key",
      token: auth["deepseek-openai"].key,
      source: "auth.json:deepseek-openai",
    };
  }
  if (providerId.includes("glm") && auth.glm?.key) {
    return { type: "api_key", token: auth.glm.key, source: "auth.json:glm" };
  }
  if (providerId === "fugu" && auth.fugu?.key) {
    return { type: "api_key", token: auth.fugu.key, source: "auth.json:fugu" };
  }

  // models.json apiKey field may be env ref or literal
  const fromCfg = resolveEnvRef(providerCfg?.apiKey);
  if (fromCfg && fromCfg !== "not-needed" && !fromCfg.startsWith("$")) {
    return { type: "api_key", token: fromCfg, source: "models.json" };
  }
  if (providerCfg?.apiKey === "not-needed" || providerCfg?.baseUrl?.includes("localhost")) {
    return { type: "none", token: "not-needed", source: "local" };
  }

  // Common env fallbacks
  const envMap = {
    "openai-codex": "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    "deepseek-openai": "DEEPSEEK_API_KEY",
    glm: "ZAI_API_KEY",
  };
  const envName = envMap[providerId];
  if (envName && process.env[envName]) {
    return { type: "api_key", token: process.env[envName], source: `env:${envName}` };
  }
  return null;
}

/**
 * Models the UI can select. Marks whether credentials appear available.
 * Does not expose secret values.
 */
export function listSelectableModels() {
  const cfg = loadModelsConfig();
  const out = [];

  for (const [providerId, provider] of Object.entries(cfg.providers || {})) {
    const cred = resolveCredential(providerId, provider);
    const api = provider.api || "openai-completions";
    // Prefer chat-completions style for sketching; still list others with notes
    const supported =
      api === "openai-completions" ||
      api === "openai-responses" ||
      api === "anthropic-messages";
    // openai-codex-responses needs ChatGPT backend protocol — not generic chat sketch

    for (const m of provider.models || []) {
      const modelId = m.id || m.name;
      if (!modelId) continue;
      // Skip pure vision-only if no text — still allow if text in input
      const inputs = m.input || ["text"];
      if (!inputs.includes("text")) continue;

      out.push({
        ref: `${providerId}/${modelId}`,
        providerId,
        providerName: provider.name || providerId,
        modelId,
        modelName: m.name || modelId,
        api,
        baseUrl: provider.baseUrl || null,
        reasoning: !!m.reasoning,
        contextWindow: m.contextWindow || null,
        maxTokens: m.maxTokens || null,
        supported,
        credential: cred
          ? { ok: true, type: cred.type, source: cred.source }
          : { ok: false, type: null, source: null },
        ready: supported && !!cred,
      });
    }
  }

  // Ready models first, then by provider name
  out.sort((a, b) => {
    if (a.ready !== b.ready) return a.ready ? -1 : 1;
    return (a.providerName + a.modelName).localeCompare(b.providerName + b.modelName);
  });

  return {
    modelsPath: MODELS_PATH,
    authPath: AUTH_PATH,
    models: out,
    readyCount: out.filter((m) => m.ready).length,
  };
}

export function getModelRef(ref) {
  if (!ref || !ref.includes("/")) {
    throw new Error("Model ref must be providerId/modelId");
  }
  const cfg = loadModelsConfig();
  const providers = cfg.providers || {};

  // Model ids may contain slashes (mlx-community/...). Match longest providerId prefix.
  let providerId = null;
  let modelId = null;
  const ids = Object.keys(providers).sort((a, b) => b.length - a.length);
  for (const pid of ids) {
    if (ref === pid || ref.startsWith(pid + "/")) {
      providerId = pid;
      modelId = ref.slice(pid.length + 1);
      break;
    }
  }
  if (!providerId || !modelId) {
    throw new Error(`Unknown Pi model ref: ${ref}`);
  }

  const provider = providers[providerId];
  const model = (provider.models || []).find((m) => (m.id || m.name) === modelId);
  if (!model) throw new Error(`Unknown model ${modelId} under ${providerId}`);
  const cred = resolveCredential(providerId, provider);
  if (!cred) {
    throw new Error(
      `No credentials for provider "${providerId}" in ~/.pi/agent/auth.json. Log in via Pi first.`
    );
  }
  return {
    ref: `${providerId}/${modelId}`,
    providerId,
    provider,
    modelId,
    model,
    cred,
    api: provider.api || "openai-completions",
    baseUrl: provider.baseUrl,
  };
}

/**
 * Call a Pi-configured model with a system + user message.
 * Returns assistant text. Never logs tokens.
 */
export async function completeChat({
  ref,
  system,
  user,
  temperature = 0.2,
  maxTokens = 4096,
}) {
  const resolved = getModelRef(ref);
  const { api, baseUrl, modelId, cred, providerId } = resolved;

  if (api === "openai-completions") {
    return completeOpenAICompletions({
      baseUrl,
      modelId,
      token: cred.token,
      system,
      user,
      temperature,
      maxTokens,
      providerId,
    });
  }

  if (api === "openai-responses") {
    return completeOpenAIResponses({
      baseUrl,
      modelId,
      token: cred.token,
      system,
      user,
      temperature,
      maxTokens,
      providerId,
    });
  }

  if (api === "anthropic-messages") {
    return completeAnthropic({
      baseUrl,
      modelId,
      token: cred.token,
      system,
      user,
      temperature,
      maxTokens,
      providerId,
    });
  }

  throw new Error(
    `Provider API "${api}" is not supported for sketching yet. Pick an openai-completions or anthropic-messages model from your Pi list.`
  );
}

async function completeOpenAICompletions({
  baseUrl,
  modelId,
  token,
  system,
  user,
  temperature,
  maxTokens,
  providerId,
}) {
  const url = `${String(baseUrl).replace(/\/$/, "")}/chat/completions`;
  const headers = {
    "Content-Type": "application/json",
  };
  if (token && token !== "not-needed") {
    headers.Authorization = `Bearer ${token}`;
  }
  // GLM / Zhipu sometimes wants this
  if (providerId.includes("glm")) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: modelId,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Model call failed (${providerId}/${modelId}) HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${providerId}: ${text.slice(0, 200)}`);
  }
  const content =
    data.choices?.[0]?.message?.content ||
    data.choices?.[0]?.text ||
    "";
  if (!content) {
    throw new Error(`Empty model response from ${providerId}/${modelId}`);
  }
  return typeof content === "string" ? content : JSON.stringify(content);
}

async function completeOpenAIResponses({
  baseUrl,
  modelId,
  token,
  system,
  user,
  temperature,
  maxTokens,
  providerId,
}) {
  const url = `${String(baseUrl).replace(/\/$/, "")}/responses`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: modelId,
      temperature,
      max_output_tokens: maxTokens,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Responses API failed (${providerId}) HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = JSON.parse(text);
  // OpenAI responses shapes vary
  if (typeof data.output_text === "string" && data.output_text) return data.output_text;
  const parts = data.output || data.choices || [];
  const joined = JSON.stringify(parts);
  // try common path
  const msg = data.output?.find?.((o) => o.type === "message");
  if (msg?.content) {
    const t = msg.content.map?.((c) => c.text || c).join?.("") || JSON.stringify(msg.content);
    if (t) return t;
  }
  if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
  throw new Error(`Could not parse responses payload from ${providerId}: ${joined.slice(0, 200)}`);
}

async function completeAnthropic({
  baseUrl,
  modelId,
  token,
  system,
  user,
  temperature,
  maxTokens,
  providerId,
}) {
  const root = String(baseUrl || "https://api.anthropic.com").replace(/\/$/, "");
  // deepseek anthropic gateway uses baseUrl already including /anthropic
  const url = root.endsWith("/v1") ? `${root}/messages` : `${root}/v1/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": token,
      Authorization: `Bearer ${token}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      temperature,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic-messages failed (${providerId}) HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = JSON.parse(text);
  const content = data.content?.map?.((c) => c.text || "").join("") || data.content?.[0]?.text || "";
  if (!content) throw new Error(`Empty anthropic response from ${providerId}`);
  return content;
}
