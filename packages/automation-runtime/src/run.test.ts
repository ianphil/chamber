import { describe, it, expect } from 'vitest';
import { createDefaultExecutor } from './run';

describe('createDefaultExecutor', () => {
  it('registers handlers for every task type Chamber automations emit', () => {
    const executor = createDefaultExecutor(undefined);
    for (const type of ['bash', 'powershell', 'http', 'chamber:prompt', 'chamber:notify']) {
      expect(executor.isRegistered(type)).toBe(true);
    }
  });

  it('registers a powershell handler so Task.powershell() resolves', () => {
    // Regression: Windows-native CLIs (a365 teams/mail, gh, az) must run via
    // pwsh, not WSL bash. Before this, Task.powershell() had no handler and
    // failed silently at runtime.
    const executor = createDefaultExecutor(undefined);
    expect(executor.isRegistered('powershell')).toBe(true);
  });
});
