<div align="center">
  <img src="asserts/evolveclaw.png" alt="EvolveClaw Logo" width="500">

  <h2>A self-evolving, personalized OpenClaw</h2>
  <h3>The more you use it, the better it understands you.</h3>
</div>

<p align="center">
  <a href="https://github.com/JarvisPei/SCOPE"><img src="https://img.shields.io/badge/Powered_by-SCOPE-red?style=flat-square" alt="SCOPE" /></a>
  <a href="https://github.com/openclaw/openclaw"><img src="https://img.shields.io/badge/Built_for-OpenClaw-blue?style=flat-square" alt="OpenClaw" /></a>
  <img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License: MIT">
</p>

---

## 📰 News

- **[2026/03]** 🔥 Added **custom SCOPE prompts & domains** tailored for personal AI assistants — user preference learning, code quality analysis, and communication style optimization!
- **[2026/03]** 🚀 **EvolveClaw v1 released!** Self-evolving prompt system for OpenClaw with zero code modification — plugin + sidecar architecture powered by [SCOPE](https://github.com/JarvisPei/SCOPE).

---

EvolveClaw turns [OpenClaw](https://github.com/openclaw/openclaw) into a **self-improving agent** that continuously adapts to *your* workflows. Powered by [SCOPE](https://github.com/JarvisPei/SCOPE) (Self-evolving Context Optimization via Prompt Evolution), it observes how you interact with the agent — your tasks, your tool usage patterns, your preferences — and **automatically evolves the system prompt** with personalized guidelines that make the agent increasingly effective for *you*, not just any user.

No two EvolveClaw instances are the same. Over time, each one develops a unique personality shaped by its owner's habits.

**Key adaptation**: SCOPE was originally designed for task-specific benchmarks (e.g., HLE). EvolveClaw extends it with **custom prompt templates and domain categories** tailored for a personal AI coding assistant — focusing on user preference learning, code quality, communication style, and workflow patterns instead of domain-specific problem-solving heuristics.

## 💡 Why EvolveClaw?

Today's AI coding agents ship with a static system prompt — every user gets the same instructions. But users are different: some prefer terse answers, others want detailed explanations; some rely heavily on search tools, others write code directly; some work on frontends, others on distributed systems.

EvolveClaw closes this gap with three core ideas:

| Principle | What It Means |
|-----------|--------------|
| **Self-Evolving** | The agent synthesizes behavioral guidelines from its own execution traces. No manual prompt engineering needed — the system prompt improves itself. |
| **Personalized** | Guidelines are derived from *your* interactions — your tasks, your tool usage patterns. The agent adapts to how *you* work, not a generic user profile. |
| **Dual Memory** | Strategic guidelines persist across sessions (your agent's personality); tactical guidelines are ephemeral and auto-clear per task. |

## ⚙️ How It Works

<p align="center">
  <img src="asserts/framework.png" alt="EvolveClaw Framework" width="700">
</p>

1. **Observe** — The plugin captures your full interaction trace: model output, tool calls, tool results, errors, and the semantic nature of your task
2. **Learn** — SCOPE analyzes each trace and synthesizes a guideline if warranted — e.g., *"When this user asks for refactoring, prefer small atomic commits over large rewrites"*
3. **Classify** — Each guideline is classified as **tactical** (task-specific, ephemeral) or **strategic** (cross-task, persisted to disk as part of your personal memory)
4. **Inject** — On the next turn, all active guidelines are injected into the system prompt, structured by priority (strategic > tactical)
5. **Forget** — When you start a new session, tactical guidelines are cleared. The agent remembers *who you are* (strategic), not *what you were doing yesterday* (tactical)

This creates a **virtuous cycle**: the more you use the agent, the better it understands your preferences, and the more personalized its behavior becomes.

## 🧬 What Makes It Self-Evolving

Unlike static prompt engineering or manual rule files, EvolveClaw implements a **self-improvement loop** with the following components:

### 🎯 Personalized Learning Signal
- **Rich execution traces**: Captures model output, tool calls (`before_tool_call`), tool results (`after_tool_call`), and errors — learning from the full behavioral footprint, not just text
- **Task description**: The user's last message is extracted and passed to SCOPE for per-task guideline management

### 🧠 Adaptive Memory
- **Strategic memory** — Cross-task guidelines that persist to disk. Loaded on startup
- **Tactical memory** — Task-specific guidelines that live in-memory and auto-clear on session switch
- **Automatic memory optimization** — When strategic rules accumulate past the domain limit, SCOPE's `MemoryOptimizer` automatically consolidates similar rules, prunes rules subsumed by more general ones, and resolves conflicts — all via LLM-driven analysis, not simple truncation
- **Plugin-side guideline cap** — The plugin enforces a maximum guideline count in memory; oldest tactical guidelines are evicted first when the cap is reached

### 🎨 Custom SCOPE Prompts & Domains

SCOPE's built-in prompts are designed for task-specific benchmarks. EvolveClaw overrides them via SCOPE's `custom_prompts` and `custom_domains` API (`server/prompts.py`) to focus on personal assistant concerns:

| Domain | What It Captures |
|--------|-----------------|
| `tool_usage` | IDE/shell tool patterns — file ops, search, terminal commands |
| `code_quality` | Code generation patterns, style, correctness, testing |
| `error_handling` | Safe operations, rollback strategies, error recovery |
| `communication` | Response style, conciseness, explanation depth |
| `user_preferences` | Learned user habits — coding style, frameworks, conventions |
| `context_awareness` | Project structure knowledge, conversation history |
| `workflow` | Multi-step task planning, edit-test cycles |
| `general` | Catch-all for uncategorized rules |

The `user_preferences` domain is particularly important: when the analyzer detects consistent user habits (e.g., "always uses TypeScript", "prefers concise responses"), these are classified as **strategic** and persist across sessions — so the assistant remembers your preferences permanently.

### 🔇 Sub-Agent Filtering

OpenClaw internally spawns sub-agents (file search, code lookup, etc.) that use minimal system prompts. EvolveClaw filters these out — only the main user-facing session generates guidelines. Sub-agent sessions are detected by the `"subagent:"` prefix in the session key and silently skipped across all hooks.

### 💉 Injection Modes
- **`append_system`** (default) — Guidelines are appended to the system prompt, which LLM providers typically cache for token efficiency
- **`prepend_context`** — Guidelines are prepended to the per-turn context, sent fresh each turn

### 📊 Observability
- **Periodic logging** — The plugin logs guideline distribution by type every 5 steps
- **Stats endpoint** — `GET /stats/{agent_name}` returns strategic count, total steps, synthesis rate, and uptime

## 📋 TODOs and Known Limitations

- [ ] **Feedback loop** — No auto-feedback from the plugin (OpenClaw has no `user_feedback` hook). Could be added once SCOPE supports guideline removal or OpenClaw adds a feedback hook.

## 🏗️ Architecture

```
evolveclaw/
├── plugin/                    # OpenClaw TypeScript plugin
│   ├── src/
│   │   ├── index.ts           # Plugin entry: lifecycle hooks, guideline management
│   │   ├── scope-client.ts    # HTTP client for SCOPE sidecar
│   │   └── types.ts           # Shared type definitions (config, API, guideline metadata)
│   ├── package.json
│   └── openclaw.plugin.json   # Plugin manifest with config schema
├── server/                    # SCOPE sidecar HTTP server (Python)
│   ├── server.py              # FastAPI server: step analysis, tactical reset, stats
│   ├── config.py              # Server configuration (env vars)
│   ├── prompts.py             # Custom SCOPE prompts & domains for personal assistant use
│   ├── requirements.txt
│   └── .env.template          # Environment variable template
└── scripts/
    ├── start-server.sh        # Start the SCOPE sidecar
    └── install-plugin.sh      # Symlink plugin into OpenClaw
```

## 🚀 Quick Start

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
          "injectMode": "append_system",
          "maxGuidelines": 30,
        }
      }
    }
  }
}
```

### 🔧 Plugin Configuration

| Config | Default | Description |
|--------|---------|-------------|
| `serverUrl` | `http://127.0.0.1:5757` | SCOPE sidecar URL |
| `agentName` | `openclaw-agent` | Agent identifier in SCOPE memory |
| `enabled` | `true` | Toggle on/off without uninstalling |
| `injectMode` | `append_system` | `append_system` (cacheable) or `prepend_context` (per-turn) |
| `maxGuidelines` | `30` | Max guidelines in memory; oldest tactical evicted first when cap is reached |

