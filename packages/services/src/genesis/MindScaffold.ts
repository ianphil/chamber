// MindScaffold — creates the deterministic structure, prompts the agent for soul, validates.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { Logger } from '../logger';
import { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import { approveAllCompat } from '../sdk/approveAllCompat';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext } from '../chat/currentDateTimeContext';
import { buildGenesisPrompt } from './genesisPrompt';
import { GitHubRegistryClient } from './GitHubRegistryClient';

const log = Logger.create('MindScaffold');

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

interface RemoteRegistry {
  skills?: Record<string, { version?: string; description?: string }>;
}

export class MindScaffold {
  private onProgress?: (progress: GenesisProgress) => void;
  private registryClient: GitHubRegistryClient;
  private clientFactory: CopilotClientFactory;

  constructor(registryClient = new GitHubRegistryClient(), clientFactory = new CopilotClientFactory()) {
    this.registryClient = registryClient;
    this.clientFactory = clientFactory;
  }

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
    const raw = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    // Cap directory name at 40 chars so we never blow past filesystem limits
    // (macOS NAME_MAX is 255 bytes; APFS plus child paths like /inbox can still hit ENAMETOOLONG well before that).
    if (raw.length <= 40) return raw;
    return raw.slice(0, 40).replace(/-+$/, '');
  }

  async create(config: GenesisConfig): Promise<string> {
    const slug = MindScaffold.slugify(config.name);
    const mindPath = path.join(config.basePath, slug);

    // Refuse to create when the target directory already exists. createStructure
    // uses fs.mkdirSync(..., { recursive: true }) which silently merges into an
    // existing tree — combined with the 40-char slug cap, two long names sharing
    // a prefix would write into the same mind and overwrite SOUL.md, agent files,
    // and working memory. Caller should surface this and prompt for a new name.
    if (fs.existsSync(mindPath)) {
      throw new Error(`Mind directory already exists: ${mindPath}`);
    }

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
      log.warn('Missing files after genesis:', result.missing);
    }

    // 4. Git init
    this.emit('git', 'Initializing...');
    this.initGit(mindPath);

    // 5. Bootstrap capabilities (best-effort — mind works without them)
    this.emit('capabilities', 'Installing capabilities...');
    try {
      await this.bootstrapCapabilities(mindPath);
    } catch (err) {
      log.warn('Capability bootstrap failed (non-fatal):', err);
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
    const client = await this.clientFactory.createClient(mindPath);

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
      onPermissionRequest: approveAllCompat,
    };

    const session = await client.createSession(
      sessionConfig as unknown as Parameters<typeof client.createSession>[0]
    );

    await session.rpc.permissions.setApproveAll({ enabled: true });

    try {
      await session.send({ prompt: injectCurrentDateTimeContext(prompt, getCurrentDateTimeContext()) });

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
      await session.destroy().catch(() => { /* noop */ });
      await this.clientFactory.destroyClient(client);
    }
  }

  private initGit(mindPath: string): void {
    try {
      execSync('git init', { cwd: mindPath, stdio: 'ignore' });
      execSync('git add -A', { cwd: mindPath, stdio: 'ignore' });
      execSync('git commit -m "Genesis"', { cwd: mindPath, stdio: 'ignore' });
    } catch (err) {
      log.error('Git init failed:', err);
    }
  }

  private async bootstrapCapabilities(mindPath: string): Promise<void> {
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
    const remoteRegistry = await this.pullUpgradeSkill(mindPath);

    // 3. Install only skills — Chamber internalizes extensions.
    const skillNames = Object.keys(remoteRegistry.skills ?? {});
    if (skillNames.length === 0) {
      this.emit('capabilities', 'No remote skills to install.');
      return;
    }

    this.emit('capabilities', 'Installing skills...');
    const upgradeScript = path.join(mindPath, '.github', 'skills', 'upgrade', 'upgrade.js');
    const result = execSync(`node "${upgradeScript}" install ${skillNames.join(',')}`, {
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
      log.info(`Capabilities: ${installed} installed, ${updated} updated, ${errors} errors`);
      if (errors > 0) {
        log.warn('Capability errors:', parsed.errors);
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

  private async pullUpgradeSkill(mindPath: string): Promise<RemoteRegistry> {
    const [owner, repo] = GENESIS_SOURCE.split('/');
    const upgradePrefix = '.github/skills/upgrade/';

    // Fetch the genesis tree
    const treeEntries = await this.registryClient.fetchTree(owner, repo, GENESIS_CHANNEL);

    // Find upgrade skill files
    const upgradeFiles: { path: string; sha: string }[] = [];
    for (const entry of treeEntries) {
      if (entry.type === 'blob' && entry.path.startsWith(upgradePrefix)) {
        upgradeFiles.push({ path: entry.path, sha: entry.sha });
      }
    }

    if (upgradeFiles.length === 0) {
      throw new Error('Upgrade skill not found in genesis repo');
    }

    // Download and write each file
    for (const file of upgradeFiles) {
      const content = await this.registryClient.fetchBlob(owner, repo, file.sha);
      const localPath = path.join(mindPath, file.path);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content);
    }

    // Fetch remote registry to get upgrade version info
    const remoteRegistry = await this.registryClient.fetchJsonContent(owner, repo, '.github/registry.json', GENESIS_CHANNEL) as RemoteRegistry;
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
    return remoteRegistry;
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
