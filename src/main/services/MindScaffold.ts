// MindScaffold — creates the deterministic structure, prompts the agent for soul, validates.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getSharedClient } from './SdkLoader';
import { buildGenesisPrompt } from './genesisPrompt';

type CopilotSessionType = import('@github/copilot-sdk').CopilotSession;

const IDEA_FOLDERS = ['inbox', 'domains', 'expertise', 'initiatives', 'Archive'];
const WORKING_MEMORY_FILES = ['memory.md', 'rules.md', 'log.md'];

const GENESIS_SOURCE = 'ianphil/genesis';
const GENESIS_CHANNEL = 'main';

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

    // 5. Bootstrap capabilities (best-effort — mind works without them)
    this.emit('capabilities', 'Installing capabilities...');
    try {
      this.bootstrapCapabilities(mindPath);
    } catch (err) {
      console.warn('[MindScaffold] Capability bootstrap failed (non-fatal):', err);
      this.emit('capabilities', 'Capabilities install failed — run "upgrade from genesis" later.');
    }

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

    const prompt = buildGenesisPrompt({
      name: config.name,
      role: config.role,
      voiceDescription: config.voiceDescription,
      paths: { soul: soulPath, agent: agentPath, memory: memoryPath, rules: rulesPath, log: logPath, index: indexPath },
    });

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

  private bootstrapCapabilities(mindPath: string): void {
    // 1. Seed registry.json
    this.emit('capabilities', 'Seeding registry...');
    const registryPath = path.join(mindPath, '.github', 'registry.json');
    const seedRegistry = {
      version: '0.0.0',
      source: GENESIS_SOURCE,
      channel: GENESIS_CHANNEL,
      extensions: {},
      skills: {},
      prompts: {},
      packages: [],
    };
    fs.writeFileSync(registryPath, JSON.stringify(seedRegistry, null, 2) + '\n');

    // 2. Pull upgrade skill (the bootloader)
    this.emit('capabilities', 'Pulling upgrade skill...');
    this.pullUpgradeSkill(mindPath);

    // 3. Run upgrade --all to pull remaining capabilities
    this.emit('capabilities', 'Installing extensions and skills...');
    const upgradeScript = path.join(mindPath, '.github', 'skills', 'upgrade', 'upgrade.js');
    const result = execSync(`node "${upgradeScript}" install --all`, {
      cwd: mindPath,
      encoding: 'utf8',
      timeout: 300_000, // 5 minute timeout
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse result to check for errors
    try {
      const parsed = JSON.parse(result);
      const installed = parsed.installed?.length || 0;
      const updated = parsed.updated?.length || 0;
      const errors = parsed.errors?.length || 0;
      console.log(`[MindScaffold] Capabilities: ${installed} installed, ${updated} updated, ${errors} errors`);
      if (errors > 0) {
        console.warn('[MindScaffold] Capability errors:', parsed.errors);
      }
    } catch {
      // upgrade.js output wasn't valid JSON — non-fatal
    }

    // 4. Commit the capabilities
    try {
      execSync('git add -A', { cwd: mindPath, stdio: 'ignore' });
      execSync('git commit -m "feat: bootstrap capabilities from genesis"', {
        cwd: mindPath,
        stdio: 'ignore',
      });
    } catch {
      // Nothing to commit (unlikely but harmless)
    }
  }

  private pullUpgradeSkill(mindPath: string): void {
    const [owner, repo] = GENESIS_SOURCE.split('/');
    const upgradePrefix = '.github/skills/upgrade/';

    // Fetch the genesis tree
    const treeRaw = execSync(
      `gh api /repos/${owner}/${repo}/git/trees/${GENESIS_CHANNEL}?recursive=1`,
      { encoding: 'utf8', timeout: 30_000 }
    );
    const tree = JSON.parse(treeRaw);

    // Find upgrade skill files
    const upgradeFiles: { path: string; sha: string }[] = [];
    for (const entry of tree.tree) {
      if (entry.type === 'blob' && entry.path.startsWith(upgradePrefix)) {
        upgradeFiles.push({ path: entry.path, sha: entry.sha });
      }
    }

    if (upgradeFiles.length === 0) {
      throw new Error('Upgrade skill not found in genesis repo');
    }

    // Download and write each file
    for (const file of upgradeFiles) {
      const blobRaw = execSync(
        `gh api /repos/${owner}/${repo}/git/blobs/${file.sha}`,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
      );
      const blob = JSON.parse(blobRaw);
      const content = Buffer.from(blob.content, 'base64');
      const localPath = path.join(mindPath, file.path);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content);
    }

    // Fetch remote registry to get upgrade version info
    const regRaw = execSync(
      `gh api /repos/${owner}/${repo}/contents/.github/registry.json?ref=${GENESIS_CHANNEL}`,
      { encoding: 'utf8' }
    );
    const regContent = JSON.parse(regRaw);
    const remoteRegistry = JSON.parse(Buffer.from(regContent.content, 'base64').toString('utf8'));
    const upgradeInfo = remoteRegistry.skills?.upgrade;

    // Update local registry with upgrade skill
    const localRegPath = path.join(mindPath, '.github', 'registry.json');
    const localReg = JSON.parse(fs.readFileSync(localRegPath, 'utf8'));
    localReg.skills.upgrade = {
      version: upgradeInfo?.version || '0.0.0',
      path: '.github/skills/upgrade',
      description: upgradeInfo?.description || 'Pull updates from genesis template registry',
    };
    fs.writeFileSync(localRegPath, JSON.stringify(localReg, null, 2) + '\n');
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
