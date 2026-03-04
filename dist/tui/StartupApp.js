import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { App } from './App.js';
import { DEFAULT_CONFIG } from '../relay/config.js';
/**
 * Run a quick Claude call to generate clarifying questions about the task.
 * Uses claude -p with text output for simplicity.
 */
async function fetchClarifyQuestions(task, projectDir) {
    const prompt = `You are helping a user set up an autonomous multi-session coding task. They described their task as:

"${task}"

This task will be executed by Claude Code autonomously across multiple sessions. Ask 2-3 SHORT clarifying questions that would help make the task more specific and successful. Focus on:
- Ambiguous requirements that could be interpreted multiple ways
- Important constraints or preferences (language, framework, style)
- Technical choices that could go either way

Output ONLY a JSON array of question strings, nothing else. Example:
["What testing framework should be used?", "Should the API support pagination?"]`;
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        delete env.CLAUDECODE;
        const child = spawn('claude', ['-p', '--output-format', 'text'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: projectDir,
            env,
        });
        let stdout = '';
        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.on('close', () => {
            try {
                // Extract JSON array from response (Claude might wrap it in markdown)
                const match = stdout.match(/\[[\s\S]*\]/);
                if (match) {
                    const questions = JSON.parse(match[0]);
                    if (Array.isArray(questions) && questions.length > 0) {
                        resolve(questions.slice(0, 3).map(String));
                        return;
                    }
                }
                resolve([]);
            }
            catch {
                resolve([]);
            }
        });
        child.on('error', () => resolve([]));
        child.stdin.write(prompt);
        child.stdin.end();
    });
}
export function StartupApp({ initialDir }) {
    const { exit } = useApp();
    const [step, setStep] = useState(initialDir ? 'task' : 'dir');
    const [dir, setDir] = useState(initialDir ?? process.cwd());
    const [task, setTask] = useState('');
    const [sessions, setSessions] = useState(String(DEFAULT_CONFIG.maxSessions));
    const [budget, setBudget] = useState(String(DEFAULT_CONFIG.sessionBudget));
    const [mode, setMode] = useState('guided');
    const [strategy, setStrategy] = useState('execute');
    const [started, setStarted] = useState(false);
    // Clarification state
    const [clarifyQuestions, setClarifyQuestions] = useState([]);
    const [clarifyIndex, setClarifyIndex] = useState(0);
    const [clarifySkipped, setClarifySkipped] = useState(false);
    // Current input value for the active field
    const [input, setInput] = useState('');
    // Fetch clarifying questions when we enter clarify_loading
    useEffect(() => {
        if (step !== 'clarify_loading')
            return;
        let cancelled = false;
        fetchClarifyQuestions(task, dir).then(questions => {
            if (cancelled)
                return;
            if (questions.length === 0) {
                // No questions — skip clarification
                setInput('');
                setStep('sessions');
                return;
            }
            setClarifyQuestions(questions.map(q => ({ question: q, answer: '' })));
            setClarifyIndex(0);
            setInput('');
            setStep('clarify_ask');
        });
        return () => { cancelled = true; };
    }, [step, task, dir]);
    const advance = useCallback(() => {
        switch (step) {
            case 'dir':
                setDir(input || process.cwd());
                setInput('');
                setStep('task');
                break;
            case 'task':
                if (!input.trim())
                    return;
                setTask(input.trim());
                setInput('');
                setStep('strategy');
                break;
            case 'strategy':
                setInput('');
                if (strategy === 'execute') {
                    setStep('sessions');
                }
                else {
                    setStep('clarify_loading');
                }
                break;
            case 'clarify_ask': {
                // Save answer for current question
                const updated = [...clarifyQuestions];
                updated[clarifyIndex] = { ...updated[clarifyIndex], answer: input.trim() };
                setClarifyQuestions(updated);
                if (clarifyIndex < clarifyQuestions.length - 1) {
                    // Next question
                    setClarifyIndex(clarifyIndex + 1);
                    setInput('');
                }
                else {
                    // Done with questions — move to sessions
                    setInput('');
                    setStep('sessions');
                }
                break;
            }
            case 'sessions':
                setSessions(input || String(DEFAULT_CONFIG.maxSessions));
                setInput('');
                setStep('budget');
                break;
            case 'budget':
                setBudget(input || String(DEFAULT_CONFIG.sessionBudget));
                setInput('');
                setStep('mode');
                break;
            case 'mode':
                // Mode is selected via 1/2 keys, Enter confirms current selection
                setInput('');
                setStep('confirm');
                break;
            case 'confirm':
                setStarted(true);
                break;
        }
    }, [step, input, clarifyQuestions, clarifyIndex]);
    useInput(useCallback((ch, key) => {
        if (started)
            return;
        if (key.escape) {
            // In clarify step, Esc skips clarification
            if (step === 'clarify_ask' || step === 'clarify_loading') {
                setClarifySkipped(true);
                setInput('');
                setStep('sessions');
                return;
            }
            exit();
            return;
        }
        if (key.return) {
            advance();
            return;
        }
        // Ctrl+U: clear entire input line
        if (ch === '\u0015') {
            setInput('');
            return;
        }
        // Strategy selection: 1 = execute, 2 = plan
        if (step === 'strategy') {
            if (ch === '1') {
                setStrategy('execute');
                return;
            }
            if (ch === '2') {
                setStrategy('plan');
                return;
            }
            if (key.tab) {
                setStrategy(s => s === 'execute' ? 'plan' : 'execute');
                return;
            }
            return;
        }
        // Mode selection: 1 = guided, 2 = auto
        if (step === 'mode') {
            if (ch === '1') {
                setMode('guided');
                return;
            }
            if (ch === '2') {
                setMode('auto');
                return;
            }
            // Tab toggles
            if (key.tab) {
                setMode(m => m === 'guided' ? 'auto' : 'guided');
                return;
            }
            return;
        }
        if (key.backspace || ch === '\x7f') {
            setInput(v => v.slice(0, -1));
            return;
        }
        if (ch) {
            setInput(v => v + ch);
        }
    }, [started, advance, step]));
    if (started) {
        // Build enriched task with clarification answers
        let enrichedTask = task;
        const answered = clarifyQuestions.filter(q => q.answer.trim());
        if (answered.length > 0 && !clarifySkipped) {
            enrichedTask += '\n\n## Clarifications\n';
            for (const q of answered) {
                enrichedTask += `- **${q.question}** ${q.answer}\n`;
            }
        }
        const config = {
            projectDir: resolve(dir),
            initialTask: enrichedTask,
            maxSessions: parseInt(sessions, 10) || DEFAULT_CONFIG.maxSessions,
            sessionBudget: parseFloat(budget) || DEFAULT_CONFIG.sessionBudget,
            mode,
            skipPermissions: true,
            maxSessionLogEntries: DEFAULT_CONFIG.maxSessionLogEntries,
        };
        return _jsx(App, { config: config });
    }
    // Helper to check if a step is past
    const isPast = (s) => {
        const order = ['dir', 'task', 'strategy', 'clarify_loading', 'clarify_ask', 'sessions', 'budget', 'mode', 'confirm'];
        return order.indexOf(s) < order.indexOf(step);
    };
    return (_jsxs(Box, { flexDirection: "column", padding: 1, children: [_jsxs(Box, { borderStyle: "double", borderColor: "cyan", paddingX: 2, paddingY: 1, flexDirection: "column", alignItems: "center", children: [_jsx(Text, { bold: true, color: "cyan", children: "CLEAVE \u2014 Interactive Setup" }), _jsx(Text, { dimColor: true, children: "Esc to cancel \u00B7 Ctrl+U to clear" })] }), _jsx(Text, { children: " " }), _jsxs(Box, { children: [_jsxs(Text, { color: step === 'dir' ? 'cyan' : 'green', children: [step === 'dir' ? '>' : '\u2713', " Project folder:", ' '] }), step === 'dir' ? (input ? (_jsxs(Text, { children: [input, _jsx(Text, { color: "cyan", children: "|" })] })) : (_jsxs(Text, { dimColor: true, children: [process.cwd(), _jsx(Text, { color: "cyan", children: "|" })] }))) : (_jsx(Text, { bold: true, children: dir }))] }), isPast('task') || step === 'task' ? (_jsxs(Box, { children: [_jsxs(Text, { color: step === 'task' ? 'cyan' : (task ? 'green' : 'gray'), children: [step === 'task' ? '>' : (task ? '\u2713' : ' '), " Task:", ' '] }), step === 'task' ? (_jsxs(Text, { children: [input, _jsx(Text, { color: "cyan", children: "|" })] })) : (_jsx(Text, { bold: true, children: task ? task.slice(0, 60) + (task.length > 60 ? '...' : '') : '' }))] })) : null, (isPast('strategy') || step === 'strategy') && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: step === 'strategy' ? 'cyan' : 'green', children: [step === 'strategy' ? '>' : '\u2713', " Strategy:", ' ', step !== 'strategy' && _jsx(Text, { bold: true, children: strategy === 'execute' ? 'Execute immediately' : 'Plan (clarify first)' })] }), step === 'strategy' && (_jsxs(Box, { flexDirection: "column", marginLeft: 4, children: [_jsxs(Text, { color: strategy === 'execute' ? 'cyan' : 'gray', children: [strategy === 'execute' ? '\u25B6' : ' ', " [1] Execute \u2014 skip clarifying questions, start working immediately"] }), _jsxs(Text, { color: strategy === 'plan' ? 'cyan' : 'gray', children: [strategy === 'plan' ? '\u25B6' : ' ', " [2] Plan \u2014 ask 2-3 clarifying questions first"] }), _jsx(Text, { dimColor: true, children: "  Press 1, 2, or Tab to switch. Enter to confirm." })] }))] })), step === 'clarify_loading' && (_jsx(Box, { marginTop: 1, children: _jsx(Text, { color: "yellow", children: "  Analyzing task for clarifying questions..." }) })), (step === 'clarify_ask') && (_jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsxs(Box, { children: [_jsx(Text, { dimColor: true, children: "  Clarifying questions " }), _jsxs(Text, { dimColor: true, children: ["(", clarifyIndex + 1, "/", clarifyQuestions.length, ")"] }), _jsx(Text, { dimColor: true, children: " \u2014 Esc to skip" })] }), clarifyQuestions.map((q, i) => (_jsx(Box, { marginLeft: 2, children: i < clarifyIndex ? (
                        // Answered
                        _jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: "green", children: ['\u2713', " ", q.question] }), _jsxs(Text, { bold: true, children: ["    ", q.answer || '(skipped)'] })] })) : i === clarifyIndex ? (
                        // Current question
                        _jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: "cyan", children: [`>`, " ", q.question] }), _jsxs(Text, { children: ["    ", input, _jsx(Text, { color: "cyan", children: "|" })] })] })) : null }, i)))] })), isPast('clarify_ask') && !clarifySkipped && clarifyQuestions.some(q => q.answer.trim()) && (_jsx(Box, { marginLeft: 2, children: _jsxs(Text, { color: "green", children: ['\u2713', " ", clarifyQuestions.filter(q => q.answer.trim()).length, " clarification(s) added"] }) })), (step === 'sessions' || step === 'budget' || step === 'mode' || step === 'confirm') && (_jsxs(Box, { children: [_jsxs(Text, { color: step === 'sessions' ? 'cyan' : 'green', children: [step === 'sessions' ? '>' : '\u2713', " Max sessions:", ' '] }), step === 'sessions' ? (input ? (_jsxs(Text, { children: [input, _jsx(Text, { color: "cyan", children: "|" })] })) : (_jsxs(Text, { dimColor: true, children: [String(DEFAULT_CONFIG.maxSessions), _jsx(Text, { color: "cyan", children: "|" })] }))) : (_jsx(Text, { bold: true, children: sessions }))] })), (step === 'budget' || step === 'mode' || step === 'confirm') && (_jsxs(Box, { children: [_jsxs(Text, { color: step === 'budget' ? 'cyan' : 'green', children: [step === 'budget' ? '>' : '\u2713', " Budget per session ($):", ' '] }), step === 'budget' ? (input ? (_jsxs(Text, { children: [input, _jsx(Text, { color: "cyan", children: "|" })] })) : (_jsxs(Text, { dimColor: true, children: [String(DEFAULT_CONFIG.sessionBudget), _jsx(Text, { color: "cyan", children: "|" })] }))) : (_jsxs(Text, { bold: true, children: ["$", budget] }))] })), (step === 'mode' || step === 'confirm') && (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: step === 'mode' ? 'cyan' : 'green', children: [step === 'mode' ? '>' : '\u2713', " Session mode:", ' ', step !== 'mode' && _jsx(Text, { bold: true, children: mode === 'guided' ? 'Guided (pause between sessions)' : 'Auto (no pauses)' })] }), step === 'mode' && (_jsxs(Box, { flexDirection: "column", marginLeft: 4, children: [_jsxs(Text, { color: mode === 'guided' ? 'cyan' : 'gray', children: [mode === 'guided' ? '\u25B6' : ' ', " [1] Guided \u2014 10s pause between sessions, type to inject instructions"] }), _jsxs(Text, { color: mode === 'auto' ? 'cyan' : 'gray', children: [mode === 'auto' ? '\u25B6' : ' ', " [2] Auto \u2014 no pauses, fully autonomous"] }), _jsx(Text, { dimColor: true, children: "  Press 1, 2, or Tab to switch. Enter to confirm." })] }))] })), step === 'confirm' && (_jsxs(_Fragment, { children: [_jsx(Text, { children: " " }), _jsx(Box, { borderStyle: "round", borderColor: "green", paddingX: 1, children: _jsx(Text, { color: "green", bold: true, children: "Press Enter to start relay" }) })] }))] }));
}
//# sourceMappingURL=StartupApp.js.map