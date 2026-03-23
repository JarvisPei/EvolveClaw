import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { ScopeClient } from "./scope-client.js";
import type { EvolveClawConfig, InjectMode } from "./types.js";

const DEFAULT_CONFIG: EvolveClawConfig = {
  serverUrl: "http://127.0.0.1:5757",
  agentName: "openclaw-agent",
  enabled: true,
  injectMode: "append_system",
};

function resolveConfig(api: OpenClawPluginApi): EvolveClawConfig {
  const cfg = (api.pluginConfig ?? {}) as Partial<EvolveClawConfig>;
  return {
    serverUrl: cfg.serverUrl ?? DEFAULT_CONFIG.serverUrl,
    agentName: cfg.agentName ?? DEFAULT_CONFIG.agentName,
    enabled: cfg.enabled ?? DEFAULT_CONFIG.enabled,
    injectMode: cfg.injectMode ?? DEFAULT_CONFIG.injectMode,
  };
}

/**
 * EvolveClaw SCOPE Plugin
 *
 * Lifecycle:
 *   before_prompt_build  →  inject strategic + accumulated tactical rules
 *   llm_output           →  capture model response for SCOPE analysis
 *   agent_end            →  call SCOPE on_step_complete, accumulate new guidelines
 *
 * The plugin communicates with a SCOPE sidecar server (Python/FastAPI)
 * via HTTP. If the server is unavailable, all operations gracefully no-op.
 */
export default function register(api: OpenClawPluginApi) {
  const config = resolveConfig(api);
  if (!config.enabled) {
    api.logger.info("evolveclaw: disabled via config");
    return;
  }

  const client = new ScopeClient(config.serverUrl);

  // ── Per-run state ──
  // Accumulated guidelines from SCOPE (persisted across turns within a session).
  let accumulatedGuidelines: string[] = [];
  // Captured from the current run for post-step analysis.
  let currentSystemPrompt = "";
  let currentModelOutput = "";
  let currentTrigger = "";
  let currentSessionId = "";

  // Pre-load strategic rules on startup.
  client.getStrategicRules(config.agentName).then((res) => {
    if (res?.rules) {
      accumulatedGuidelines.push(res.rules);
      api.logger.info(
        `evolveclaw: loaded ${res.rule_count} strategic rule(s) from SCOPE server`,
      );
    }
  });

  // ── Hook: before_prompt_build ──
  // Inject SCOPE guidelines into the system prompt or user context.
  api.on("before_prompt_build", (event, ctx) => {
    currentSystemPrompt = event.prompt ?? "";
    currentTrigger = ctx.trigger ?? "";
    currentSessionId = ctx.sessionId ?? "";

    // Skip injection for housekeeping turns.
    const SIDE_TRIGGERS = new Set(["heartbeat", "memory", "cron"]);
    if (SIDE_TRIGGERS.has(currentTrigger)) {
      return {};
    }

    const guidelines = accumulatedGuidelines.filter(Boolean).join("\n\n");
    if (!guidelines) {
      return {};
    }

    const block = formatGuidelinesBlock(guidelines);
    return buildInjectionResult(block, config.injectMode);
  });

  // ── Hook: llm_output ──
  // Capture the model's response text for SCOPE analysis.
  api.on("llm_output", (event) => {
    if (event.text) {
      currentModelOutput = event.text;
    }
  });

  // ── Hook: agent_end ──
  // After the agent run completes, send the step to SCOPE for analysis.
  // New guidelines are accumulated for injection in the next turn.
  api.on("agent_end", async (event) => {
    const SIDE_TRIGGERS = new Set(["heartbeat", "memory", "cron"]);
    if (SIDE_TRIGGERS.has(currentTrigger)) {
      currentModelOutput = "";
      return;
    }

    // Extract error if present.
    const messages = (event as { messages?: Array<{ role: string; content?: string }> })
      .messages;
    const lastAssistant = messages
      ?.filter((m) => m.role === "assistant")
      .pop();

    const stepResult = await client.onStepComplete({
      agent_name: config.agentName,
      agent_role: "OpenClaw AI Assistant",
      task: `Session ${currentSessionId}: responding to user`,
      model_output: currentModelOutput || lastAssistant?.content || "",
      current_system_prompt: currentSystemPrompt,
      task_id: currentSessionId,
    });

    if (stepResult?.guideline && !stepResult.skipped) {
      accumulatedGuidelines.push(stepResult.guideline);
      api.logger.info(
        `evolveclaw: new ${stepResult.guideline_type} guideline synthesized`,
      );
    }

    currentModelOutput = "";
  });

  api.logger.info(
    `evolveclaw: activated (server=${config.serverUrl}, agent=${config.agentName}, inject=${config.injectMode})`,
  );
}

// ── Helpers ──

function formatGuidelinesBlock(guidelines: string): string {
  return [
    "## Learned Guidelines (EvolveClaw/SCOPE)",
    "The following guidelines were synthesized from prior execution traces.",
    "Follow them to improve response quality:",
    "",
    guidelines,
  ].join("\n");
}

function buildInjectionResult(
  block: string,
  mode: InjectMode,
): Record<string, string> {
  switch (mode) {
    case "append_system":
      return { appendSystemContext: block };
    case "prepend_context":
      return { prependContext: block };
    case "both":
      return { appendSystemContext: block, prependContext: block };
  }
}
