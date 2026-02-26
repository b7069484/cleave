# /status

Show the current cleave relay status — progress, knowledge base size, and session information.

## Instructions

Read and display the following information:

1. **Progress Report** — Read `.cleave/PROGRESS.md` and display:
   - Current STATUS (IN_PROGRESS or ALL_COMPLETE)
   - Session number
   - What was accomplished
   - Where the task stopped
   - Overall progress (X of Y items)

2. **Knowledge Base** — Read `.cleave/KNOWLEDGE.md` and report:
   - Number of Core Knowledge entries
   - Number of Session Log entries
   - Total file size

3. **Session History** — Check `.cleave/logs/` directory:
   - List session numbers with prompt/progress file sizes
   - Show the relay.log last 10 lines

4. **Machine Status** — Read `.cleave/status.json` if it exists:
   - Current status field
   - Last updated timestamp

Format the output as a clear, concise status dashboard. If any files don't exist yet, note that the relay hasn't started or those files haven't been created.
