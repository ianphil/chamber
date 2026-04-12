import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { generateMindId } from '../mind/generateMindId';
import type { AppConfig, AppConfigV1, MindRecord } from '../../../shared/types';

const CONFIG_DIR = path.join(os.homedir(), '.chamber');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: AppConfig = { version: 2, minds: [], activeMindId: null, theme: 'dark' };

export class ConfigService {
  /** @deprecated Use generateMindId() from mind/generateMindId instead */
  static generateMindId = generateMindId;

  load(): AppConfig {
    try {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const raw = JSON.parse(data);
      return this.normalize(raw);
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  save(config: AppConfig): void {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  }

  private normalize(raw: Record<string, unknown>): AppConfig {
    if (raw.version === 2) {
      return this.deduplicateMinds(raw as AppConfig);
    }
    return this.migrateV1(raw as unknown as AppConfigV1);
  }

  private migrateV1(v1: AppConfigV1): AppConfig {
    if (!v1.mindPath) {
      return { ...DEFAULT_CONFIG, theme: v1.theme ?? 'dark' };
    }
    const id = ConfigService.generateMindId(v1.mindPath);
    return {
      version: 2,
      minds: [{ id, path: v1.mindPath }],
      activeMindId: id,
      theme: v1.theme ?? 'dark',
    };
  }

  private deduplicateMinds(config: AppConfig): AppConfig {
    const seen = new Set<string>();
    const deduped: MindRecord[] = [];
    for (const mind of config.minds) {
      if (!seen.has(mind.path)) {
        seen.add(mind.path);
        deduped.push(mind);
      }
    }
    return { ...config, minds: deduped };
  }
}
