// ── Plugin configuration ──

export type InjectMode = "append_system" | "prepend_context" | "both" | "auto";

export type EvolveClawConfig = {
  serverUrl: string;
  agentName: string;
  enabled: boolean;
  injectMode: InjectMode;
  maxGuidelines: number;
  seedGuidelinesPath: string;
  strategicRefreshInterval: number;
};

// ── Guideline with metadata ──

export type GuidelineEntry = {
  text: string;
  type: "tactical" | "strategic" | "seed";
  createdAt: number;
  injectionCount: number;
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
