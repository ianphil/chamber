import { describe, expect, it } from 'vitest';
import { SdkModelListContractError, mapSdkModelList } from './sdkModelMapper';

describe('sdkModelMapper', () => {
  it('maps the SDK model fields Chamber exposes', () => {
    expect(mapSdkModelList([
      { id: 'gpt-5.4', name: 'GPT-5.4', extra: true },
    ])).toEqual([
      { id: 'gpt-5.4', name: 'GPT-5.4' },
    ]);
  });

  it('rejects SDK model-list drift that would break Chamber model selection', () => {
    expect(() => mapSdkModelList([
      { modelId: 'gpt-5.4', displayName: 'GPT-5.4' },
    ])).toThrow(SdkModelListContractError);

    expect(() => mapSdkModelList({ id: 'gpt-5.4', name: 'GPT-5.4' })).toThrow(
      'SDK contract mismatch for client.listModels',
    );
  });
});
