"""
EvolveClaw prompt templates for SCOPE integration.

These prompts are tailored for a personal AI assistant (OpenClaw),
focusing on user interaction quality, task execution best practices, and tool
usage patterns — as opposed to SCOPE's default prompts which target
task-specific problem-solving (e.g., HLE benchmarks).

All templates use the same format placeholders as SCOPE's built-in prompts
so they can be passed directly via ``custom_prompts``.
"""

# =============================================================================
# GUIDELINE SYNTHESIS PROMPTS
# =============================================================================

ERROR_REFLECTION_PROMPT = """You are analyzing an AI assistant's execution error to improve its system prompt.

Your task: Generate a SHORT, TARGETED system prompt addition (1-3 lines) that will help prevent this type of error in future interactions.

Context:
- Agent Name: {agent_name}
- Agent Role: {agent_role}
- User Request: {task}
- Error Type: {error_type}
- Error Message: {error_message}

Actions taken before the error:
{last_step_summary}

Current system prompt (for reference, to avoid duplication):
{current_system_prompt}

Already applied rules (DO NOT duplicate these):
{applied_rules}

Focus areas:
1. Did the assistant misuse a tool (wrong arguments, missing validation)?
2. Did it make incorrect assumptions about the user's environment or context?
3. Did it fail to handle edge cases in tool usage, file operations, or task execution?
4. Did it break the user's workflow by taking destructive or incorrect actions?

Guidelines:
- Be SPECIFIC and ACTIONABLE — target the exact error cause
- Be BRIEF — max 1-3 lines
- Use imperative language ("Always...", "Never...", "Before X, verify Y...")
- Don't repeat what's already in the current system prompt
- Focus on patterns that generalize across similar user interactions

Output ONLY valid JSON with this exact format:
{{
  "update_text": "The actual prompt addition text here",
  "rationale": "Brief 1-sentence why this helps",
  "confidence": "low|medium|high"
}}"""


QUALITY_REFLECTION_PROMPT_EFFICIENCY = """You are analyzing an AI assistant's response quality.

Your task: Identify actionable improvements in how the assistant interacted with the user. If found, generate a SHORT, TARGETED system prompt addition (1-3 lines).

Context:
- Agent Name: {agent_name}
- Agent Role: {agent_role}
- User Request: {task}

Interaction details:
{last_step_summary}

Current system prompt (for reference):
{current_system_prompt}

Already applied rules (DO NOT duplicate these):
{applied_rules}

Analyze for:
1. **Response relevance**: Did it address the user's actual intent, or over/under-interpret?
2. **Tool efficiency**: Unnecessary tool calls, redundant file reads, or missing tool usage?
3. **Output quality**: Generated content with errors, missing context, or poor patterns?
4. **Communication**: Was the response clear, appropriately concise, and well-structured?
5. **User preferences**: Did the user express or imply a preference (coding style, framework, verbosity) that should be remembered for future sessions?

Guidelines:
- Only suggest if there's a CLEAR, ACTIONABLE improvement
- Be SPECIFIC about what to improve
- Be BRIEF — max 1-3 lines
- Use imperative language ("Always...", "Prefer...", "When X, do Y...")
- Don't repeat what's already in the current system prompt

Output ONLY valid JSON with this exact format:
{{
  "update_text": "The actual prompt addition text here (or empty string if no improvement needed)",
  "rationale": "Brief 1-sentence why this helps (or 'No improvement needed')",
  "confidence": "low|medium|high"
}}"""


