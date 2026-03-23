// ── Plugin configuration ──

export type InjectMode = "append_system" | "prepend_context";

export type EvolveClawConfig = {
  serverUrl: string;
  agentName: string;
  enabled: boolean;
  injectMode: InjectMode;
  maxGuidelines: number;
  scopeModel?: string;
  scopeProvider?: string;
  scopeApiKey?: string;
  scopeBaseUrl?: string;
  autoStartServer: boolean;
};

// ── Guideline with metadata ──

export type GuidelineEntry = {
  text: string;
  type: "tactical" | "strategic";
  guidelineId?: string;
};

// ── SCOPE sidecar API types ──

export type StepCompleteRequest = {
  agent_name: string;
  agent_role: string;
  task: string;
  model_output?: string;
  tool_calls?: string;
  observations?: string;
  error?: string;
  current_system_prompt: string;
  task_id?: string;
  conversation_history?: string;
};

export type StepCompleteResponse = {
  guideline?: string;
  guideline_type?: "tactical" | "strategic";
  guideline_id?: string;
  skipped: boolean;
  reason?: string;
};

export type RulesResponse = {
  rules: string;
  rule_count: number;
};

export type HealthResponse = {
  status: "ok" | "error";
  version: string;
};

export type StatsResponse = {
  strategic_count: number;
  total_steps_analyzed: number;
  guidelines_synthesized: number;
  recent_synthesis_rate: number;
  uptime_seconds: number;
};

// ── SCOPE server configuration (forwarded from OpenClaw) ──

export type ConfigureRequest = {
  provider: string;
  model: string;
  api_key: string;
  base_url?: string;
};

export type ConfigureResponse = {
  status: "ok" | "skipped";
  reason?: string;
};
