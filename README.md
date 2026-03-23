# EvolveClaw

## A self-evolving, personalized OpenClaw — the more you use it, the better it understands you. 

EvolveClaw turns [OpenClaw](https://github.com/openclaw/openclaw) into a **self-improving agent** that continuously adapts to *your* workflows. Powered by [SCOPE](https://github.com/JarvisPei/SCOPE) (Self-evolving Context Optimization via Prompt Evolution), it observes how you interact with the agent — your tasks, your tool usage patterns, your feedback — and **automatically evolves the system prompt** with personalized guidelines that make the agent increasingly effective for *you*, not just any user.

No two EvolveClaw instances are the same. Over time, each one develops a unique personality shaped by its owner's habits.

## Why EvolveClaw?

Today's AI coding agents ship with a static system prompt — every user gets the same instructions. But users are different: some prefer terse answers, others want detailed explanations; some rely heavily on search tools, others write code directly; some work on frontends, others on distributed systems.

EvolveClaw closes this gap with three core ideas:

| Principle | What It Means |
|-----------|--------------|
| **Self-Evolving** | The agent synthesizes behavioral guidelines from its own execution traces. No manual prompt engineering needed — the system prompt improves itself. |
| **Personalized** | Guidelines are derived from *your* interactions — your tasks, your feedback, your tool usage patterns. The agent adapts to how *you* work, not a generic user profile. |
| **Closed-Loop** | User feedback (👍/👎) directly drives guideline retention and retirement. The agent doesn't just accumulate rules — it prunes what doesn't work for you. |

## How It Works

```
You ↔ OpenClaw ↔ LLM
        ↕ (plugin hooks)
   EvolveClaw Plugin (TypeScript)
        ↕ (HTTP)
   SCOPE Sidecar Server (Python)
        ↕
   Your Personal Strategic Memory (disk)
```

1. **Observe** — The plugin captures your full interaction trace: model output, tool calls, observations, errors, and the semantic nature of your task
2. **Learn** — SCOPE analyzes each trace and synthesizes a guideline if warranted — e.g., *"When this user asks for refactoring, prefer small atomic commits over large rewrites"*
3. **Classify** — Each guideline is classified as **tactical** (task-specific, ephemeral) or **strategic** (cross-task, persisted to disk as part of your personal memory)
4. **Inject** — On the next turn, all active guidelines are injected into the system prompt, structured by priority (strategic > seed > tactical)
5. **Feedback** — Your ratings (👍/👎) flow back to the SCOPE server. Guidelines that consistently hurt are **retired**; those that help are **reinforced**
6. **Forget** — When you start a new session, tactical guidelines are cleared. The agent remembers *who you are* (strategic), not *what you were doing yesterday* (tactical)

This creates a **virtuous cycle**: the more you use the agent, the better it understands your preferences, and the more personalized its behavior becomes.

## What Makes It Self-Evolving

Unlike static prompt engineering or manual rule files, EvolveClaw implements a **complete self-improvement loop** — every component listed below operates automatically with zero human intervention:

### Personalized Learning Signal
- **Rich execution traces**: Captures model output, tool calls, tool results, and errors — learning from the full behavioral footprint, not just text
- **Semantic task understanding**: Derives meaningful task descriptions from your prompts, enabling per-task and per-domain guideline management (e.g., "debugging" vs "feature implementation" get different rules)

### Adaptive Memory
- **Strategic memory** — Cross-task guidelines that persist to disk and define your agent's evolved personality. Loaded on every startup, refreshed periodically
- **Tactical memory** — Task-specific guidelines that live in-memory and auto-clear on session switch, preventing context bloat
- **Seed guidelines** — Bootstrap a new agent with baseline behaviors from a file, then let evolution take over
- **Guideline cap** — Enforces a maximum; evicts oldest tactical guidelines first while preserving your strategic and seed rules
- **Conflict resolution** — Guidelines are layered by type with recency-based priority. The LLM is instructed to prefer the most recent guideline when conflicts arise

### Closed-Loop Feedback
- **User ratings** — 👍/👎 on agent responses route directly to the SCOPE server
- **Guideline retirement** — Guidelines that accumulate negative feedback are automatically removed from injection
- **Strategic demotion** — Persistent guidelines that you consistently dislike are removed from disk storage

### Adaptive Injection
- **Auto mode** — Dynamically switches between `append_system` (cacheable, for small guideline sets) and `prepend_context` (per-turn, for large sets) based on total guideline volume

### Observability
- **Stats endpoint** — `GET /stats/{agent_name}` returns live metrics: total steps analyzed, guidelines synthesized/retired, synthesis rate, active domains, uptime
- **Periodic logging** — The plugin logs guideline distribution by type every 5 steps, so you can see the agent's evolution in real time

## Architecture

```
evolveclaw/
├── plugin/                    # OpenClaw TypeScript plugin
│   ├── src/
│   │   ├── index.ts           # Plugin entry: lifecycle hooks, guideline management, feedback loop
│   │   ├── scope-client.ts    # HTTP client for SCOPE sidecar (incl. feedback + stats)
│   │   └── types.ts           # Shared type definitions (config, API, guideline metadata)
│   ├── package.json
│   └── openclaw.plugin.json   # Plugin manifest with config schema
├── server/                    # SCOPE sidecar HTTP server (Python)
│   ├── server.py              # FastAPI server: step analysis, feedback, stats, tactical reset
│   ├── config.py              # Server configuration (env vars)
│   ├── requirements.txt
│   └── .env.template          # Environment variable template
└── scripts/
    ├── start-server.sh        # Start the SCOPE sidecar
    └── install-plugin.sh      # Symlink plugin into OpenClaw
```

## Quick Start

### 1. Start the SCOPE Server

```bash
cd server
cp .env.template .env
# Edit .env with your API key and preferences

pip install -r requirements.txt
python server.py
```

Or use the convenience script:
```bash
./scripts/start-server.sh
```

### 2. Install the Plugin

```bash
./scripts/install-plugin.sh
```

Then enable it in OpenClaw:
```bash
openclaw plugins enable evolveclaw-scope
openclaw gateway restart
```

### 3. Configure (Optional)

In `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "evolveclaw-scope": {
        "enabled": true,
        "config": {
          "serverUrl": "http://127.0.0.1:5757",
          "agentName": "openclaw-agent",
          "injectMode": "auto",
          "maxGuidelines": 30,
          "seedGuidelinesPath": "",
          "strategicRefreshInterval": 10,
          "feedbackEnabled": true
        }
      }
    }
  }
}
```

### Plugin Configuration

| Config | Default | Description |
|--------|---------|-------------|
| `serverUrl` | `http://127.0.0.1:5757` | SCOPE sidecar URL |
| `agentName` | `openclaw-agent` | Agent identifier in SCOPE memory |
| `enabled` | `true` | Toggle on/off without uninstalling |
| `injectMode` | `append_system` | `append_system` (cacheable), `prepend_context` (per-turn), `both`, or `auto` (switches dynamically based on guideline volume) |
| `maxGuidelines` | `30` | Max guidelines in memory; oldest tactical evicted first when cap is reached |
| `seedGuidelinesPath` | `""` | Path to a text file with initial guidelines for cold start |
| `strategicRefreshInterval` | `10` | Re-fetch strategic rules from SCOPE server every N steps |
| `feedbackEnabled` | `true` | Enable user feedback loop for guideline retention/retirement |

### Server Configuration (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `EVOLVECLAW_HOST` | `127.0.0.1` | Server bind address |
| `EVOLVECLAW_PORT` | `5757` | Server port |
| `EVOLVECLAW_SCOPE_MODEL` | `gpt-4o-mini` | LLM for guideline synthesis |
| `EVOLVECLAW_SCOPE_PROVIDER` | `openai` | `openai` or LiteLLM provider |
| `EVOLVECLAW_SCOPE_DATA` | `./scope_data` | Directory for persistent strategic rules |
| `EVOLVECLAW_SYNTHESIS_MODE` | `efficiency` | `efficiency` (fast) or `thoroughness` (comprehensive) |
| `EVOLVECLAW_QUALITY_ANALYSIS` | `true` | Analyze successful steps too |
| `EVOLVECLAW_QUALITY_FREQUENCY` | `3` | Analyze quality every N successful steps |
| `EVOLVECLAW_ACCEPT_THRESHOLD` | `medium` | `all`, `low`, `medium`, `high` |
| `EVOLVECLAW_STRATEGIC_THRESHOLD` | `0.85` | Min confidence for strategic promotion |
| `EVOLVECLAW_MAX_RULES_PER_TASK` | `20` | Max rules SCOPE keeps per task |
| `EVOLVECLAW_MAX_STRATEGIC_PER_DOMAIN` | `10` | Max strategic rules per domain |
| `EVOLVECLAW_FEEDBACK_NEGATIVE_RETIRE` | `3` | Retire guideline after N negative ratings |
| `EVOLVECLAW_FEEDBACK_POSITIVE_PROMOTE` | `5` | Reinforce retention after N positive ratings |

## Design Decisions

### Why self-evolving prompts (not fine-tuning)?

- **Zero training cost**: No GPU, no dataset curation — guidelines are synthesized in-context by the same LLM
- **Interpretable**: Every guideline is a human-readable sentence you can inspect, edit, or delete
- **Reversible**: Bad guidelines are retired via feedback; fine-tuning is a one-way door
- **Personalized at the prompt level**: Works with any base model — swap `gpt-4o` for `claude` and your guidelines carry over

### Why a sidecar server (not embedded)?

- **Language bridge**: SCOPE is Python; OpenClaw plugins are TypeScript. A sidecar avoids complex Node↔Python IPC
- **Decoupled lifecycle**: The SCOPE server can be restarted, upgraded, or swapped independently of OpenClaw
- **Graceful degradation**: If the SCOPE server is down, the plugin silently no-ops — OpenClaw keeps working normally

### Why plugin hooks (not bootstrap files)?

- **Dynamic**: `before_prompt_build` injects guidelines per-turn, not just at session start
- **System prompt space**: `appendSystemContext` places guidelines in cacheable system prompt space, reducing per-turn token cost
- **Clean lifecycle**: `llm_output` + `tool_use` + `tool_result` + `agent_end` capture the full step context for SCOPE analysis
- **Bootstrap files still work**: Strategic rules *could* additionally be written to `AGENTS.md` for persistence across restarts

### Guideline types

| Type | Scope | Persistence | Injection | Priority |
|------|-------|-------------|-----------|----------|
| **Strategic** | Cross-task | Saved to disk — your agent's evolved personality | Loaded on startup + periodic refresh | Highest |
| **Seed** | Baseline | Loaded from file — your initial preferences | Always injected | Medium |
| **Tactical** | Current task | In-memory only — ephemeral working memory | Cleared on session switch | Lowest (most recent wins) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/rules/{agent_name}` | Get strategic rules for an agent |
| `GET` | `/stats/{agent_name}` | Get observability metrics for self-improvement tracking |
| `POST` | `/step` | Report a completed step for SCOPE analysis |
| `POST` | `/reset` | Reset tactical state on session/task switch |
| `POST` | `/feedback` | Submit user feedback for closed-loop guideline management |

## Related Projects

- [SCOPE](https://github.com/JarvisPei/SCOPE) — The prompt evolution framework powering EvolveClaw
- [OpenClaw](https://github.com/openclaw/openclaw) — The AI agent platform

## Citation

```bibtex
@software{pei2026evolveclaw,
  title={EvolveClaw: Evolving OpenClaw's System Prompt via Self-Improving Guidelines},
  author={Pei, Zehua and Zhen, Hui-Ling},
  url={https://github.com/JarvisPei/EvolveClaw},
  year={2026}
}

@article{pei2025scope,
  title={SCOPE: Prompt Evolution for Enhancing Agent Effectiveness},
  author={Pei, Zehua and Zhen, Hui-Ling and Kai, Shixiong and Pan, Sinno Jialin and Wang, Yunhe and Yuan, Mingxuan and Yu, Bei},
  journal={arXiv preprint arXiv:2512.15374},
  year={2025}
}
```

## License

MIT
