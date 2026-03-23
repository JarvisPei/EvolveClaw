"""
EvolveClaw SCOPE Sidecar Server

A lightweight FastAPI server that wraps SCOPEOptimizer, exposing it as an HTTP
API for the OpenClaw TypeScript plugin to call. Runs alongside OpenClaw as a
sidecar process.

Endpoints:
    GET  /health              - Health check
    GET  /rules/{agent_name}  - Get strategic rules for an agent
    POST /step                - Report a completed step for analysis
    POST /reset               - Reset tactical state for a task
"""

import asyncio
import logging

import uvicorn
from fastapi import FastAPI
from pydantic import BaseModel, Field

from config import ServerConfig
from scope import SCOPEOptimizer
from scope.models import create_litellm_model, create_openai_model

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("evolveclaw.server")

cfg = ServerConfig()

app = FastAPI(
    title="EvolveClaw SCOPE Server",
    version="0.1.0",
    description="Sidecar server for SCOPE prompt evolution with OpenClaw",
)

# ── Model + optimizer initialization ──

def create_model():
    if cfg.SCOPE_PROVIDER == "openai":
        return create_openai_model(cfg.SCOPE_MODEL)
    return create_litellm_model(cfg.SCOPE_MODEL)

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
)

logger.info(
    "SCOPE optimizer initialized (model=%s, provider=%s, data=%s)",
    cfg.SCOPE_MODEL,
    cfg.SCOPE_PROVIDER,
    cfg.SCOPE_DATA_PATH,
)


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
    version: str = "0.1.0"


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

    If SCOPE synthesizes a new guideline, returns it with its type
    (tactical / strategic). Otherwise returns skipped=True.
    """
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
    logger.info(
        "New %s guideline for %s: %s",
        guideline_type,
        req.agent_name,
        guideline_text[:80] + "..." if len(guideline_text) > 80 else guideline_text,
    )
    return StepResponse(
        guideline=guideline_text,
        guideline_type=guideline_type,
        skipped=False,
    )


@app.post("/reset")
async def reset_tactical(req: ResetRequest):
    """Reset tactical (in-memory) state. Called on /new or task switch."""
    logger.info("Tactical reset for agent=%s task=%s", req.agent_name, req.task_id)
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(
        "server:app",
        host=cfg.HOST,
        port=cfg.PORT,
        log_level="info",
    )