QUALITY_REFLECTION_PROMPT_THOROUGHNESS = """You are analyzing an AI assistant's response quality in depth.

Your task: Identify actionable improvements in how the assistant handled this interaction. If found, generate a SHORT, TARGETED system prompt addition (1-3 lines).

Context:
- Agent Name: {agent_name}
- Agent Role: {agent_role}
- User Request: {task}

Interaction details:
{last_step_summary}

Current system prompt (for reference):
{current_system_prompt}

Already applied rules (DO NOT duplicate these):
{applied_rules}

Analyze for improvements across these dimensions:

1. **User Intent Understanding**:
   - Did the assistant correctly interpret what the user wanted?
   - Did it ask for clarification when the request was ambiguous?
   - Did it over-engineer or under-deliver relative to the request scope?
   Examples: "Ask for clarification when multiple interpretations exist", "Match response depth to request complexity"

2. **Output & Execution Quality**:
   - Is generated content (code, text, analysis) correct and following conventions?
   - Are edge cases handled? Are assumptions validated?
   - Does the output match the user's context and expectations?
   Examples: "Include error handling for file I/O", "Match existing style", "Verify assumptions before acting"

3. **Tool Usage Patterns**:
   - Are tools used efficiently (batch reads, targeted searches)?
   - Are destructive operations (file writes, shell commands) validated first?
   - Is context gathered before making changes (read before edit)?
   Examples: "Read file before editing to verify current state", "Use targeted grep instead of reading entire files"

4. **Conversation Quality**:
   - Is the response appropriately concise vs. detailed for the context?
   - Does it explain the *why* behind changes, not just the *what*?
   - Does it proactively flag potential issues or side effects?
   Examples: "Explain trade-offs when suggesting architectural changes", "Flag breaking changes explicitly"

5. **User Preferences & Habits**:
   - Did the user express or imply a preference (coding style, verbosity, framework choice)?
   - Did the user correct the assistant's approach — indicating a preferred way of doing things?
   - Are there recurring patterns in how the user works (e.g., always uses functional style, prefers short answers, writes tests first)?
   - Would capturing this preference help future interactions across sessions?
   Examples: "User prefers TypeScript over JavaScript — default to .ts files", "User wants concise responses without step-by-step narration", "User always uses Poetry for Python projects"
   NOTE: Preferences that appear consistent (not one-off) should be classified as STRATEGIC with domain "user_preferences".

6. **Safety & Correctness**:
   - Are changes reversible or clearly flagged as destructive?
   - Are assumptions about the codebase validated before acting?
   - Is testing or verification suggested for non-trivial changes?
   Examples: "Suggest running tests after refactoring", "Warn before deleting files"

7. **Context Awareness**:
   - Does the assistant remember and build on earlier conversation context?
   - Does it avoid repeating information already provided?
   - Does it leverage project structure knowledge effectively?
   Examples: "Reference prior decisions in the conversation", "Use project-specific patterns observed earlier"

Guidelines:
- PRIORITIZE user satisfaction and code correctness
- Only suggest if there's a CLEAR, ACTIONABLE, GENERALIZABLE improvement
- Be SPECIFIC — include concrete patterns, not vague advice
  Good: "When editing TypeScript files, verify tsconfig paths before adding new imports"
  Bad: "Be more careful with imports"
- Be BRIEF — max 1-3 lines
- Use imperative language ("Always...", "Prefer...", "When X, do Y...")
- Don't repeat what's already in the current system prompt
- Look for PATTERNS that generalize across similar user interactions

Output ONLY valid JSON with this exact format:
{{
  "update_text": "The actual prompt addition text here (or empty string if no improvement needed)",
  "rationale": "Brief 1-sentence why this helps (or 'No improvement needed')",
  "confidence": "low|medium|high"
}}"""


# =============================================================================
# CLASSIFICATION PROMPT (override for personal-assistant domains)
# =============================================================================

CLASSIFICATION_PROMPT = """You are a rule classifier for an AI assistant. Analyze the proposed update and determine:

1. **Is it a DUPLICATE/REDUNDANT?** Check if it's already covered by existing strategic or tactical rules.
2. **What is its SCOPE?**
   - STRATEGIC: General best practice OR consistent user preference applicable across sessions (e.g., "Always read a file before editing it", "User prefers concise responses without step-by-step narration", "Default to detailed explanations for complex topics")
   - TACTICAL: Session-specific observation for current interaction only (e.g., "This project uses Poetry instead of pip", "Current task requires a formal tone")
   NOTE: User preferences that reflect consistent habits (not one-off requests) should be STRATEGIC with domain "user_preferences".
3. **Refined CONFIDENCE**: Assess confidence (0.0-1.0) based on how actionable and broadly useful this rule is.
4. **DOMAIN**: If strategic, you MUST categorize it into ONE of the following allowed domains: {allowed_domains}

=== PROPOSED UPDATE ===
Update: {update_text}
Rationale: {rationale}
Initial Confidence: {initial_confidence:.2f}

{all_rules_context}

=== YOUR ANALYSIS ===
Respond in JSON format:
{{
    "is_duplicate": true/false,
    "scope": "strategic" or "tactical",
    "confidence": 0.0-1.0,
    "domain": "domain_name" (only if scope is strategic, otherwise ""),
    "reason": "Brief explanation of your classification"
}}

Think step by step:
1. Check if the proposed update is already covered by existing rules (exact match or semantic similarity)
2. Determine if it's a general best practice (strategic) or session-specific (tactical)
3. Assess the confidence based on clarity, actionability, and usefulness
4. If strategic, assign appropriate domain

JSON Response:"""


# =============================================================================
# DOMAIN DEFINITIONS
# =============================================================================

EVOLVECLAW_DOMAINS = [
    "tool_usage",           # How to use tools correctly (file ops, search, terminal, browser)
    "code_quality",         # Code/content generation patterns, style, correctness
    "error_handling",       # Recovering from errors, safe operations, rollback strategies
    "communication",        # Response style, conciseness, explanation depth, user interaction
    "user_preferences",     # Learned user habits: style, frameworks, conventions, workflow preferences
    "context_awareness",    # Leveraging project structure, conversation history, domain knowledge
    "workflow",             # Multi-step task planning, edit-test cycles, process management
    "general",              # Catch-all for high-quality, uncategorized rules
]


def get_custom_prompts() -> dict:
    """Return the prompt override dict for SCOPEOptimizer(custom_prompts=...)."""
    return {
        "error_reflection": ERROR_REFLECTION_PROMPT,
        "quality_reflection_efficiency": QUALITY_REFLECTION_PROMPT_EFFICIENCY,
        "quality_reflection_thoroughness": QUALITY_REFLECTION_PROMPT_THOROUGHNESS,
        "classification": CLASSIFICATION_PROMPT,
    }
