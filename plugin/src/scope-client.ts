import type {
  HealthResponse,
  RulesResponse,
  StepCompleteRequest,
  StepCompleteResponse,
} from "./types.js";

/**
 * HTTP client for the SCOPE sidecar server.
 *
 * All methods are fire-and-forget safe — they catch errors internally
 * so a SCOPE server outage never crashes the OpenClaw agent loop.
 */
export class ScopeClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor(baseUrl: string, timeoutMs = 10_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  async health(): Promise<HealthResponse | null> {
    return this.get<HealthResponse>("/health");
  }

  async getStrategicRules(agentName: string): Promise<RulesResponse | null> {
    return this.get<RulesResponse>(`/rules/${encodeURIComponent(agentName)}`);
  }

  async onStepComplete(req: StepCompleteRequest): Promise<StepCompleteResponse | null> {
    return this.post<StepCompleteResponse>("/step", req);
  }

  async resetTactical(agentName: string, taskId?: string): Promise<void> {
    await this.post("/reset", { agent_name: agentName, task_id: taskId });
  }

  // ── Internal helpers ──

  private async get<T>(path: string): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(`${this.baseUrl}${path}`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }
}
