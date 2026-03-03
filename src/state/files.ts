import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export class CleaveState {
  private cleaveDir: string;
  private logsDir: string;

  constructor(private projectDir: string) {
    this.cleaveDir = join(projectDir, '.cleave');
    this.logsDir = join(this.cleaveDir, 'logs');
  }

  async init(): Promise<void> {
    await mkdir(this.cleaveDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
  }

  // Session count
  async getSessionCount(): Promise<number> {
    return this.readInt('.session_count', 0);
  }

  async setSessionCount(n: number): Promise<void> {
    await this.writeInternal('.session_count', String(n));
  }

  // Session start timestamp
  async markSessionStart(): Promise<void> {
    await this.writeInternal('.session_start', String(Date.now()));
  }

  async getSessionStart(): Promise<number> {
    return this.readInt('.session_start', 0);
  }

  // NEXT_PROMPT.md
  async readNextPrompt(): Promise<string> {
    return this.readInternal('NEXT_PROMPT.md');
  }

  async writeNextPrompt(content: string): Promise<void> {
    await this.writeInternal('NEXT_PROMPT.md', content);
  }

  // PROGRESS.md
  async readProgress(): Promise<string> {
    return this.readInternal('PROGRESS.md');
  }

  async writeProgress(content: string): Promise<void> {
    await this.writeInternal('PROGRESS.md', content);
  }

  // KNOWLEDGE.md
  async readKnowledge(): Promise<string> {
    return this.readInternal('KNOWLEDGE.md');
  }

  async writeKnowledge(content: string): Promise<void> {
    await this.writeInternal('KNOWLEDGE.md', content);
  }

  // Handoff signal
  async readHandoffSignal(): Promise<string | null> {
    const content = await this.readInternal('.handoff_signal');
    return content.trim() || null;
  }

  async writeHandoffSignal(signal: string): Promise<void> {
    await this.writeInternal('.handoff_signal', signal);
  }

  async clearHandoffSignal(): Promise<void> {
    const path = join(this.cleaveDir, '.handoff_signal');
    if (existsSync(path)) {
      await rm(path);
    }
  }

  // Archive session files to logs/
  async archiveSession(sessionNum: number): Promise<void> {
    const files = ['PROGRESS.md', 'NEXT_PROMPT.md', 'KNOWLEDGE.md'];
    const prefixes = ['progress', 'next_prompt', 'knowledge'];
    for (let i = 0; i < files.length; i++) {
      const src = join(this.cleaveDir, files[i]);
      if (existsSync(src)) {
        const dest = join(this.logsDir, `session_${sessionNum}_${prefixes[i]}.md`);
        await copyFile(src, dest);
      }
    }
  }

  get dir(): string {
    return this.cleaveDir;
  }

  get project(): string {
    return this.projectDir;
  }

  // Internal helpers
  private async readInternal(filename: string): Promise<string> {
    const path = join(this.cleaveDir, filename);
    if (!existsSync(path)) return '';
    return readFile(path, 'utf-8');
  }

  private async writeInternal(filename: string, content: string): Promise<void> {
    await writeFile(join(this.cleaveDir, filename), content, 'utf-8');
  }

  private async readInt(filename: string, defaultVal: number): Promise<number> {
    const content = await this.readInternal(filename);
    const parsed = parseInt(content.trim(), 10);
    return isNaN(parsed) ? defaultVal : parsed;
  }
}
