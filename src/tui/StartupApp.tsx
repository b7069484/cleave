import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { App } from './App.js';
import type { RelayConfig, CleaveMode } from '../relay/config.js';
import { DEFAULT_CONFIG } from '../relay/config.js';

type SetupStep = 'dir' | 'task' | 'clarify_loading' | 'clarify_ask' | 'sessions' | 'budget' | 'mode' | 'remote' | 'confirm';

interface ClarifyQuestion {
  question: string;
  answer: string;
}

interface StartupAppProps {
  initialDir?: string;
}

/**
 * Run a quick Claude call to generate clarifying questions about the task.
 * Uses claude -p with text output for simplicity.
 */
async function fetchClarifyQuestions(task: string, projectDir: string): Promise<string[]> {
  const prompt = `You are helping a user set up an autonomous multi-session coding task. They described their task as:

"${task}"

This task will be executed by Claude Code autonomously across multiple sessions. Ask 2-3 SHORT clarifying questions that would help make the task more specific and successful. Focus on:
- Ambiguous requirements that could be interpreted multiple ways
- Important constraints or preferences (language, framework, style)
- Technical choices that could go either way

Output ONLY a JSON array of question strings, nothing else. Example:
["What testing framework should be used?", "Should the API support pagination?"]`;

  return new Promise<string[]>((resolve, reject) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const child = spawn('claude', ['-p', '--output-format', 'text'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: projectDir,
      env,
    });

    let stdout = '';
    child.stdout!.on('data', (d: Buffer) => { stdout += d.toString(); });
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
      } catch {
        resolve([]);
      }
    });
    child.on('error', () => resolve([]));

    child.stdin!.write(prompt);
    child.stdin!.end();
  });
}

