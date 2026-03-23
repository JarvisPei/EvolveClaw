import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { ScopeClient } from "./scope-client.js";
import type { ConfigureRequest, EvolveClawConfig, GuidelineEntry, InjectMode } from "./types.js";

const DEFAULT_CONFIG: EvolveClawConfig = {
  serverUrl: "http://127.0.0.1:5757",
  agentName: "openclaw-agent",
  enabled: true,
  injectMode: "append_system",
  maxGuidelines: 30,
  autoStartServer: true,
};

function resolveConfig(api: OpenClawPluginApi): EvolveClawConfig {
  const cfg = (api.pluginConfig ?? {}) as Partial<EvolveClawConfig>;
  return {
    serverUrl: cfg.serverUrl ?? DEFAULT_CONFIG.serverUrl,
    agentName: cfg.agentName ?? DEFAULT_CONFIG.agentName,
    enabled: cfg.enabled ?? DEFAULT_CONFIG.enabled,
    injectMode: cfg.injectMode ?? DEFAULT_CONFIG.injectMode,
    maxGuidelines: cfg.maxGuidelines ?? DEFAULT_CONFIG.maxGuidelines,
    scopeModel: cfg.scopeModel,
    scopeProvider: cfg.scopeProvider,
    scopeApiKey: cfg.scopeApiKey,
    scopeBaseUrl: cfg.scopeBaseUrl,
    autoStartServer: cfg.autoStartServer ?? DEFAULT_CONFIG.autoStartServer,
    pythonPath: cfg.pythonPath,
  };
}

const API_TYPE_TO_SCOPE_PROVIDER: Record<string, string> = {
  "anthropic-messages": "anthropic",
  "openai-completions": "openai",
  "openai-responses": "openai",
  "openai-codex-responses": "openai",
};

async function forwardOpenClawModelConfig(
  api: OpenClawPluginApi,
  client: ScopeClient,
  config: EvolveClawConfig,
): Promise<void> {
  // If explicit key + model are both set in plugin config, use them directly
  if (config.scopeApiKey && config.scopeModel) {
    const res = await client.configure({
      provider: config.scopeProvider ?? "anthropic",
      model: config.scopeModel,
      api_key: config.scopeApiKey,
      base_url: config.scopeBaseUrl,
    });
    if (res?.status === "ok") {
      api.logger.info("evolveclaw: forwarded explicit SCOPE config to server");
    } else if (res?.status === "skipped") {
      api.logger.info(`evolveclaw: server skipped config (${res.reason})`);
    }
    return;
  }

  // Auto-detect from OpenClaw's model settings
  const ocConfig = (api as Record<string, unknown>).config as Record<string, unknown> | undefined;
  if (!ocConfig) return;

  const agents = ocConfig.agents as Record<string, unknown> | undefined;
  const defaults = agents?.defaults as Record<string, unknown> | undefined;
  const modelCfg = defaults?.model as Record<string, unknown> | undefined;
  const primaryModel = modelCfg?.primary as string | undefined;

  if (!primaryModel || !primaryModel.includes("/")) {
    api.logger.info("evolveclaw: no provider/model primary found in OpenClaw config, skipping auto-config");
    return;
  }

  const slashIdx = primaryModel.indexOf("/");
  const providerName = primaryModel.slice(0, slashIdx);
  const modelId = config.scopeModel ?? primaryModel.slice(slashIdx + 1);

  const models = ocConfig.models as Record<string, unknown> | undefined;
  const providers = models?.providers as Record<string, Record<string, unknown>> | undefined;
  const providerCfg = providers?.[providerName];
  const baseUrl = config.scopeBaseUrl ?? (providerCfg?.baseUrl as string | undefined);
  const apiType = providerCfg?.api as string | undefined;
  const provider = config.scopeProvider ?? API_TYPE_TO_SCOPE_PROVIDER[apiType ?? ""] ?? "litellm";

  let apiKey = config.scopeApiKey;
  if (!apiKey) {
    // Try reading apiKey directly from OpenClaw's provider config (works for plain strings)
    const rawKey = providerCfg?.apiKey;
    if (typeof rawKey === "string" && rawKey.trim()) {
      apiKey = rawKey.trim();
    }
  }
  if (!apiKey) {
    // Fall back to runtime auth resolution (handles SecretRef and other auth modes)
    try {
      const runtime = (api as Record<string, unknown>).runtime as Record<string, unknown> | undefined;
      const modelAuth = runtime?.modelAuth as {
        resolveApiKeyForProvider: (p: { provider: string }) => Promise<{ apiKey?: string }>;
      } | undefined;
      if (modelAuth) {
        const auth = await modelAuth.resolveApiKeyForProvider({ provider: providerName });
        apiKey = auth?.apiKey;
      }
    } catch {
      // resolveApiKeyForProvider may not support custom providers
    }
  }

  if (!apiKey) {
    // Check if the server is already configured (e.g., via .env)
    const health = await client.health();
    if (health?.configured) {
      api.logger.info("evolveclaw: server already configured (no auto-config needed)");
    } else {
      api.logger.info(`evolveclaw: no API key resolved for '${providerName}' and server is not configured`);
    }
    return;
  }

  const req: ConfigureRequest = { provider, model: modelId, api_key: apiKey, base_url: baseUrl };
  const res = await client.configure(req);
  if (res?.status === "ok") {
    api.logger.info(`evolveclaw: auto-configured SCOPE with OpenClaw's ${providerName}/${modelId} (provider=${provider})`);
  } else if (res?.status === "skipped") {
    api.logger.info(`evolveclaw: server already configured via .env`);
  }
}

