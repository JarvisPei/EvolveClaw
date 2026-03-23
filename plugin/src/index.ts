import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { ScopeClient } from "./scope-client.js";
import type { EvolveClawConfig, GuidelineEntry, InjectMode } from "./types.js";

const DEFAULT_CONFIG: EvolveClawConfig = {
  serverUrl: "http://127.0.0.1:5757",
  agentName: "openclaw-agent",
  enabled: true,
  injectMode: "append_system",
  maxGuidelines: 30,
};

function resolveConfig(api: OpenClawPluginApi): EvolveClawConfig {
  const cfg = (api.pluginConfig ?? {}) as Partial<EvolveClawConfig>;
  return {
    serverUrl: cfg.serverUrl ?? DEFAULT_CONFIG.serverUrl,
    agentName: cfg.agentName ?? DEFAULT_CONFIG.agentName,
    enabled: cfg.enabled ?? DEFAULT_CONFIG.enabled,
    injectMode: cfg.injectMode ?? DEFAULT_CONFIG.injectMode,
    maxGuidelines: cfg.maxGuidelines ?? DEFAULT_CONFIG.maxGuidelines,
  };
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
        // Avoid duplicate entries on retry
        s.guidelines = s.guidelines.filter((g) => g.type !== "strategic");
        s.guidelines.unshift({ text: res.rules, type: "strategic" });
        s.strategicLoaded = true;
        api.logger.info(`evolveclaw: loaded ${res.rule_count} strategic rule(s), guidelines.length: ${s.guidelines.length}`);
      } else {
        api.logger.info("evolveclaw: no strategic rules found on SCOPE server");
      }
    });
  }

  if (!s.strategicLoaded) {
    loadStrategicRules();
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

  function extractTaskSummary(
    messages: Array<{ role: string; content?: unknown }> | undefined,
    sessionId: string,
  ): string {
    const lastUserMsg = messages?.filter((m) => m.role === "user").pop();
    if (lastUserMsg?.content) {
      let text: string;
      if (typeof lastUserMsg.content === "string") {
        text = lastUserMsg.content;
      } else if (Array.isArray(lastUserMsg.content)) {
        text = lastUserMsg.content
          .filter((b: { type?: string }) => b.type === "text")
          .map((b: { text?: string }) => b.text ?? "")
          .join(" ");
      } else {
        text = String(lastUserMsg.content);
      }
      text = text.trim();
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
      api.logger.info("evolveclaw: strategic rules not loaded yet, retrying...");
      loadStrategicRules();
    }

    const activeGuidelines = s.guidelines.filter((g) => g.text);
    if (activeGuidelines.length === 0) {
      api.logger.info("evolveclaw: before_prompt_build — no guidelines to inject");
      return {};
    }

    const block = formatGuidelinesBlock(activeGuidelines);
    const injection = buildInjectionResult(block, config.injectMode);
    api.logger.info(
      `evolveclaw: before_prompt_build — injecting ${activeGuidelines.length} guideline(s) via ${config.injectMode} (${block.length} chars)`,
    );
    return injection;
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
      const c = lastAssistant?.content;
      if (typeof c === "string") fallbackOutput = c;
      else if (Array.isArray(c))
        fallbackOutput = c
          .filter((b: { type?: string }) => b.type === "text")
          .map((b: { text?: string }) => b.text ?? "")
          .join("\n");
    }

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