export function StartupApp({ initialDir }: StartupAppProps) {
  const { exit } = useApp();
  const [step, setStep] = useState<SetupStep>(initialDir ? 'task' : 'dir');
  const [dir, setDir] = useState(initialDir ?? process.cwd());
  const [task, setTask] = useState('');
  const [sessions, setSessions] = useState(String(DEFAULT_CONFIG.maxSessions));
  const [budget, setBudget] = useState(String(DEFAULT_CONFIG.sessionBudget));
  const [mode, setMode] = useState<CleaveMode>('guided');
  const [remoteControl, setRemoteControl] = useState(false);
  const [started, setStarted] = useState(false);

  // Clarification state
  const [clarifyQuestions, setClarifyQuestions] = useState<ClarifyQuestion[]>([]);
  const [clarifyIndex, setClarifyIndex] = useState(0);
  const [clarifySkipped, setClarifySkipped] = useState(false);

  // Current input value for the active field
  const [input, setInput] = useState('');

  // Fetch clarifying questions when we enter clarify_loading
  useEffect(() => {
    if (step !== 'clarify_loading') return;
    let cancelled = false;

    fetchClarifyQuestions(task, dir).then(questions => {
      if (cancelled) return;
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
        if (!input.trim()) return;
        setTask(input.trim());
        setInput('');
        setStep('clarify_loading');
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
        } else {
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
        setStep('remote');
        break;
      case 'remote':
        setStep('confirm');
        break;
      case 'confirm':
        setStarted(true);
        break;
    }
  }, [step, input, clarifyQuestions, clarifyIndex]);

  useInput(useCallback((ch: string, key: { return?: boolean; backspace?: boolean; escape?: boolean; tab?: boolean }) => {
    if (started) return;

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

    // Mode selection: 1 = guided, 2 = auto
    if (step === 'mode') {
      if (ch === '1') { setMode('guided'); return; }
      if (ch === '2') { setMode('auto'); return; }
      // Tab toggles
      if (key.tab) { setMode(m => m === 'guided' ? 'auto' : 'guided'); return; }
      return;
    }

    if (step === 'remote') {
      if (ch === '1') { setRemoteControl(true); return; }
      if (ch === '2') { setRemoteControl(false); return; }
      if (key.tab) { setRemoteControl(r => !r); return; }
      return;
    }

    if (key.backspace) {
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

    const config: RelayConfig = {
      projectDir: resolve(dir),
      initialTask: enrichedTask,
      maxSessions: parseInt(sessions, 10) || DEFAULT_CONFIG.maxSessions!,
      sessionBudget: parseFloat(budget) || DEFAULT_CONFIG.sessionBudget!,
      mode,
      remoteControl,
      skipPermissions: true,
      maxSessionLogEntries: DEFAULT_CONFIG.maxSessionLogEntries!,
    };
    return <App config={config} />;
  }

  // Helper to check if a step is past
  const isPast = (s: SetupStep) => {
    const order: SetupStep[] = ['dir', 'task', 'clarify_loading', 'clarify_ask', 'sessions', 'budget', 'mode', 'remote', 'confirm'];
    return order.indexOf(s) < order.indexOf(step);
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1} flexDirection="column" alignItems="center">
        <Text bold color="cyan">CLEAVE — Interactive Setup</Text>
        <Text dimColor>Esc to cancel · Ctrl+U to clear</Text>
      </Box>
      <Text> </Text>

      {/* Project Directory */}
      <Box>
        <Text color={step === 'dir' ? 'cyan' : 'green'}>
          {step === 'dir' ? '>' : '\u2713'} Project folder:{' '}
        </Text>
        {step === 'dir' ? (
          input ? (
            <Text>{input}<Text color="cyan">|</Text></Text>
          ) : (
            <Text dimColor>{process.cwd()}<Text color="cyan">|</Text></Text>
          )
        ) : (
          <Text bold>{dir}</Text>
        )}
      </Box>

      {/* Task */}
      {isPast('task') || step === 'task' ? (
        <Box>
          <Text color={step === 'task' ? 'cyan' : (task ? 'green' : 'gray')}>
            {step === 'task' ? '>' : (task ? '\u2713' : ' ')} Task:{' '}
          </Text>
          {step === 'task' ? (
            <Text>{input}<Text color="cyan">|</Text></Text>
          ) : (
            <Text bold>{task ? task.slice(0, 60) + (task.length > 60 ? '...' : '') : ''}</Text>
          )}
        </Box>
      ) : null}

      {/* Clarify Loading */}
      {step === 'clarify_loading' && (
        <Box marginTop={1}>
          <Text color="yellow">  Analyzing task for clarifying questions...</Text>
        </Box>
      )}

      {/* Clarify Questions */}
      {(step === 'clarify_ask') && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text dimColor>  Clarifying questions </Text>
            <Text dimColor>({clarifyIndex + 1}/{clarifyQuestions.length})</Text>
            <Text dimColor> — Esc to skip</Text>
          </Box>
          {clarifyQuestions.map((q, i) => (
            <Box key={i} marginLeft={2}>
              {i < clarifyIndex ? (
                // Answered
                <Box flexDirection="column">
                  <Text color="green">{'\u2713'} {q.question}</Text>
                  <Text bold>    {q.answer || '(skipped)'}</Text>
                </Box>
              ) : i === clarifyIndex ? (
                // Current question
                <Box flexDirection="column">
                  <Text color="cyan">{`>`} {q.question}</Text>
                  <Text>    {input}<Text color="cyan">|</Text></Text>
                </Box>
              ) : null}
            </Box>
          ))}
        </Box>
      )}

      {/* Show answered clarifications summary after moving past */}
      {isPast('clarify_ask') && !clarifySkipped && clarifyQuestions.some(q => q.answer.trim()) && (
        <Box marginLeft={2}>
          <Text color="green">{'\u2713'} {clarifyQuestions.filter(q => q.answer.trim()).length} clarification(s) added</Text>
        </Box>
      )}

      {/* Sessions */}
      {(step === 'sessions' || step === 'budget' || step === 'mode' || step === 'remote' || step === 'confirm') && (
        <Box>
          <Text color={step === 'sessions' ? 'cyan' : 'green'}>
            {step === 'sessions' ? '>' : '\u2713'} Max sessions:{' '}
          </Text>
          {step === 'sessions' ? (
            input ? (
              <Text>{input}<Text color="cyan">|</Text></Text>
            ) : (
              <Text dimColor>{String(DEFAULT_CONFIG.maxSessions)}<Text color="cyan">|</Text></Text>
            )
          ) : (
            <Text bold>{sessions}</Text>
          )}
        </Box>
      )}

      {/* Budget */}
      {(step === 'budget' || step === 'mode' || step === 'remote' || step === 'confirm') && (
        <Box>
          <Text color={step === 'budget' ? 'cyan' : 'green'}>
            {step === 'budget' ? '>' : '\u2713'} Budget per session ($):{' '}
          </Text>
          {step === 'budget' ? (
            input ? (
              <Text>{input}<Text color="cyan">|</Text></Text>
            ) : (
              <Text dimColor>{String(DEFAULT_CONFIG.sessionBudget)}<Text color="cyan">|</Text></Text>
            )
          ) : (
            <Text bold>${budget}</Text>
          )}
        </Box>
      )}

      {/* Mode Selection */}
      {(step === 'mode' || step === 'remote' || step === 'confirm') && (
        <Box flexDirection="column">
          <Text color={step === 'mode' ? 'cyan' : 'green'}>
            {step === 'mode' ? '>' : '\u2713'} Session mode:{' '}
            {step !== 'mode' && <Text bold>{mode === 'guided' ? 'Guided (pause between sessions)' : 'Auto (no pauses)'}</Text>}
          </Text>
          {step === 'mode' && (
            <Box flexDirection="column" marginLeft={4}>
              <Text color={mode === 'guided' ? 'cyan' : 'gray'}>
                {mode === 'guided' ? '\u25B6' : ' '} [1] Guided — 10s pause between sessions, type to inject instructions
              </Text>
              <Text color={mode === 'auto' ? 'cyan' : 'gray'}>
                {mode === 'auto' ? '\u25B6' : ' '} [2] Auto — no pauses, fully autonomous
              </Text>
              <Text dimColor>  Press 1, 2, or Tab to switch. Enter to confirm.</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Remote Control */}
      {(step === 'remote' || step === 'confirm') && (
        <Box flexDirection="column">
          <Text color={step === 'remote' ? 'cyan' : 'green'}>
            {step === 'remote' ? '>' : '\u2713'} Remote control:{' '}
            {step !== 'remote' && <Text bold>{remoteControl ? 'Enabled (browser access)' : 'Disabled'}</Text>}
          </Text>
          {step === 'remote' && (
            <Box flexDirection="column" marginLeft={4}>
              <Text color={remoteControl ? 'cyan' : 'gray'}>
                {remoteControl ? '\u25B6' : ' '} [1] Yes — provide browser URL for mobile/remote access
              </Text>
              <Text color={!remoteControl ? 'cyan' : 'gray'}>
                {!remoteControl ? '\u25B6' : ' '} [2] No — terminal only
              </Text>
              <Text dimColor>  Press 1, 2, or Tab to switch. Enter to confirm.</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Confirm */}
      {step === 'confirm' && (
        <>
          <Text> </Text>
          <Box borderStyle="round" borderColor="green" paddingX={1}>
            <Text color="green" bold>Press Enter to start relay</Text>
          </Box>
        </>
      )}
    </Box>
  );
}