const SPAWN_POLL_INTERVAL_MS = 500;
const SPAWN_TIMEOUT_MS = 15_000;

function findPython(serverDir: string, explicit?: string): string | null {
  if (explicit) {
    try {
      execFileSync(explicit, ["--version"], { stdio: "ignore" });
      return explicit;
    } catch {
      return null;
    }
  }

  // Try candidates: server-local venv first, then system python3/python
  const candidates = [
    resolve(serverDir, "venv/bin/python3"),
    resolve(serverDir, "venv/bin/python"),
    "python3",
    "python",
  ];

  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function ensureServerRunning(
  client: ScopeClient,
  logger: OpenClawPluginApi["logger"],
  config: EvolveClawConfig,
): Promise<void> {
  const health = await client.health();
  if (health) {
    logger.info("evolveclaw: SCOPE server already running");
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const serverDir = resolve(__dirname, "../../server");
  const serverScript = resolve(serverDir, "server.py");

  if (!existsSync(serverScript)) {
    logger.info(
      `evolveclaw: server.py not found at ${serverDir} — start the SCOPE server manually`,
    );
    return;
  }

  const pythonBin = findPython(serverDir, config.pythonPath);
  if (!pythonBin) {
    logger.info("evolveclaw: python not found — install Python 3.10+ or set pythonPath in config");
    return;
  }

  logger.info(`evolveclaw: auto-starting SCOPE server (python=${pythonBin}, dir=${serverDir})`);
  try {
    const child = spawn(pythonBin, ["server.py"], {
      cwd: serverDir,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch (err) {
    logger.info(`evolveclaw: failed to spawn ${pythonBin}: ${err}`);
    return;
  }

  const deadline = Date.now() + SPAWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, SPAWN_POLL_INTERVAL_MS));
    const h = await client.health();
    if (h) {
      logger.info("evolveclaw: SCOPE server started successfully");
      return;
    }
  }

  logger.info(
    "evolveclaw: SCOPE server did not respond within timeout — continuing without SCOPE",
  );
}

const SIDE_TRIGGERS = new Set(["heartbeat", "memory", "cron"]);

function isSubagentSession(sessionKey: string): boolean {
  return sessionKey.toLowerCase().includes("subagent:");
}

// ── Process-global shared state ──
// OpenClaw loads the plugin module in multiple contexts (gateway, plugins, etc.)
// each getting a separate module instance. globalThis is the only way to share
// state across all of them within the same Node.js process.

interface EvolveClawState {
  guidelines: GuidelineEntry[];
  currentSystemPrompt: string;
  currentModelOutput: string;
  currentTrigger: string;
  currentSessionId: string;
  previousSessionId: string;
  stepCount: number;
  guidelinesSynthesized: number;
  currentToolCalls: string[];
  currentObservations: string[];
  currentError: string;
  skipCurrentSession: boolean;
  strategicLoaded: boolean;
  configForwarded: boolean;
  serverSpawnAttempted: boolean;
}

const GLOBAL_KEY = "__evolveclaw_state__";

function getState(): EvolveClawState {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      guidelines: [],
      currentSystemPrompt: "",
      currentModelOutput: "",
      currentTrigger: "",
      currentSessionId: "",
      previousSessionId: "",
      stepCount: 0,
      guidelinesSynthesized: 0,
      currentToolCalls: [],
      currentObservations: [],
      currentError: "",
      skipCurrentSession: false,
      strategicLoaded: false,
      configForwarded: false,
      serverSpawnAttempted: false,
    };
  }
  return g[GLOBAL_KEY] as EvolveClawState;
}

