// MindScaffold — creates the deterministic structure, prompts the agent for soul, validates.

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { Logger } from '../logger';
import { CopilotClientFactory } from '../sdk/CopilotClientFactory';
import { approveForSessionCompat } from '../sdk/approveForSessionCompat';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext } from '../chat/currentDateTimeContext';
import { buildGenesisPrompt } from './genesisPrompt';
import { GitHubRegistryClient } from './GitHubRegistryClient';
import { STRUCTURED_LOG_SENTINEL } from '../mindMemory/StructuredLogFormat';

const log = Logger.create('MindScaffold');

const IDEA_FOLDERS = ['inbox', 'domains', 'expertise', 'initiatives', 'Archive'];
const WORKING_MEMORY_FILES = ['memory.md', 'rules.md', 'log.md'];

const GENESIS_SOURCE = 'ianphil/genesis-frontier';
const GENESIS_CHANNEL = 'main';
const CHAMBER_GITIGNORE_ENTRIES = ['runs/', 'cron-runs.json', 'cron-runs.json.migrated-*'] as const;
const CHAMBER_GITIGNORE_CONTENT = `${CHAMBER_GITIGNORE_ENTRIES.join('\n')}\n`;

export interface GenesisConfig {
  name: string;
  role: string;
  voice: string;
  voiceDescription: string;
  basePath: string;
  /**
   * Strict opt-in for the dream daemon (v0.60.0). When `true`, MindScaffold
   * seeds the chamber-structured-log/v1 sentinel into log.md AND writes
   * `.chamber.json` with `workingMemory.consolidation.enabled: true` so
   * MindMemoryService.activateMind starts the daemon on the first mind load.
   * When `false` or omitted, log.md is left empty and `.chamber.json` is
   * not written — the mind operates without consolidation, matching the
   * default for every existing user upgrading into this release.
   */
  enableDreamDaemon?: boolean;
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

  static ensureChamberGitignore(mindPath: string): boolean {
    return MindScaffold.writeChamberGitignore(mindPath, { createChamberDirectory: true });
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
    this.createStructure(mindPath, { enableDreamDaemon: config.enableDreamDaemon === true });

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

  private createStructure(
    mindPath: string,
    opts: { enableDreamDaemon?: boolean } = {},
  ): void {
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

    const enableDreamDaemon = opts.enableDreamDaemon === true;

    // v0.60.0 Phase 2: log.md sentinel seed is now strict opt-in. When the
    // user toggles the dream-daemon Switch in Genesis we seed the sentinel
    // exactly as before (byte-for-byte parity with DailyLogWriter.seedFreshLog
    // — `SENTINEL + '\n\n'`). When the user opts out (default), log.md is
    // left empty by the WORKING_MEMORY_FILES placeholder loop below — no
    // sentinel byte means DailyLogWriter never engages even if a future bug
    // somehow registers a writer for this mind.
    if (enableDreamDaemon) {
      fs.writeFileSync(path.join(wmDir, 'log.md'), STRUCTURED_LOG_SENTINEL + '\n\n');
    }

    // Create placeholder files so the agent has targets
    for (const file of WORKING_MEMORY_FILES) {
      const filePath = path.join(wmDir, file);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, '');
      }
    }

    // v0.60.0 Phase 2: persist the opt-in choice into `.chamber.json` so
    // MindMemoryService.activateMind reads it back on the very next mind
    // load. We only WRITE this file on opt-in — opt-out is the default
    // shape returned by chamberMindConfig when the file is absent, so an
    // empty marker file would be wasted I/O AND signal intent the user
    // never expressed.
    if (enableDreamDaemon) {
      const chamberJsonPath = path.join(mindPath, '.chamber.json');
      const chamberConfig = {
        workingMemory: {
          consolidation: { enabled: true },
        },
      };
      fs.writeFileSync(chamberJsonPath, JSON.stringify(chamberConfig, null, 2) + '\n');
    }
  }

  private async generateSoul(mindPath: string, config: GenesisConfig, slug: string): Promise<void> {
    const client = await this.clientFactory.createClient(mindPath);

    const soulPath = path.join(mindPath, 'SOUL.md');
    const agentPath = path.join(mindPath, '.github', 'agents', `${slug}.agent.md`);
    const memoryPath = path.join(mindPath, '.working-memory', 'memory.md');
    const rulesPath = path.join(mindPath, '.working-memory', 'rules.md');
    const indexPath = path.join(mindPath, 'mind-index.md');

    // log.md is intentionally NOT a prompt target. It is pre-seeded with the
    // chamber-structured-log/v1 sentinel by createStructure() and reserved for
    // structured CompletedTurn frames written by DailyLogWriter.
    const prompt = buildGenesisPrompt({
      name: config.name,
      role: config.role,
      voiceDescription: config.voiceDescription,
      paths: { soul: soulPath, agent: agentPath, memory: memoryPath, rules: rulesPath, index: indexPath },
    });

    const sessionConfig: Record<string, unknown> = {
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: approveForSessionCompat,
    };

    const session = await client.createSession(
      sessionConfig as unknown as Parameters<typeof client.createSession>[0]
    );

    // Issue #131 checklist 4: rely on `approveForSessionCompat` returning
    // `approve-for-session` decisions for read/write/memory and `approve-once`
    // for the rest, instead of short-circuiting through setApproveAll. The
    // handler-driven path keeps genesis fully auto-approved while exposing
    // the request stream so future PRs can surface activity to the UI.

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
      await session.disconnect().catch(() => { /* noop */ });
      await this.clientFactory.destroyClient(client);
    }
  }

  private initGit(mindPath: string): void {
    try {
      MindScaffold.writeChamberGitignore(mindPath, { createChamberDirectory: true });
      execSync('git init', { cwd: mindPath, stdio: 'ignore' });
      execSync('git add -A', { cwd: mindPath, stdio: 'ignore' });
      execSync('git commit -m "Genesis"', { cwd: mindPath, stdio: 'ignore' });
    } catch (err) {
      log.error('Git init failed:', err);
    }
  }

  private static writeChamberGitignore(
    mindPath: string,
    options: { createChamberDirectory: boolean },
  ): boolean {
    const chamberPath = path.join(mindPath, '.chamber');
    if (!fs.existsSync(chamberPath)) {
      if (!options.createChamberDirectory) return false;
      fs.mkdirSync(chamberPath, { recursive: true });
    }

    const gitignorePath = path.join(chamberPath, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      const entries = content.split(/\r?\n/).map((line) => line.trim());
      const missingEntries = CHAMBER_GITIGNORE_ENTRIES.filter((entry) => !entries.includes(entry));
      if (missingEntries.length === 0) return false;

      const separator = content.length === 0 || content.endsWith('\n') ? '' : '\n';
      fs.writeFileSync(gitignorePath, `${content}${separator}${missingEntries.join('\n')}\n`);
      return true;
    }

    fs.writeFileSync(gitignorePath, CHAMBER_GITIGNORE_CONTENT);
    return true;
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
      throw new Error(`Upgrade skill not found in ${GENESIS_SOURCE}@${GENESIS_CHANNEL}`);
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
