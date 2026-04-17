import { describe, it, expect } from 'vitest';
import { AppConfigSchema } from './appConfig';

describe('appConfig contract', () => {
  it('accepts a valid v2 config', () => {
    const result = AppConfigSchema.safeParse({
      version: 2,
      minds: [{ id: 'mind-1', path: '/tmp/m1' }],
      activeMindId: 'mind-1',
      activeLogin: null,
      theme: 'dark',
    });
    expect(result.success).toBe(true);
  });

  it('rejects v1-shaped configs', () => {
    const result = AppConfigSchema.safeParse({
      version: 1,
      mindPath: '/tmp/m1',
      theme: 'dark',
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown theme', () => {
    expect(
      AppConfigSchema.safeParse({
        version: 2,
        minds: [],
        activeMindId: null,
        activeLogin: null,
        theme: 'neon',
      }).success,
    ).toBe(false);
  });
});
