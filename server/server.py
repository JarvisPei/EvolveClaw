"""
EvolveClaw SCOPE Sidecar Server

A lightweight FastAPI server that wraps SCOPEOptimizer, exposing it as an HTTP
API for the OpenClaw TypeScript plugin to call. Runs alongside OpenClaw as a
sidecar process.

Endpoints:
    GET  /health                - Health check
    GET  /rules/{agent_name}    - Get strategic rules for an agent
    GET  /stats/{agent_name}    - Get observability stats for an agent
    POST /step                  - Report a completed step for analysis
    POST /reset                 - Reset tactical state for a task
"""

import logging
import time
from collections import defaultdict

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

from config import ServerConfig
from prompts import EVOLVECLAW_DOMAINS, get_custom_prompts
from scope import SCOPEOptimizer
from scope.models import create_anthropic_model, create_litellm_model, create_openai_model
from scope.models.anthropic_adapter import AnthropicAdapter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("evolveclaw.server")

cfg = ServerConfig()

app = FastAPI(
    title="EvolveClaw SCOPE Server",
    version="0.2.0",
    description="Sidecar server for SCOPE prompt evolution with OpenClaw — self-improving agent loop",
)

# ── Model + optimizer initialization ──

def create_model():
    if cfg.SCOPE_PROVIDER == "anthropic":
        from anthropic import AsyncAnthropic
        client_kwargs = {}
        if cfg.SCOPE_API_KEY:
            client_kwargs["api_key"] = cfg.SCOPE_API_KEY
        if cfg.SCOPE_BASE_URL:
            client_kwargs["base_url"] = cfg.SCOPE_BASE_URL
        client = AsyncAnthropic(**client_kwargs)
        return AnthropicAdapter(client, model=cfg.SCOPE_MODEL)
    if cfg.SCOPE_PROVIDER == "openai":
        return create_openai_model(cfg.SCOPE_MODEL, api_key=cfg.SCOPE_API_KEY)
    return create_litellm_model(
        cfg.SCOPE_MODEL, api_key=cfg.SCOPE_API_KEY, base_url=cfg.SCOPE_BASE_URL,
    )

model = create_model()
optimizer = SCOPEOptimizer(
    synthesizer_model=model,
    exp_path=cfg.SCOPE_DATA_PATH,
    enable_quality_analysis=cfg.SCOPE_QUALITY_ANALYSIS,
    quality_analysis_frequency=cfg.SCOPE_QUALITY_FREQUENCY,
    auto_accept_threshold=cfg.SCOPE_ACCEPT_THRESHOLD,
    strategic_confidence_threshold=cfg.SCOPE_STRATEGIC_THRESHOLD,
    max_rules_per_task=cfg.SCOPE_MAX_RULES_PER_TASK,
    max_strategic_rules_per_domain=cfg.SCOPE_MAX_STRATEGIC_PER_DOMAIN,
    synthesis_mode=cfg.SCOPE_SYNTHESIS_MODE,
    custom_prompts=get_custom_prompts(),
    custom_domains=EVOLVECLAW_DOMAINS,
)

start_time = time.time()

logger.info(
    "SCOPE optimizer initialized (model=%s, provider=%s, data=%s)",
    cfg.SCOPE_MODEL,
    cfg.SCOPE_PROVIDER,
    cfg.SCOPE_DATA_PATH,
)

# ── In-memory metrics per agent ──

class AgentMetrics:
    def __init__(self):
        self.total_steps: int = 0
        self.guidelines_synthesized: int = 0
        self.recent_steps: list[float] = []

agent_metrics: dict[str, AgentMetrics] = defaultdict(AgentMetrics)


# ── Request / response models ──

class StepRequest(BaseModel):
    agent_name: str
    agent_role: str = "OpenClaw AI Assistant"
    task: str
    model_output: str | None = None
    tool_calls: str | None = None
    observations: str | None = None
    error: str | None = None
    current_system_prompt: str = ""
    task_id: str | None = None

class StepResponse(BaseModel):
    guideline: str | None = None
    guideline_type: str | None = None
    guideline_id: str | None = None
    skipped: bool = False
    reason: str | None = None

class RulesResponse(BaseModel):
    rules: str = ""
    rule_count: int = 0

class ResetRequest(BaseModel):
    agent_name: str
    task_id: str | None = None

