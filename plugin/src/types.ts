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
  feedbackEnabled: boolean;
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

export type FeedbackRequest = {
  agent_name: string;
  guideline_id: string;
  task_id?: string;
  rating: "positive" | "negative";
  context?: string;
};

export type FeedbackResponse = {
  status: "ok" | "error";
  action?: "retained" | "retired" | "demoted";
};

export type StatsResponse = {
  total_guidelines: number;
  strategic_count: number;
  tactical_count: number;
  total_steps_analyzed: number;
  guidelines_synthesized: number;
  guidelines_retired: number;
  recent_synthesis_rate: number;
  domains: string[];
  uptime_seconds: number;
};
