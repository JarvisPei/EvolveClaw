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

  // ── Per-run state ──
  let guidelines: GuidelineEntry[] = [];
  let currentSystemPrompt = "";
  let currentModelOutput = "";
  let currentTrigger = "";
  let currentSessionId = "";
  let previousSessionId = "";
  let stepCount = 0;
  let guidelinesSynthesized = 0;
  let currentToolCalls: string[] = [];
  let currentObservations: string[] = [];
  let currentError = "";
  let skipCurrentSession = false;

  // ── Cold start: load strategic rules from SCOPE server ──
  client.getStrategicRules(config.agentName).then((res) => {
    if (res?.rules) {
      guidelines.push({ text: res.rules, type: "strategic" });
      api.logger.info(`evolveclaw: loaded ${res.rule_count} strategic rule(s) from SCOPE server`);
    }
  });

  // ── Guideline management helpers ──

  function enforceGuidelineCap() {
    if (guidelines.length <= config.maxGuidelines) return;
    const tactical = guidelines.filter((g) => g.type === "tactical");
    const strategic = guidelines.filter((g) => g.type === "strategic");
    const budget = Math.max(0, config.maxGuidelines - strategic.length);
    const retained = tactical.slice(-budget);
    guidelines = [...strategic, ...retained];
    api.logger.info(`evolveclaw: guideline cap enforced, ${guidelines.length} remaining`);
  }

  function extractTaskSummary(
    messages: Array<{ role: string; content?: string }> | undefined,
    sessionId: string,
  ): string {
    const lastUserMsg = messages?.filter((m) => m.role === "user").pop();
    if (lastUserMsg?.content) {
      const text = lastUserMsg.content.trim();
      return text.length > 200 ? text.slice(0, 200) + "..." : text;
    }
    return `Session ${sessionId}: agent task`;
  }

  // ── Hook: before_prompt_build ──
  api.on("before_prompt_build", (event, ctx) => {
    currentSystemPrompt = event.prompt ?? "";
    currentTrigger = ctx.trigger ?? "";
    currentSessionId = ctx.sessionId ?? "";

    if (SIDE_TRIGGERS.has(currentTrigger)) return {};

    // Skip sub-agent sessions — they use minimal prompts for narrow
    // internal tasks and would generate noisy, low-value guidelines.
    skipCurrentSession = isSubagentSession(currentSessionId);
    if (skipCurrentSession) {
      api.logger.debug(`evolveclaw: skipping sub-agent session ${currentSessionId}`);
      return {};
    }

    // Session switch detection → tactical reset.
    if (previousSessionId && previousSessionId !== currentSessionId) {
      const tacticalCount = guidelines.filter((g) => g.type === "tactical").length;
      guidelines = guidelines.filter((g) => g.type !== "tactical");
      client.resetTactical(config.agentName, previousSessionId);
      api.logger.info(`evolveclaw: session switch detected, cleared ${tacticalCount} tactical guideline(s)`);
    }
    previousSessionId = currentSessionId;

    const activeGuidelines = guidelines.filter((g) => g.text);
    if (activeGuidelines.length === 0) return {};

    const block = formatGuidelinesBlock(activeGuidelines);
    return buildInjectionResult(block, config.injectMode);
  });

  // ── Hook: llm_output ──
  api.on("llm_output", (event) => {
    if (skipCurrentSession) return;
    if (event.text) {
      currentModelOutput = event.text;
    }
  });

  // ── Hook: before_tool_call (capture tool name + input) ──
  api.on("before_tool_call", (event) => {
    if (skipCurrentSession) return;
    const { name, input } = event as { name?: string; input?: unknown };
    const summary = `[tool: ${name ?? "unknown"}] ${JSON.stringify(input ?? {}).slice(0, 500)}`;
    currentToolCalls.push(summary);
  });

  // ── Hook: after_tool_call (capture tool result or error) ──
  api.on("after_tool_call", (event) => {
    if (skipCurrentSession) return;
    const { output, error } = event as { output?: string; error?: string };
    if (error) {
      currentError = error.slice(0, 1000);
    }
    if (output) {
      currentObservations.push(output.slice(0, 1000));
    }
  });

  // ── Hook: agent_end ──
  api.on("agent_end", async (event) => {
    if (skipCurrentSession || SIDE_TRIGGERS.has(currentTrigger)) {
      currentModelOutput = "";
      currentToolCalls = [];
      currentObservations = [];
      currentError = "";
      return;
    }

    stepCount++;

    const messages = (event as { messages?: Array<{ role: string; content?: string }> }).messages;
    const lastAssistant = messages?.filter((m) => m.role === "assistant").pop();
    const taskDescription = extractTaskSummary(messages, currentSessionId);

    const stepResult = await client.onStepComplete({
      agent_name: config.agentName,
      agent_role: "OpenClaw AI Assistant",
      task: taskDescription,
      model_output: currentModelOutput || lastAssistant?.content || "",
      tool_calls: currentToolCalls.length > 0 ? currentToolCalls.join("\n---\n") : undefined,
      observations: currentObservations.length > 0 ? currentObservations.join("\n---\n") : undefined,
      error: currentError || undefined,
      current_system_prompt: currentSystemPrompt,
      task_id: currentSessionId,
    });

    if (stepResult?.guideline && !stepResult.skipped) {
      guidelines.push({
        text: stepResult.guideline,
        type: stepResult.guideline_type ?? "tactical",
        guidelineId: stepResult.guideline_id,
      });
      guidelinesSynthesized++;
      enforceGuidelineCap();
      api.logger.info(
        `evolveclaw: new ${stepResult.guideline_type} guideline synthesized (total: ${guidelines.length}, synthesized: ${guidelinesSynthesized})`,
      );
    }

    // Observability: periodic stats log.
    if (stepCount % 5 === 0) {
      const strategic = guidelines.filter((g) => g.type === "strategic").length;
      const tactical = guidelines.filter((g) => g.type === "tactical").length;
      api.logger.info(
        `evolveclaw: [stats] steps=${stepCount} guidelines=${guidelines.length} (strategic=${strategic} tactical=${tactical}) synthesized=${guidelinesSynthesized}`,
      );
    }

    currentModelOutput = "";
    currentToolCalls = [];
    currentObservations = [];
    currentError = "";
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

  // Strategic guidelines first (highest priority).
  const strategic = guidelines.filter((g) => g.type === "strategic");
  if (strategic.length > 0) {
    lines.push("### Strategic (cross-task, persistent)");
    for (const g of strategic) lines.push(g.text);
    lines.push("");
  }

  // Tactical guidelines (most recent last → highest recency priority).
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
