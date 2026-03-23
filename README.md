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
    Strategic Memory (disk)
```

1. **`before_prompt_build`** — The plugin injects accumulated SCOPE guidelines into the system prompt via `appendSystemContext`
2. **`llm_output`** — The plugin captures the model's response
3. **`agent_end`** — The plugin sends the step context to the SCOPE server for analysis
4. **SCOPE synthesizes** a new guideline (if warranted) → classified as tactical (task-specific) or strategic (cross-task, persisted)
5. **Next turn** — The new guideline is injected into the prompt, improving the agent's behavior

Over time, the agent accumulates a library of learned guidelines that make it increasingly effective for the user's specific workflows.

## Architecture

```
evolveclaw/
├── plugin/                    # OpenClaw TypeScript plugin
│   ├── src/
│   │   ├── index.ts           # Plugin entry: registers lifecycle hooks
│   │   ├── scope-client.ts    # HTTP client for SCOPE sidecar
│   │   └── types.ts           # Shared type definitions
│   ├── package.json
│   └── openclaw.plugin.json   # Plugin manifest
├── server/                    # SCOPE sidecar HTTP server (Python)
│   ├── server.py              # FastAPI server wrapping SCOPEOptimizer
│   ├── config.py              # Server configuration
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
          "injectMode": "append_system"
        }
      }
    }
  }
}
```

| Config | Default | Description |
|--------|---------|-------------|
| `serverUrl` | `http://127.0.0.1:5757` | SCOPE sidecar URL |
| `agentName` | `openclaw-agent` | Agent identifier in SCOPE memory |
| `enabled` | `true` | Toggle on/off without uninstalling |
| `injectMode` | `append_system` | `append_system` (cacheable), `prepend_context` (per-turn), or `both` |

## Design Decisions

### Why a sidecar server (not embedded)?

- **Language bridge**: SCOPE is Python; OpenClaw plugins are TypeScript. A sidecar avoids complex Node↔Python IPC.
- **Decoupled lifecycle**: The SCOPE server can be restarted, upgraded, or swapped independently of OpenClaw.
- **Graceful degradation**: If the SCOPE server is down, the plugin silently no-ops — OpenClaw keeps working normally.
### Why plugin hooks (not bootstrap files)?

- **Dynamic**: `before_prompt_build` injects guidelines per-turn, not just at session start.
- **System prompt space**: `appendSystemContext` places guidelines in cacheable system prompt space, reducing per-turn token cost.
- **Clean lifecycle**: `llm_output` + `agent_end` capture the full step context for SCOPE analysis.
- **Bootstrap files still work**: Strategic rules *could* additionally be written to `AGENTS.md` for persistence across restarts.

### Guideline types

| Type | Scope | Persistence | Injection |
|------|-------|-------------|-----------|
| **Tactical** | Current task | In-memory only | Appended to system prompt during task |
| **Strategic** | Cross-task | Saved to disk | Loaded on startup, always injected |

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
