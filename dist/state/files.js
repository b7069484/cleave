import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
export class CleaveState {
    projectDir;
    cleaveDir;
    logsDir;
    constructor(projectDir) {
        this.projectDir = projectDir;
        this.cleaveDir = join(projectDir, '.cleave');
        this.logsDir = join(this.cleaveDir, 'logs');
    }
    async init() {
        await mkdir(this.cleaveDir, { recursive: true });
        await mkdir(this.logsDir, { recursive: true });
    }
    // Session count
    async getSessionCount() {
        return this.readInt('.session_count', 0);
    }
    async setSessionCount(n) {
        await this.writeInternal('.session_count', String(n));
    }
    // Persisted max sessions (for dynamic limit adjustment)
    async getMaxSessions() {
        const content = await this.readInternal('.max_sessions');
        const parsed = parseInt(content.trim(), 10);
        return isNaN(parsed) ? null : parsed;
    }
    async setMaxSessions(n) {
        await this.writeInternal('.max_sessions', String(n));
    }
    // Persisted session budget (for dynamic limit adjustment)
    async getSessionBudget() {
        const content = await this.readInternal('.session_budget');
        const parsed = parseFloat(content.trim());
        return isNaN(parsed) ? null : parsed;
    }
    async setSessionBudget(n) {
        await this.writeInternal('.session_budget', String(n));
    }
    // Session start timestamp
    async markSessionStart() {
        await this.writeInternal('.session_start', String(Date.now()));
    }
    async getSessionStart() {
        return this.readInt('.session_start', 0);
    }
    // NEXT_PROMPT.md
    async readNextPrompt() {
        return this.readInternal('NEXT_PROMPT.md');
    }
    async writeNextPrompt(content) {
        await this.writeInternal('NEXT_PROMPT.md', content);
    }
    // PROGRESS.md
    async readProgress() {
        return this.readInternal('PROGRESS.md');
    }
    async writeProgress(content) {
        await this.writeInternal('PROGRESS.md', content);
    }
    // KNOWLEDGE.md
    async readKnowledge() {
        return this.readInternal('KNOWLEDGE.md');
    }
    async writeKnowledge(content) {
        await this.writeInternal('KNOWLEDGE.md', content);
    }
    // Handoff signal
    async readHandoffSignal() {
        const content = await this.readInternal('.handoff_signal');
        return content.trim() || null;
    }
    async writeHandoffSignal(signal) {
        await this.writeInternal('.handoff_signal', signal);
    }
    async clearHandoffSignal() {
        const path = join(this.cleaveDir, '.handoff_signal');
        if (existsSync(path)) {
            await rm(path);
        }
    }
    // Archive session files to logs/
    async archiveSession(sessionNum) {
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
    get dir() {
        return this.cleaveDir;
    }
    get project() {
        return this.projectDir;
    }
    // Internal helpers
    async readInternal(filename) {
        const path = join(this.cleaveDir, filename);
        if (!existsSync(path))
            return '';
        return readFile(path, 'utf-8');
    }
    async writeInternal(filename, content) {
        await writeFile(join(this.cleaveDir, filename), content, 'utf-8');
    }
    async readInt(filename, defaultVal) {
        const content = await this.readInternal(filename);
        const parsed = parseInt(content.trim(), 10);
        return isNaN(parsed) ? defaultVal : parsed;
    }
}
//# sourceMappingURL=files.js.map