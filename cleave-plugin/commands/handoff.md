# /handoff

Force an immediate session handoff. Stop all productive work right now and execute the full cleave handoff procedure.

## Instructions

1. Read the session-relay skill instructions (invoke the `session-relay` skill if not already active)
2. Immediately begin the 4-step handoff procedure:
   - Update `.cleave/PROGRESS.md` with current status and exact stop point
   - Update `.cleave/KNOWLEDGE.md` — promote insights to Core, append session notes
   - Write `.cleave/NEXT_PROMPT.md` — complete continuation prompt for next session
   - Print `RELAY_HANDOFF_COMPLETE` and stop
3. Do NOT do any more productive work before the handoff

This command exists for when you need to force a handoff before the natural 60% context threshold — for example, if you're stuck, if priorities changed, or if the user wants to restart with a modified approach.
