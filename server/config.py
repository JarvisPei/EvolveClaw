import os

from dotenv import load_dotenv

load_dotenv()


class ServerConfig:
    HOST: str = os.getenv("EVOLVECLAW_HOST", "127.0.0.1")
    PORT: int = int(os.getenv("EVOLVECLAW_PORT", "5757"))

    # LLM for SCOPE guideline synthesis
    SCOPE_DATA_PATH: str = os.getenv("EVOLVECLAW_SCOPE_DATA", "./scope_data")
    SCOPE_MODEL: str = os.getenv("EVOLVECLAW_SCOPE_MODEL", "gpt-4o-mini")
    SCOPE_PROVIDER: str = os.getenv("EVOLVECLAW_SCOPE_PROVIDER", "openai")
    SCOPE_API_KEY: str | None = os.getenv("EVOLVECLAW_SCOPE_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or os.getenv("ANTHROPIC_API_KEY") or os.getenv("OPENAI_API_KEY")
    SCOPE_BASE_URL: str | None = os.getenv("EVOLVECLAW_SCOPE_BASE_URL") or os.getenv("ANTHROPIC_BASE_URL")

    # SCOPE optimizer settings
    SCOPE_SYNTHESIS_MODE: str = os.getenv("EVOLVECLAW_SYNTHESIS_MODE", "efficiency")
    SCOPE_QUALITY_ANALYSIS: bool = os.getenv("EVOLVECLAW_QUALITY_ANALYSIS", "true").lower() == "true"
    SCOPE_QUALITY_FREQUENCY: int = int(os.getenv("EVOLVECLAW_QUALITY_FREQUENCY", "3"))
    SCOPE_ACCEPT_THRESHOLD: str = os.getenv("EVOLVECLAW_ACCEPT_THRESHOLD", "medium")
    SCOPE_STRATEGIC_THRESHOLD: float = float(os.getenv("EVOLVECLAW_STRATEGIC_THRESHOLD", "0.85"))
    SCOPE_MAX_RULES_PER_TASK: int = int(os.getenv("EVOLVECLAW_MAX_RULES_PER_TASK", "20"))
    SCOPE_MAX_STRATEGIC_PER_DOMAIN: int = int(os.getenv("EVOLVECLAW_MAX_STRATEGIC_PER_DOMAIN", "10"))

    # Feedback loop settings
    FEEDBACK_NEGATIVE_RETIRE_THRESHOLD: int = int(os.getenv("EVOLVECLAW_FEEDBACK_NEGATIVE_RETIRE", "3"))
    FEEDBACK_POSITIVE_PROMOTE_THRESHOLD: int = int(os.getenv("EVOLVECLAW_FEEDBACK_POSITIVE_PROMOTE", "5"))