class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.2.0"

class StatsResponse(BaseModel):
    strategic_count: int = 0
    total_steps_analyzed: int = 0
    guidelines_synthesized: int = 0
    recent_synthesis_rate: float = 0.0
    uptime_seconds: float = 0.0


# ── Endpoints ──

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse()


@app.get("/rules/{agent_name}", response_model=RulesResponse)
async def get_rules(agent_name: str):
    """Load persisted strategic rules for the given agent."""
    rules_text = optimizer.get_strategic_rules_for_agent(agent_name)
    rule_count = rules_text.strip().count("\n") + 1 if rules_text.strip() else 0
    return RulesResponse(rules=rules_text, rule_count=rule_count)


@app.post("/step", response_model=StepResponse)
async def on_step_complete(req: StepRequest):
    """
    Analyze a completed agent step via SCOPE.

    Accepts tool_calls, observations, and error in addition to model_output
    for richer learning signal. If SCOPE synthesizes a new guideline, returns
    it with its type (tactical / strategic) and a unique ID for feedback tracking.
    """
    metrics = agent_metrics[req.agent_name]
    metrics.total_steps += 1
    metrics.recent_steps.append(time.time())
    # Keep only last 100 timestamps for rate calculation.
    metrics.recent_steps = metrics.recent_steps[-100:]

    has_context = any([req.model_output, req.error, req.tool_calls, req.observations])
    if not has_context:
        return StepResponse(skipped=True, reason="no context provided")

    error_obj = Exception(req.error) if req.error else None

    try:
        result = await optimizer.on_step_complete(
            agent_name=req.agent_name,
            agent_role=req.agent_role,
            task=req.task,
            model_output=req.model_output,
            tool_calls=req.tool_calls,
            observations=req.observations,
            error=error_obj,
            current_system_prompt=req.current_system_prompt,
            task_id=req.task_id,
        )
    except Exception as exc:
        logger.warning("SCOPE on_step_complete failed: %s", exc, exc_info=True)
        return StepResponse(skipped=True, reason=f"error: {exc}")

    if result is None:
        return StepResponse(skipped=True, reason="no guideline generated")

    guideline_text, guideline_type = result
    guideline_id = f"{req.agent_name}_{metrics.guidelines_synthesized}_{int(time.time())}"
    metrics.guidelines_synthesized += 1

    logger.info(
        "New %s guideline [%s] for %s: %s",
        guideline_type,
        guideline_id,
        req.agent_name,
        guideline_text[:80] + "..." if len(guideline_text) > 80 else guideline_text,
    )
    return StepResponse(
        guideline=guideline_text,
        guideline_type=guideline_type,
        guideline_id=guideline_id,
        skipped=False,
    )


@app.post("/reset")
async def reset_tactical(req: ResetRequest):
    """Reset tactical (in-memory) state. Called on /new or task switch."""
    logger.info("Tactical reset for agent=%s task=%s", req.agent_name, req.task_id)
    try:
        if hasattr(optimizer, "reset_tactical"):
            optimizer.reset_tactical(agent_name=req.agent_name, task_id=req.task_id)
        elif hasattr(optimizer, "reset"):
            optimizer.reset(agent_name=req.agent_name)
    except Exception as exc:
        logger.warning("Tactical reset failed: %s", exc)
    return {"status": "ok"}


@app.get("/stats/{agent_name}", response_model=StatsResponse)
async def get_stats(agent_name: str):
    """
    Return observability metrics for the given agent.
    Enables the system to be aware of its own improvement trajectory.
    """
    metrics = agent_metrics[agent_name]

    rules_text = optimizer.get_strategic_rules_for_agent(agent_name)
    strategic_count = rules_text.strip().count("\n") + 1 if rules_text.strip() else 0

    rate = 0.0
    if metrics.total_steps > 0:
        rate = metrics.guidelines_synthesized / metrics.total_steps

    return StatsResponse(
        strategic_count=strategic_count,
        total_steps_analyzed=metrics.total_steps,
        guidelines_synthesized=metrics.guidelines_synthesized,
        recent_synthesis_rate=round(rate, 4),
        uptime_seconds=round(time.time() - start_time, 1),
    )


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=cfg.HOST,
        port=cfg.PORT,
        log_level="info",
    )
