import { EventEmitter } from 'node:events';
import { execSync, execFileSync } from 'node:child_process';
import { SessionRunner } from './session.js';
import { CleaveState } from '../state/files.js';
import { detectHandoff, generateRescueHandoff } from './handoff.js';
import { buildSessionPrompt, buildHandoffInstructions } from './prompt-builder.js';
import { compactKnowledge } from '../state/knowledge.js';
import { collectToolStats, buildDebriefPrompt } from './debrief.js';
export class RelayLoop extends EventEmitter {
    config;
    state;
    transitionResolver = null;
    allToolEvents = [];
    sessionErrors = [];
    consecutiveFailures = 0;
    initialCommitHash = '';
    constructor(config) {
        super();
        this.config = config;
        this.state = new CleaveState(config.projectDir);
    }
    /**
     * Called by the TUI when the user advances from the transition screen.
     * @param userInput Optional instructions to inject into the next session
     */
    resolveTransition(userInput) {
        if (this.transitionResolver) {
            this.transitionResolver(userInput);
            this.transitionResolver = null;
        }
    }
    /**
     * Dynamically update the max sessions limit. Takes effect on the next loop iteration.
     * Persists to disk so `cleave resume` picks it up.
     */
    updateMaxSessions(n) {
        this.config.maxSessions = n;
        this.state.setMaxSessions(n);
        this.emit('config_change', { maxSessions: n, sessionBudget: this.config.sessionBudget });
    }
    /**
     * Dynamically update the per-session budget. Takes effect on the next session spawn.
     * Persists to disk so `cleave resume` picks it up.
     */
    updateSessionBudget(n) {
        this.config.sessionBudget = n;
        this.state.setSessionBudget(n);
        this.emit('config_change', { maxSessions: this.config.maxSessions, sessionBudget: n });
    }
    async waitForTransition() {
        if (this.config.mode === 'auto' || this.config.mode === 'headless') {
            // Auto/headless: no pause, continue immediately
            return undefined;
        }
        // Guided mode: wait for TUI to call resolveTransition
        return new Promise((resolve) => {
            this.transitionResolver = resolve;
        });
    }
    async runDebrief(sessionsRun, totalCost, totalDuration) {
        this.emit('debrief_start');
        let filesChanged = [];
        if (this.initialCommitHash) {
            try {
                const diff = execFileSync('git', ['diff', '--name-only', this.initialCommitHash], {
                    cwd: this.config.projectDir,
                    encoding: 'utf-8',
                });
                filesChanged = diff.trim().split('\n').filter(Boolean);
            }
            catch { /* ok */ }
        }
        const { tools, skills } = collectToolStats(this.allToolEvents);
        const ctx = {
            sessionsRun,
            totalCostUsd: totalCost,
            totalDurationMs: totalDuration,
            toolStats: tools,
            skills,
            filesChanged,
            errors: this.sessionErrors,
            finalProgress: await this.state.readProgress(),
            finalKnowledge: await this.state.readKnowledge(),
            projectDir: this.config.projectDir,
        };
        const debriefPrompt = buildDebriefPrompt(ctx);
        const runner = new SessionRunner({
            projectDir: this.config.projectDir,
            prompt: debriefPrompt,
            handoffInstructions: '',
            budget: 1.0,
            model: this.config.model,
            skipPermissions: this.config.skipPermissions,
        });
        runner.on('event', (event) => {
            this.emit('event', event);
        });
        try {
            await runner.run();
        }
        catch {
            // Debrief failure is non-fatal
        }
        this.emit('debrief_end');
    }
    async run() {
        await this.state.init();
        try {
            this.initialCommitHash = execSync('git rev-parse HEAD', { cwd: this.config.projectDir, encoding: 'utf-8' }).trim();
        }
        catch { /* not a git repo */ }
        let sessionsRun = 0;
        let totalCost = 0;
        let totalDuration = 0;
        // Outer loop allows continuation after max sessions or completion
        while (true) {
            while (sessionsRun < this.config.maxSessions) {
                sessionsRun++;
                const i = sessionsRun;
                await this.state.setSessionCount(i);
                await this.state.clearHandoffSignal();
                await this.state.markSessionStart();
                // Compact knowledge before each session
                const rawKnowledge = await this.state.readKnowledge();
                if (rawKnowledge.trim()) {
                    const compacted = compactKnowledge(rawKnowledge, this.config.maxSessionLogEntries);
                    await this.state.writeKnowledge(compacted);
                }
                // Build the prompt
                const prompt = buildSessionPrompt({
                    sessionNum: i,
                    maxSessions: this.config.maxSessions,
                    initialTask: this.config.initialTask,
                    nextPrompt: await this.state.readNextPrompt(),
                    knowledge: await this.state.readKnowledge(),
                    progress: await this.state.readProgress(),
                });
                // Run the session
                const runner = new SessionRunner({
                    projectDir: this.config.projectDir,
                    prompt,
                    handoffInstructions: buildHandoffInstructions(this.config.projectDir),
                    budget: this.config.sessionBudget,
                    model: this.config.model,
                    verbose: this.config.verbose,
                    skipPermissions: this.config.skipPermissions,
                    allowedTools: this.config.allowedTools,
                });
                // Forward events from session to relay
                runner.on('event', (event) => {
                    this.emit('event', event);
                    if (event.kind === 'tool_start') {
                        this.allToolEvents.push(event);
                    }
                });
                this.emit('session_start', { sessionNum: i, maxSessions: this.config.maxSessions });
                let sessionResult;
                try {
                    sessionResult = await runner.run();
                    this.consecutiveFailures = 0; // Reset on success
                }
                catch (err) {
                    this.consecutiveFailures++;
                    this.sessionErrors.push({ sessionNum: i, message: String(err) });
                    this.emit('session_error', { sessionNum: i, error: err });
                    // Abort relay after 2 consecutive failures — something is fundamentally wrong
                    if (this.consecutiveFailures >= 2) {
                        this.emit('fatal_error', {
                            message: `Relay aborted: ${this.consecutiveFailures} consecutive session failures. Last error: ${String(err)}`,
                        });
                        return {
                            sessionsRun,
                            completed: false,
                            reason: 'error',
                            totalCostUsd: totalCost,
                            totalDurationMs: totalDuration,
                        };
                    }
                    await generateRescueHandoff(this.state, i, this.config.initialTask);
                    // Emit rescue + session_end so TUI shows transition screen
                    this.emit('rescue', { sessionNum: i });
                    this.emit('session_end', { sessionNum: i, result: null, totalCost });
                    const userInput = await this.waitForTransition();
                    if (userInput) {
                        const existing = await this.state.readNextPrompt();
                        await this.state.writeNextPrompt(`## User Instructions\n${userInput}\n\n${existing}`);
                    }
                    continue;
                }
                totalCost += sessionResult.totalCostUsd || sessionResult.costUsd;
                totalDuration += sessionResult.durationMs;
                // Archive session files
                await this.state.archiveSession(i);
                // Check for handoff
                const handoff = await detectHandoff(this.state);
                if (handoff === 'complete') {
                    this.emit('session_end', { sessionNum: i, result: sessionResult, totalCost });
                    // In auto/headless mode, return immediately (no pause)
                    if (this.config.mode === 'auto' || this.config.mode === 'headless') {
                        return {
                            sessionsRun,
                            completed: true,
                            reason: 'task_complete',
                            totalCostUsd: totalCost,
                            totalDurationMs: totalDuration,
                        };
                    }
                    // Guided mode: emit completion and wait for user decision
                    this.emit('completion', {
                        reason: 'task_complete',
                        sessionsRun,
                        totalCostUsd: totalCost,
                        totalDurationMs: totalDuration,
                    });
                    const userInput = await this.waitForTransition();
                    if (!userInput) {
                        // User chose to quit
                        await this.runDebrief(sessionsRun, totalCost, totalDuration);
                        return {
                            sessionsRun,
                            completed: true,
                            reason: 'task_complete',
                            totalCostUsd: totalCost,
                            totalDurationMs: totalDuration,
                        };
                    }
                    // User provided follow-up — inject and continue
                    await this.state.clearHandoffSignal();
                    await this.state.writeNextPrompt(`## User Instructions\n${userInput}`);
                    if (sessionsRun >= this.config.maxSessions) {
                        this.updateMaxSessions(this.config.maxSessions + 1);
                    }
                    continue;
                }
                if (handoff === 'handoff' || handoff === null) {
                    if (handoff === null) {
                        // No handoff signal — generate rescue
                        this.emit('rescue', { sessionNum: i });
                        await generateRescueHandoff(this.state, i, this.config.initialTask);
                    }
                    // Don't emit transition for the last session (handled by outer loop)
                    if (i < this.config.maxSessions) {
                        this.emit('session_end', { sessionNum: i, result: sessionResult, totalCost });
                        // Wait for transition (guided mode pauses here)
                        const userInput = await this.waitForTransition();
                        if (userInput) {
                            const existing = await this.state.readNextPrompt();
                            await this.state.writeNextPrompt(`## User Instructions\n${userInput}\n\n${existing}`);
                        }
                    }
                }
            }
            // Max sessions reached
            // In auto/headless mode, return immediately
            if (this.config.mode === 'auto' || this.config.mode === 'headless') {
                return {
                    sessionsRun,
                    completed: false,
                    reason: 'max_sessions',
                    totalCostUsd: totalCost,
                    totalDurationMs: totalDuration,
                };
            }
            // Guided mode: emit completion and wait for user decision
            this.emit('completion', {
                reason: 'max_sessions',
                sessionsRun,
                totalCostUsd: totalCost,
                totalDurationMs: totalDuration,
            });
            const userInput = await this.waitForTransition();
            if (!userInput) {
                // User chose to quit
                await this.runDebrief(sessionsRun, totalCost, totalDuration);
                return {
                    sessionsRun,
                    completed: false,
                    reason: 'max_sessions',
                    totalCostUsd: totalCost,
                    totalDurationMs: totalDuration,
                };
            }
            // User provided follow-up — inject prompt and extend sessions
            await this.state.writeNextPrompt(`## User Instructions\n${userInput}`);
            if (sessionsRun >= this.config.maxSessions) {
                this.updateMaxSessions(this.config.maxSessions + 1);
            }
            // Continue outer loop — inner while will now have room
        }
    }
}
//# sourceMappingURL=loop.js.map