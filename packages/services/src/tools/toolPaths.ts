import os from 'node:os';
import path from 'node:path';

export function getChamberToolsBinDir(): string {
  const configRoot = process.env.CHAMBER_E2E_USER_DATA ?? path.join(os.homedir(), '.chamber');
  return path.join(configRoot, 'tools', 'bin');
}
