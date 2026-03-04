import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { resolve } from 'node:path';
import { App } from './tui/App.js';
import { DEFAULT_CONFIG } from './relay/config.js';
/**
 * Push cursor to bottom of terminal before rendering TUI.
 * This makes the TUI start at the bottom and scroll upward (like Claude Code).
 */
function anchorToBottom() {
    const rows = process.stdout.rows || 24;
    process.stdout.write('\n'.repeat(rows));
}
export function createCli() {
    const program = new Command()
        .name('cleave')
        .description('Infinite context for Claude Code — autonomous session relay with real-time TUI')
        .version('6.3.0');
    // Default command: interactive startup wizard
    program
        .command('start', { isDefault: true })
        .description('Interactive setup — asks about project, task, config, then starts relay')
        .option('-d, --dir <path>', 'Project directory (skips folder question)')
        .action(async (opts) => {
        const { StartupApp } = await import('./tui/StartupApp.js');
        anchorToBottom();
        const { waitUntilExit } = render(React.createElement(StartupApp, {
            initialDir: opts.dir ? resolve(opts.dir) : undefined,
        }));
        await waitUntilExit();
    });
    program
        .command('run')
        .description('Start a relay task (guided mode by default)')
        .argument('<task>', 'The task description for Claude')
        .option('-s, --sessions <n>', 'Maximum number of sessions', String(DEFAULT_CONFIG.maxSessions))
        .option('-b, --budget <n>', 'Per-session budget in USD', String(DEFAULT_CONFIG.sessionBudget))
        .option('-d, --dir <path>', 'Project directory', process.cwd())
        .option('-m, --model <model>', 'Model to use (e.g., sonnet, opus)')
        .option('--auto', 'Auto mode — no pause between sessions', false)
        .option('--headless', 'Headless mode — no TUI, just log output', false)
        .option('--skip-permissions', 'Skip permission prompts (use with caution)', false)
        .option('--allowed-tools <tools...>', 'Tools to allow without prompting')
        .action(async (task, opts) => {
        let mode = 'guided';
        if (opts.headless)
            mode = 'headless';
        else if (opts.auto)
            mode = 'auto';
        const config = {
            projectDir: resolve(opts.dir),
            initialTask: task,
            maxSessions: parseInt(opts.sessions, 10),
            sessionBudget: parseFloat(opts.budget),
            mode,
            model: opts.model,
            skipPermissions: opts.skipPermissions,
            allowedTools: opts.allowedTools,
            maxSessionLogEntries: DEFAULT_CONFIG.maxSessionLogEntries,
        };
        if (mode === 'headless') {
            // Headless: no TUI, run relay directly with console logging
            const { RelayLoop } = await import('./relay/loop.js');
            const loop = new RelayLoop(config);
            loop.on('session_start', ({ sessionNum, maxSessions }) => {
                console.log(`\n--- Session ${sessionNum}/${maxSessions} ---`);
            });
            loop.on('session_end', ({ sessionNum }) => {
                console.log(`--- Session ${sessionNum} complete ---`);
            });
            loop.on('rescue', () => {
                console.log('--- Rescue handoff ---');
            });
            const result = await loop.run();
            console.log(`\nRelay ${result.completed ? 'COMPLETE' : 'ended'}: ${result.sessionsRun} sessions, $${result.totalCostUsd.toFixed(2)} total`);
            process.exit(result.completed ? 0 : 1);
        }
        else {
            anchorToBottom();
            const { waitUntilExit } = render(React.createElement(App, { config }));
            await waitUntilExit();
        }
    });
    program
        .command('resume')
        .description('Resume the most recent relay in this directory')
        .option('-d, --dir <path>', 'Project directory', process.cwd())
        .option('-s, --sessions <n>', 'Additional sessions to run', String(DEFAULT_CONFIG.maxSessions))
        .option('-b, --budget <n>', 'Per-session budget in USD', String(DEFAULT_CONFIG.sessionBudget))
        .option('-m, --model <model>', 'Model to use')
        .option('--auto', 'Auto mode — no pause between sessions', false)
        .option('--skip-permissions', 'Skip permission prompts', false)
        .action(async (opts) => {
        const projectDir = resolve(opts.dir);
        const { CleaveState } = await import('./state/files.js');
        const state = new CleaveState(projectDir);
        const nextPrompt = await state.readNextPrompt();
        if (!nextPrompt.trim()) {
            console.error('No relay state found in', projectDir);
            process.exit(1);
        }
        // Read persisted limits (from dynamic adjustment), CLI flags override
        const persistedMaxSessions = await state.getMaxSessions();
        const persistedSessionBudget = await state.getSessionBudget();
        const cliSessions = parseInt(opts.sessions, 10);
        const cliBudget = parseFloat(opts.budget);
        // Use persisted value if CLI flag is the default (user didn't explicitly set it)
        const defaultMax = DEFAULT_CONFIG.maxSessions;
        const defaultBudget = DEFAULT_CONFIG.sessionBudget;
        const config = {
            projectDir,
            initialTask: nextPrompt,
            maxSessions: cliSessions !== defaultMax ? cliSessions : (persistedMaxSessions ?? defaultMax),
            sessionBudget: cliBudget !== defaultBudget ? cliBudget : (persistedSessionBudget ?? defaultBudget),
            mode: opts.auto ? 'auto' : 'guided',
            model: opts.model,
            skipPermissions: opts.skipPermissions,
            maxSessionLogEntries: 5,
        };
        anchorToBottom();
        const { waitUntilExit } = render(React.createElement(App, { config }));
        await waitUntilExit();
    });
    program
        .command('status')
        .description('Show relay status for this directory')
        .option('-d, --dir <path>', 'Project directory', process.cwd())
        .action(async (opts) => {
        const { CleaveState } = await import('./state/files.js');
        const state = new CleaveState(resolve(opts.dir));
        const count = await state.getSessionCount();
        const progress = await state.readProgress();
        const signal = await state.readHandoffSignal();
        console.log(`Sessions completed: ${count}`);
        console.log(`Handoff signal: ${signal ?? 'none'}`);
        if (progress.trim()) {
            console.log(`\nProgress:\n${progress}`);
        }
    });
    return program;
}
//# sourceMappingURL=cli.js.map