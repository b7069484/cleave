# /continue

Continue a completed cleave relay with a new task. This is for when the previous relay finished (STATUS: ALL_COMPLETE) and you want to start a new task that builds on the same knowledge base.

## Instructions

1. **Verify completion** — Read `.cleave/PROGRESS.md` and confirm STATUS is `ALL_COMPLETE`. If the task is still `IN_PROGRESS`, suggest using `/resume` instead.

2. **Archive the completed session:**
   - Read `.cleave/PROGRESS.md` and note the final session number
   - Copy `.cleave/PROGRESS.md` to `.cleave/logs/session_N_progress.md` (where N is the final session number)
   - Copy `.cleave/NEXT_PROMPT.md` to `.cleave/logs/session_N_next_prompt.md` (if it exists)

3. **Accept the new task:**
   - Ask the user: "What would you like to work on next?" (if no task was provided inline)
   - If the user provided a task inline with `/continue`, use that as the new task

4. **Reset relay state:**
   - Write a new `.cleave/PROGRESS.md`:
     ```markdown
     # Cleave Progress Report

     **STATUS:** IN_PROGRESS
     **Session:** #1 (new task)
     **Timestamp:** [current time]
     **Continued from:** Previous task completed at session #N

     ## New Task
     [The user's new task description]

     ## Accomplished This Session
     - (starting fresh)

     ## Stopped At
     - Beginning of new task
     ```
   - Write `.cleave/NEXT_PROMPT.md` with the new task prompt, referencing existing KNOWLEDGE.md
   - Touch `.cleave/.active_relay` to ensure hooks are active

5. **Preserve knowledge:**
   - Do NOT clear or reset `.cleave/KNOWLEDGE.md` — the accumulated knowledge carries forward
   - Add a note to the Session Log: `### New Task — [date]\n- Continued from completed task\n- New objective: [brief description]`

6. **Activate the session-relay skill** and begin working on the new task.

This command maps to `cleave continue` in the SDK edition. It preserves knowledge while starting a fresh task chain.
