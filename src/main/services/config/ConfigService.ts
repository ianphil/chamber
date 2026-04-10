import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AppConfig } from '../../../shared/types';

const CONFIG_DIR = path.join(os.homedir(), '.chamber');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export class ConfigService {
  load(): AppConfig {
    try {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(data);
    } catch {
      return { mindPath: null, theme: 'dark' };
    }
  }

  save(config: AppConfig): void {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  }
}
