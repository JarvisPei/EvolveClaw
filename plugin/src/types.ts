// ── Plugin configuration ──

export type InjectMode = "append_system" | "prepend_context" | "both";

export type EvolveClawConfig = {
  serverUrl: string;
  agentName: string;
  enabled: boolean;
  injectMode: InjectMode;
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
