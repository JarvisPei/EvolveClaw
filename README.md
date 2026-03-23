# EvolveClaw

**Evolve OpenClaw's system prompt through self-improving guidelines — powered by SCOPE.**

EvolveClaw integrates [SCOPE](https://github.com/JarvisPei/SCOPE) (Self-evolving Context Optimization via Prompt Evolution) with [OpenClaw](https://github.com/openclaw/openclaw) as an external plugin, requiring **zero modifications** to OpenClaw's core code. It evolves the *system prompt* by synthesizing guidelines from execution traces, making the agent increasingly effective the more you use it.

## How It Works

```
User ↔ OpenClaw ↔ LLM
         ↕ (plugin hooks)
    EvolveClaw Plugin (TypeScript)
         ↕ (HTTP)
    SCOPE Sidecar Server (Python)
         ↕
    Strategic Memory (disk) + Feedback Store (in-memory)
```

1. **`before_prompt_build`** — The plugin injects accumulated SCOPE guidelines into the system prompt via `appendSystemContext`, with session-switch detection that clears tactical guidelines
2. **`llm_output`** — The plugin captures the model's response
3. **`tool_use` / `tool_result` / `tool_error`** — The plugin captures tool calls, observations, and errors for richer learning signal
4. **`agent_end`** — The plugin sends the full step context (model output + tool calls + observations + errors + semantic task description) to the SCOPE server for analysis
5. **SCOPE synthesizes** a new guideline (if warranted) → classified as tactical (task-specific) or strategic (cross-task, persisted), assigned a unique ID for feedback tracking
6. **`user_feedback`** — User ratings (👍/👎) are sent to the SCOPE server; guidelines that consistently receive negative feedback are retired
7. **Next turn** — The new guideline is injected into the prompt, improving the agent's behavior

Over time, the agent accumulates a library of learned guidelines that make it increasingly effective for the user's specific workflows. The feedback loop ensures low-quality guidelines are retired, not just accumulated.

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

# Install and run
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
| `feedbackEnabled` | `true` | Enable user feedback (👍/👎) loop for guideline retention/retirement |

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

## Self-Improving Capabilities

EvolveClaw implements a full **closed-loop self-improvement** cycle:

### Learning
- **Rich execution traces**: Captures model output, tool calls, observations, and errors — not just text responses
- **Semantic task extraction**: Derives meaningful task descriptions from prompts instead of fixed strings, enabling per-task and per-domain rule management

### Memory Management
- **Tactical reset**: Automatically clears task-specific guidelines on session switch, preventing context window bloat
- **Guideline cap**: Enforces a configurable maximum; evicts oldest tactical guidelines first while preserving strategic and seed rules
- **Conflict resolution**: Guidelines are structured by type (strategic → seed → tactical) with recency-based priority and an explicit meta-instruction for the LLM

### Feedback Loop
- **User ratings**: 👍/👎 feedback on agent responses is routed to the SCOPE server
- **Guideline retirement**: Guidelines that accumulate negative feedback are automatically retired and removed from injection
- **Strategic demotion**: Negative feedback on strategic guidelines triggers removal from persistent storage

### Cold Start
- **Seed guidelines**: Load initial guidelines from a text file (`seedGuidelinesPath`) to bootstrap new agents with baseline behaviors

### Adaptive Injection
- **Auto mode**: `injectMode: "auto"` dynamically switches between `append_system` (cacheable, for small guideline sets) and `prepend_context` (per-turn, for large guideline sets) based on total guideline volume

### Observability
- **Stats endpoint**: `GET /stats/{agent_name}` returns live metrics — total steps, guidelines synthesized/retired, synthesis rate, domains, uptime
- **Periodic logging**: The plugin logs guideline counts by type every 5 steps

### Lifecycle
- **Periodic strategic refresh**: Re-fetches strategic rules from the server every N steps to pick up newly promoted rules without requiring a restart

## Design Decisions

### Why a sidecar server (not embedded)?

- **Language bridge**: SCOPE is Python; OpenClaw plugins are TypeScript. A sidecar avoids complex Node↔Python IPC.
- **Decoupled lifecycle**: The SCOPE server can be restarted, upgraded, or swapped independently of OpenClaw.
- **Graceful degradation**: If the SCOPE server is down, the plugin silently no-ops — OpenClaw keeps working normally.

### Why plugin hooks (not bootstrap files)?

- **Dynamic**: `before_prompt_build` injects guidelines per-turn, not just at session start.
- **System prompt space**: `appendSystemContext` places guidelines in cacheable system prompt space, reducing per-turn token cost.
- **Clean lifecycle**: `llm_output` + `tool_use` + `tool_result` + `agent_end` capture the full step context for SCOPE analysis.
- **Bootstrap files still work**: Strategic rules *could* additionally be written to `AGENTS.md` for persistence across restarts.

### Guideline types

| Type | Scope | Persistence | Injection | Priority |
|------|-------|-------------|-----------|----------|
| **Strategic** | Cross-task | Saved to disk | Loaded on startup + periodic refresh | Highest |
| **Seed** | Baseline | Loaded from file | Always injected | Medium |
| **Tactical** | Current task | In-memory only | Cleared on session switch | Lowest (most recent wins) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/rules/{agent_name}` | Get strategic rules for an agent |
| `GET` | `/stats/{agent_name}` | Get observability metrics |
| `POST` | `/step` | Report a completed step for SCOPE analysis |
| `POST` | `/reset` | Reset tactical state for a task/session |
| `POST` | `/feedback` | Submit user feedback on a guideline |

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