/**
 * EvolveClaw SCOPE Plugin — Self-Improving Agent Prompt Evolution
 *
 * Lifecycle (all hooks are valid OpenClaw plugin hooks):
 *   before_prompt_build  →  inject strategic + accumulated tactical rules
 *   llm_output           →  capture model response for SCOPE analysis
 *   before_tool_call     →  capture tool call name + input
 *   after_tool_call      →  capture tool result / error
 *   agent_end            →  call SCOPE on_step_complete, accumulate new guidelines
 */
export default function register(api: OpenClawPluginApi) {
  const config = resolveConfig(api);
  if (!config.enabled) {
    api.logger.info("evolveclaw: disabled via config");
    return;
  }

  const client = new ScopeClient(config.serverUrl);
  const s = getState();

  // ── Load strategic rules (with retry on first hook if startup fetch failed) ──
  function loadStrategicRules() {
    return client.getStrategicRules(config.agentName).then((res) => {
      if (res?.rules) {
        s.guidelines = s.guidelines.filter((g) => g.type !== "strategic");
        s.guidelines.unshift({ text: res.rules, type: "strategic" });
        s.strategicLoaded = true;
        api.logger.info(`evolveclaw: loaded ${res.rule_count} strategic rule(s), guidelines.length: ${s.guidelines.length}`);
      } else {
        api.logger.info("evolveclaw: no strategic rules found on SCOPE server");
      }
    });
  }

  // ── Startup sequence: spawn server (if needed) → forward config → load rules ──
  if (!s.serverSpawnAttempted) {
    s.serverSpawnAttempted = true;
    (async () => {
      if (config.autoStartServer) {
        await ensureServerRunning(client, api.logger, config);
      }
      if (!s.configForwarded) {
        s.configForwarded = true;
        await forwardOpenClawModelConfig(api, client, config);
      }
      if (!s.strategicLoaded) {
        await loadStrategicRules();
      }
    })().catch(() => {});
  } else if (!s.strategicLoaded) {
    loadStrategicRules().catch(() => {});
  }

  // ── Guideline management helpers ──

  function enforceGuidelineCap() {
    if (s.guidelines.length <= config.maxGuidelines) return;
    const tactical = s.guidelines.filter((g) => g.type === "tactical");
    const strategic = s.guidelines.filter((g) => g.type === "strategic");
    const budget = Math.max(0, config.maxGuidelines - strategic.length);
    const retained = tactical.slice(-budget);
    s.guidelines = [...strategic, ...retained];
    api.logger.info(`evolveclaw: guideline cap enforced, ${s.guidelines.length} remaining`);
  }

  const MAX_HISTORY_TURNS = 5;

  function extractMessageText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b: { type?: string }) => b.type === "text")
        .map((b: { text?: string }) => b.text ?? "")
        .join(" ");
    }
    return String(content ?? "");
  }

  function extractConversationHistory(
    messages: Array<{ role: string; content?: unknown }> | undefined,
  ): string | undefined {
    if (!messages || messages.length <= 2) return undefined;

    // Take the last N user/assistant pairs (excluding the final pair which
    // is already captured in task + model_output)
    const relevant = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-(MAX_HISTORY_TURNS * 2 + 2), -2);

    if (relevant.length === 0) return undefined;

    const lines = relevant.map((m) => {
      const text = extractMessageText(m.content).trim();
      const truncated = text.length > 300 ? text.slice(0, 300) + "..." : text;
      return `[${m.role}]: ${truncated}`;
    });

    return lines.join("\n");
  }

  function extractTaskSummary(
    messages: Array<{ role: string; content?: unknown }> | undefined,
    sessionId: string,
  ): string {
    const lastUserMsg = messages?.filter((m) => m.role === "user").pop();
    if (lastUserMsg?.content) {
      const text = extractMessageText(lastUserMsg.content).trim();
      if (text) return text.length > 200 ? text.slice(0, 200) + "..." : text;
    }
    return `Session ${sessionId}: agent task`;
  }

  // ── Hook: before_prompt_build ──
  api.on("before_prompt_build", (event, ctx) => {
    s.currentSystemPrompt = event.prompt ?? "";
    s.currentTrigger = ctx.trigger ?? "";
    s.currentSessionId = ctx.sessionId ?? "";

    if (SIDE_TRIGGERS.has(s.currentTrigger)) return {};

    s.skipCurrentSession = isSubagentSession(s.currentSessionId);
    if (s.skipCurrentSession) {
      api.logger.debug(`evolveclaw: skipping sub-agent session ${s.currentSessionId}`);
      return {};
    }

    // Session switch detection → tactical reset.
    if (s.previousSessionId && s.previousSessionId !== s.currentSessionId) {
      const tacticalCount = s.guidelines.filter((g) => g.type === "tactical").length;
      s.guidelines = s.guidelines.filter((g) => g.type !== "tactical");
      client.resetTactical(config.agentName, s.previousSessionId);
      api.logger.info(`evolveclaw: session switch detected, cleared ${tacticalCount} tactical guideline(s)`);
    }
    s.previousSessionId = s.currentSessionId;

    // Lazy retry: if startup fetch failed (server wasn't ready), try now.
    // Won't help THIS turn (async) but will be ready for the next one.
    if (!s.strategicLoaded) {
      loadStrategicRules();
    }

    const activeGuidelines = s.guidelines.filter((g) => g.text);
    if (activeGuidelines.length === 0) return {};

    const block = formatGuidelinesBlock(activeGuidelines);
    api.logger.info(
      `evolveclaw: injecting ${activeGuidelines.length} guideline(s) via ${config.injectMode} (${block.length} chars)`,
    );
    return buildInjectionResult(block, config.injectMode);
  });

  // ── Hook: llm_output ──
  api.on("llm_output", (event) => {
    if (s.skipCurrentSession) return;
    if (event.text) {
      s.currentModelOutput = event.text;
    }
  });

  // ── Hook: before_tool_call (capture tool name + input) ──
  api.on("before_tool_call", (event) => {
    if (s.skipCurrentSession) return;
    const { name, input } = event as { name?: string; input?: unknown };
    const summary = `[tool: ${name ?? "unknown"}] ${JSON.stringify(input ?? {}).slice(0, 500)}`;
    s.currentToolCalls.push(summary);
  });

  // ── Hook: after_tool_call (capture tool result or error) ──
  api.on("after_tool_call", (event) => {
    if (s.skipCurrentSession) return;
    const { output, error } = event as { output?: string; error?: string };
    if (error) {
      s.currentError = error.slice(0, 1000);
    }
    if (output) {
      s.currentObservations.push(output.slice(0, 1000));
    }
  });

  // ── Hook: agent_end ──
  api.on("agent_end", async (event) => {
    if (s.skipCurrentSession || SIDE_TRIGGERS.has(s.currentTrigger)) {
      s.currentModelOutput = "";
      s.currentToolCalls = [];
      s.currentObservations = [];
      s.currentError = "";
      return;
    }

    s.stepCount++;

    const messages = (event as { messages?: Array<{ role: string; content?: unknown }> }).messages;
    const taskDescription = extractTaskSummary(messages, s.currentSessionId);

    let fallbackOutput = "";
    if (!s.currentModelOutput) {
      const lastAssistant = messages?.filter((m) => m.role === "assistant").pop();
      fallbackOutput = extractMessageText(lastAssistant?.content);
    }

    const conversationHistory = extractConversationHistory(messages);

    const stepResult = await client.onStepComplete({
      agent_name: config.agentName,
      agent_role: "OpenClaw AI Assistant",
      task: taskDescription,
      model_output: s.currentModelOutput || fallbackOutput,
      tool_calls: s.currentToolCalls.length > 0 ? s.currentToolCalls.join("\n---\n") : undefined,
      observations: s.currentObservations.length > 0 ? s.currentObservations.join("\n---\n") : undefined,
      error: s.currentError || undefined,
      current_system_prompt: s.currentSystemPrompt,
      task_id: s.currentSessionId,
      conversation_history: conversationHistory,
    });

    if (stepResult?.guideline && !stepResult.skipped) {
      s.guidelines.push({
        text: stepResult.guideline,
        type: stepResult.guideline_type ?? "tactical",
        guidelineId: stepResult.guideline_id,
      });
      s.guidelinesSynthesized++;
      enforceGuidelineCap();
      api.logger.info(
        `evolveclaw: new ${stepResult.guideline_type} guideline synthesized (total: ${s.guidelines.length}, synthesized: ${s.guidelinesSynthesized})`,
      );
    }

    if (s.stepCount % 5 === 0) {
      const strategic = s.guidelines.filter((g) => g.type === "strategic").length;
      const tactical = s.guidelines.filter((g) => g.type === "tactical").length;
      api.logger.info(
        `evolveclaw: [stats] steps=${s.stepCount} guidelines=${s.guidelines.length} (strategic=${strategic} tactical=${tactical}) synthesized=${s.guidelinesSynthesized}`,
      );
    }

    s.currentModelOutput = "";
    s.currentToolCalls = [];
    s.currentObservations = [];
    s.currentError = "";
  });

  api.logger.info(
    `evolveclaw: activated (server=${config.serverUrl}, agent=${config.agentName}, inject=${config.injectMode}, maxGuidelines=${config.maxGuidelines})`,
  );
}

// ── Helpers ──

function formatGuidelinesBlock(guidelines: GuidelineEntry[]): string {
  const lines: string[] = [
    "## Learned Guidelines (EvolveClaw/SCOPE)",
    "The following guidelines were synthesized from prior execution traces.",
    "Follow them to improve response quality. If guidelines conflict, prefer the more recent one.",
    "",
  ];

  const strategic = guidelines.filter((g) => g.type === "strategic");
  if (strategic.length > 0) {
    lines.push("### Strategic (cross-task, persistent)");
    for (const g of strategic) lines.push(g.text);
    lines.push("");
  }

  const tactical = guidelines.filter((g) => g.type === "tactical");
  if (tactical.length > 0) {
    lines.push("### Tactical (current task)");
    for (const g of tactical) lines.push(g.text);
    lines.push("");
  }

  return lines.join("\n");
}

function buildInjectionResult(
  block: string,
  mode: InjectMode,
): Record<string, string> {
  if (mode === "prepend_context") return { prependContext: block };
  return { appendSystemContext: block };
}