### ⚡ Server Configuration (Environment Variables)

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

## 🎯 Design Decisions

### Why self-evolving prompts (not fine-tuning)?

- **Zero training cost**: No GPU, no dataset curation — guidelines are synthesized in-context by the same LLM
- **Interpretable**: Every guideline is a human-readable sentence you can inspect, edit, or delete
- **Reversible**: Guidelines are human-readable and can be inspected or deleted; fine-tuning is a one-way door
- **Personalized at the prompt level**: Works with any base model — swap `gpt-4o` for `claude` and your guidelines carry over

### Why a sidecar server (not embedded)?

- **Language bridge**: SCOPE is Python; OpenClaw plugins are TypeScript. A sidecar avoids complex Node↔Python IPC
- **Decoupled lifecycle**: The SCOPE server can be restarted, upgraded, or swapped independently of OpenClaw
- **Graceful degradation**: If the SCOPE server is down, the plugin silently no-ops — OpenClaw keeps working normally

### Why plugin hooks (not bootstrap files)?

- **Dynamic**: `before_prompt_build` injects guidelines per-turn, not just at session start
- **System prompt space**: `appendSystemContext` places guidelines in cacheable system prompt space, reducing per-turn token cost
- **Clean lifecycle**: `llm_output` + `before_tool_call` + `after_tool_call` + `agent_end` capture the full step context for SCOPE analysis
- **Bootstrap files still work**: Strategic rules *could* additionally be written to `AGENTS.md` for persistence across restarts

### Guideline types

| Type | Scope | Persistence | Injection | Priority |
|------|-------|-------------|-----------|----------|
| **Strategic** | Cross-task | Saved to disk — your agent's evolved personality | Loaded on startup + periodic refresh | Highest |
| **Tactical** | Current task | In-memory only — ephemeral working memory | Cleared on session switch | Lowest (most recent wins) |

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/rules/{agent_name}` | Get strategic rules for an agent |
| `GET` | `/stats/{agent_name}` | Get observability metrics for self-improvement tracking |
| `POST` | `/step` | Report a completed step for SCOPE analysis |
| `POST` | `/reset` | Reset tactical state on session/task switch |

## 🔗 Related Projects

- [SCOPE](https://github.com/JarvisPei/SCOPE) — The prompt evolution framework powering EvolveClaw
- [OpenClaw](https://github.com/openclaw/openclaw) — The AI agent platform

## 📖 Citation

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

## ⚖️ License

MIT
