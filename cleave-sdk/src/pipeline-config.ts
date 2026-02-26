/**
 * Pipeline YAML parsing and validation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { PipelineConfig, StageConfig } from './config';

/**
 * Load and validate a pipeline configuration from a YAML file.
 */
export function loadPipelineConfig(yamlPath: string, workDir?: string): PipelineConfig {
  const resolvedPath = path.resolve(yamlPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Pipeline config not found: ${resolvedPath}`);
  }

  const raw = fs.readFileSync(resolvedPath, 'utf8');
  let config: any;

  try {
    config = parseYaml(raw);
  } catch (err: any) {
    throw new Error(`Invalid YAML in pipeline config: ${err.message}`);
  }

  // Validate required fields
  if (!config || typeof config !== 'object') {
    throw new Error('Pipeline config must be a YAML object');
  }

  if (!config.name || typeof config.name !== 'string') {
    throw new Error('Pipeline config requires a "name" field');
  }

  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    throw new Error('Pipeline config requires at least one stage in "stages"');
  }

  // Resolve work directory
  const baseDir = workDir || config.workDir || '.';

  // Validate and normalize stages
  const stages: StageConfig[] = config.stages.map((s: any, i: number) => {
    if (!s.name || typeof s.name !== 'string') {
      throw new Error(`Stage ${i + 1} requires a "name" field`);
    }
    if (!s.prompt || typeof s.prompt !== 'string') {
      throw new Error(`Stage "${s.name}" requires a "prompt" field`);
    }

    // Resolve prompt path relative to pipeline config location
    const promptPath = path.resolve(path.dirname(resolvedPath), s.prompt);
    if (!fs.existsSync(promptPath)) {
      // Also try relative to workDir
      const altPromptPath = path.resolve(baseDir, s.prompt);
      if (!fs.existsSync(altPromptPath)) {
        throw new Error(`Stage "${s.name}" prompt file not found: ${s.prompt}\n  Tried: ${promptPath}\n  Tried: ${altPromptPath}`);
      }
      s.prompt = altPromptPath;
    } else {
      s.prompt = promptPath;
    }

    if (!s.maxSessions || typeof s.maxSessions !== 'number' || s.maxSessions < 1) {
      throw new Error(`Stage "${s.name}" requires a positive "maxSessions" number`);
    }
    if (!s.completion || typeof s.completion !== 'string') {
      throw new Error(`Stage "${s.name}" requires a "completion" marker string`);
    }

    // Validate onFail
    if (s.onFail && !['stop', 'retry', 'skip'].includes(s.onFail)) {
      throw new Error(`Stage "${s.name}" onFail must be "stop", "retry", or "skip"`);
    }

    // Validate retryMax
    if (s.retryMax !== undefined && (typeof s.retryMax !== 'number' || s.retryMax < 1)) {
      throw new Error(`Stage "${s.name}" retryMax must be a positive number`);
    }

    // Validate requires
    if (s.requires && !Array.isArray(s.requires)) {
      throw new Error(`Stage "${s.name}" requires must be an array of stage names`);
    }

    return {
      name: s.name,
      prompt: s.prompt,
      maxSessions: s.maxSessions,
      completion: s.completion,
      requires: s.requires || undefined,
      verify: s.verify || undefined,
      onFail: s.onFail || 'stop',
      retryMax: s.retryMax || 1,
      shareKnowledge: s.shareKnowledge !== false,
    } as StageConfig;
  });

  // Validate DAG (no circular dependencies)
  validateDag(stages);

  // Validate that all required stages exist
  const stageNames = new Set(stages.map(s => s.name));
  for (const stage of stages) {
    if (stage.requires) {
      for (const dep of stage.requires) {
        if (!stageNames.has(dep)) {
          throw new Error(`Stage "${stage.name}" requires "${dep}" which doesn't exist in the pipeline`);
        }
      }
    }
  }

  return {
    name: config.name,
    workDir: config.workDir,
    stages,
  };
}

/**
 * Validate that stages form a valid DAG (no circular dependencies).
 */
export function validateDag(stages: StageConfig[]): void {
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const stageMap = new Map<string, StageConfig>();
  for (const s of stages) {
    stageMap.set(s.name, s);
  }

  function visit(name: string, trail: string[]): void {
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected: ${[...trail, name].join(' → ')}`);
    }
    if (visited.has(name)) return;

    visiting.add(name);
    const stage = stageMap.get(name);
    if (stage?.requires) {
      for (const dep of stage.requires) {
        visit(dep, [...trail, name]);
      }
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const stage of stages) {
    visit(stage.name, []);
  }
}
