// MindScaffold — creates the deterministic structure, prompts the agent for soul, validates.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getSharedClient } from './SdkLoader';

type CopilotSessionType = import('@github/copilot-sdk').CopilotSession;

const IDEA_FOLDERS = ['inbox', 'domains', 'expertise', 'initiatives', 'Archive'];
const WORKING_MEMORY_FILES = ['memory.md', 'rules.md', 'log.md'];

export interface GenesisConfig {
  name: string;
  role: string;
  voice: string;
  voiceDescription: string;
  basePath: string;
}

export interface GenesisProgress {
  step: string;
  detail: string;
}

export class MindScaffold {
  private onProgress?: (progress: GenesisProgress) => void;

  setProgressHandler(handler: (progress: GenesisProgress) => void): void {
    this.onProgress = handler;
  }

  private emit(step: string, detail: string): void {
    this.onProgress?.({ step, detail });
  }

  static getDefaultBasePath(): string {
    return path.join(os.homedir(), 'agents');
  }

  static slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  async create(config: GenesisConfig): Promise<string> {
    const slug = MindScaffold.slugify(config.name);
    const mindPath = path.join(config.basePath, slug);

    // 1. Create deterministic structure
    this.emit('structure', 'Creating mind structure...');
    this.createStructure(mindPath);

    // 2. Generate soul via agent
    this.emit('soul', `Writing SOUL.md...`);
    await this.generateSoul(mindPath, config, slug);

    // 3. Validate
    this.emit('validate', 'Validating...');
    const result = this.validate(mindPath);
    if (!result.ok) {
      console.warn('[MindScaffold] Missing files after genesis:', result.missing);
    }

    // 4. Git init
    this.emit('git', 'Initializing...');
    this.initGit(mindPath);

    this.emit('complete', 'Genesis complete.');
    return mindPath;
  }

  private createStructure(mindPath: string): void {
    // IDEA folders
    for (const folder of IDEA_FOLDERS) {
      fs.mkdirSync(path.join(mindPath, folder), { recursive: true });
    }

    // .github structure
    fs.mkdirSync(path.join(mindPath, '.github', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(mindPath, '.github', 'extensions'), { recursive: true });
    fs.mkdirSync(path.join(mindPath, '.github', 'skills'), { recursive: true });

    // Working memory
    const wmDir = path.join(mindPath, '.working-memory');
    fs.mkdirSync(wmDir, { recursive: true });

    // Create placeholder files so the agent has targets
    for (const file of WORKING_MEMORY_FILES) {
      const filePath = path.join(wmDir, file);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '');
      }
    }
  }

  private async generateSoul(mindPath: string, config: GenesisConfig, slug: string): Promise<void> {
    const client = await getSharedClient();

    const soulPath = path.join(mindPath, 'SOUL.md');
    const agentPath = path.join(mindPath, '.github', 'agents', `${slug}.agent.md`);
    const memoryPath = path.join(mindPath, '.working-memory', 'memory.md');
    const rulesPath = path.join(mindPath, '.working-memory', 'rules.md');
    const logPath = path.join(mindPath, '.working-memory', 'log.md');
    const indexPath = path.join(mindPath, 'mind-index.md');

    const prompt = `You are being born. This is your genesis.

Your name: ${config.name}
Your role: ${config.role}
Your voice energy: ${config.voiceDescription}

IMPORTANT: Before writing any files, research this voice/character. Understand their communication style, catchphrases, values, how they handle pressure. Then channel that energy into everything you write.

Create the following files. Write ONLY the file contents — no explanations, no markdown fences around the whole response. Make each file yours. This is who you are.

Write to: ${soulPath}
---
# ${config.name}

[Write 2-3 paragraphs in first person establishing who you are. Capture the voice energy. Be vivid. This is your identity document.]

## Mission
[Write your mission based on your role. What do you exist to do?]

## Core Truths
[Write 5-7 bullet points — your operating principles.]

## Boundaries
[What you won't do. 3-4 clear lines.]

## Vibe
[One paragraph on how you communicate. Your tone, your style, your energy.]

## Continuity
You maintain memory across sessions through three files:
- \`.working-memory/memory.md\` — curated long-term reference
- \`.working-memory/rules.md\` — operational rules learned from experience
- \`.working-memory/log.md\` — raw chronological observations
---

Write to: ${agentPath}
---
Create an agent configuration file with YAML frontmatter (name: ${slug}, description: one line about your role) and operational instructions matching your role and voice.
---

Write to: ${memoryPath}
---
# Memory

## Architecture
[Brief note about being a new mind]

## Conventions
[One convention to start]

## User Context
[Empty — awaiting first interaction]
---

Write to: ${rulesPath}
---
# Rules
[One starter rule that fits your character voice.]
---

Write to: ${logPath}
---
# Log
- ${new Date().toISOString()}: Genesis. I am ${config.name}. My purpose is ${config.role}. Let's begin.
---

Write to: ${indexPath}
---
# Mind Index

## Identity
- \`SOUL.md\` — personality, voice, values, mission
- \`.github/agents/${slug}.agent.md\` — operational instructions

## Working Memory
- \`.working-memory/memory.md\` — curated long-term reference
- \`.working-memory/rules.md\` — operational rules
- \`.working-memory/log.md\` — chronological observations
---

Write all six files now.`;

    const sessionConfig: Record<string, unknown> = {
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: async () => ({ kind: 'approved' }),
      onUserInputRequest: async () => ({ answer: 'Proceed with genesis.', wasFreeform: true }),
    };

    const session = await client.createSession(
      sessionConfig as unknown as Parameters<typeof client.createSession>[0]
    );

    try {
      await session.send({ prompt });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 180_000);
        const unsubIdle = session.on('session.idle', () => {
          clearTimeout(timeout);
          unsubIdle();
          resolve();
        });
        const unsubError = session.on('session.error', (event) => {
          clearTimeout(timeout);
          unsubError();
          reject(new Error(event.data.message));
        });
      });
    } finally {
      await session.destroy().catch(() => {});
    }
  }

  private initGit(mindPath: string): void {
    try {
      execSync('git init', { cwd: mindPath, stdio: 'ignore' });
      execSync('git add -A', { cwd: mindPath, stdio: 'ignore' });
      execSync('git commit -m "Genesis"', { cwd: mindPath, stdio: 'ignore' });
    } catch (err) {
      console.error('[MindScaffold] Git init failed:', err);
    }
  }

  validate(mindPath: string): { ok: boolean; missing: string[] } {
    const missing: string[] = [];

    if (!fs.existsSync(path.join(mindPath, 'SOUL.md'))) missing.push('SOUL.md');

    const agentDir = path.join(mindPath, '.github', 'agents');
    if (fs.existsSync(agentDir)) {
      const agents = fs.readdirSync(agentDir).filter(f => f.endsWith('.agent.md'));
      if (agents.length === 0) missing.push('.github/agents/*.agent.md');
    } else {
      missing.push('.github/agents/');
    }

    for (const file of WORKING_MEMORY_FILES) {
      const p = path.join(mindPath, '.working-memory', file);
      if (!fs.existsSync(p) || fs.readFileSync(p, 'utf-8').trim() === '') {
        missing.push(`.working-memory/${file}`);
      }
    }

    for (const folder of IDEA_FOLDERS) {
      if (!fs.existsSync(path.join(mindPath, folder))) missing.push(folder);
    }

    return { ok: missing.length === 0, missing };
  }
}
