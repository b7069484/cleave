# /resume

Resume a cleave relay task from the last handoff point. Read the continuation files and pick up where the previous session left off.

## Instructions

1. **Read the handoff files** in this order:
   a. `.cleave/KNOWLEDGE.md` — Read the full file. Pay special attention to `## Core Knowledge` for permanent insights and recent `## Session Log` entries for context.
   b. `.cleave/PROGRESS.md` — Understand what was accomplished and exactly where the task stopped.
   c. `.cleave/NEXT_PROMPT.md` — This is your primary instruction set. It was written by the previous session with full context of the task.

2. **If `.cleave/NEXT_PROMPT.md` exists:** Follow its instructions as your primary task. It contains the full task context, resume point, and everything you need.

3. **If `.cleave/NEXT_PROMPT.md` does NOT exist:** Report that no handoff prompt was found. Suggest the user either:
   - Provide a fresh prompt to start/restart the task
   - Check `.cleave/PROGRESS.md` for the last known state

4. **Activate the session-relay skill** so the handoff protocol is active for this session.

5. **Begin productive work** from the exact point specified in the handoff files.

Remember: You are in a cleave relay session. Monitor your context usage and execute the handoff procedure at ~60% context. Read the session-relay skill for full details.
