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
    POST /configure             - Forward LLM config from OpenClaw plugin
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
from scope.models import create_litellm_model, create_openai_model
from scope.models.anthropic_adapter import AnthropicAdapter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("evolveclaw.server")

cfg = ServerConfig()

app = FastAPI(
    title="EvolveClaw SCOPE Server",
    version="0.3.0",
    description="Sidecar server for SCOPE prompt evolution with OpenClaw — self-improving agent loop",
)

# ── Model + optimizer initialization (supports lazy init) ──

optimizer: SCOPEOptimizer | None = None


def _create_model(provider: str, model_name: str, api_key: str | None, base_url: str | None):
    if provider == "anthropic":
        from anthropic import AsyncAnthropic
        client_kwargs: dict[str, str] = {}
        if api_key:
            client_kwargs["api_key"] = api_key
        if base_url:
            client_kwargs["base_url"] = base_url
        client = AsyncAnthropic(**client_kwargs)
        return AnthropicAdapter(client, model=model_name)
    if provider == "openai":
        return create_openai_model(model_name, api_key=api_key)
    return create_litellm_model(model_name, api_key=api_key, base_url=base_url)


def init_optimizer(provider: str, model_name: str, api_key: str | None, base_url: str | None):
    global optimizer
    model = _create_model(provider, model_name, api_key, base_url)
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
    logger.info(
        "SCOPE optimizer initialized (model=%s, provider=%s, data=%s)",
        model_name, provider, cfg.SCOPE_DATA_PATH,
    )


# Eagerly initialize if .env provides LLM config; otherwise wait for /configure
if cfg.has_explicit_llm_config():
    _provider = cfg.SCOPE_PROVIDER or "openai"
    _model = cfg.SCOPE_MODEL or "gpt-4o-mini"
    init_optimizer(_provider, _model, cfg.SCOPE_API_KEY, cfg.SCOPE_BASE_URL)
else:
    logger.info(
        "No LLM credentials in env — server will wait for POST /configure from the EvolveClaw plugin"
    )

start_time = time.time()

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
    conversation_history: str | None = None

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

class ConfigureRequest(BaseModel):
    provider: str
    model: str
    api_key: str
    base_url: str | None = None

class ConfigureResponse(BaseModel):
    status: str = "ok"
    reason: str | None = None

class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "0.3.0"
    configured: bool = True

class StatsResponse(BaseModel):
    strategic_count: int = 0
    total_steps_analyzed: int = 0
    guidelines_synthesized: int = 0
    recent_synthesis_rate: float = 0.0
    uptime_seconds: float = 0.0


# ── Endpoints ──

@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(configured=optimizer is not None)


@app.post("/configure", response_model=ConfigureResponse)
async def configure(req: ConfigureRequest):
    """
    Accept LLM config forwarded from the EvolveClaw plugin.

    If the server already has explicit .env credentials, this is a no-op
    (env config takes priority). Otherwise, (re-)initializes the model
    and optimizer with the provided credentials.
    """
    if cfg.has_explicit_llm_config() and optimizer is not None:
        return ConfigureResponse(status="skipped", reason="server has explicit .env credentials")

    try:
        init_optimizer(req.provider, req.model, req.api_key, req.base_url)
    except Exception as exc:
        logger.warning("Failed to initialize from /configure: %s", exc, exc_info=True)
        return ConfigureResponse(status="error", reason=str(exc))

    return ConfigureResponse(status="ok")


@app.get("/rules/{agent_name}", response_model=RulesResponse)
async def get_rules(agent_name: str):
    """Load persisted strategic rules for the given agent."""
    if optimizer is None:
        return RulesResponse()
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

    if optimizer is None:
        return StepResponse(skipped=True, reason="optimizer not configured yet")

    has_context = any([req.model_output, req.error, req.tool_calls, req.observations])
    if not has_context:
        return StepResponse(skipped=True, reason="no context provided")

    error_obj = Exception(req.error) if req.error else None

    # Prepend conversation history to model_output so SCOPE sees
    # multi-turn context when synthesizing guidelines.
    effective_output = req.model_output or ""
    if req.conversation_history:
        effective_output = (
            f"## Recent conversation history (previous turns):\n"
            f"{req.conversation_history}\n\n"
            f"## Current turn response:\n{effective_output}"
        )

    try:
        result = await optimizer.on_step_complete(
            agent_name=req.agent_name,
            agent_role=req.agent_role,
            task=req.task,
            model_output=effective_output or None,
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
    if optimizer is None:
        return {"status": "ok"}
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

    rules_text = optimizer.get_strategic_rules_for_agent(agent_name) if optimizer else ""
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
