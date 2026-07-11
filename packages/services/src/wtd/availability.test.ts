import { describe, expect, it } from 'vitest';

import { applyWtdRuntimeAvailability } from './availability';

describe('applyWtdRuntimeAvailability', () => {
  it('fails closed when policy enables WTD without a usable runtime', () => {
    const flags = applyWtdRuntimeAvailability({
      switchboardRelay: false,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
      wtdTopology: true,
    }, false);

    expect(flags.wtdTopology).toBe(false);
  });

  it('preserves WTD enablement when policy and runtime agree', () => {
    const flags = applyWtdRuntimeAvailability({
      switchboardRelay: false,
      byoLlm: false,
      chamberCopilot: false,
      voiceDictation: false,
      wtdTopology: true,
    }, true);

    expect(flags.wtdTopology).toBe(true);
  });
});
