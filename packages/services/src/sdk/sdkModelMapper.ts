import { z } from 'zod';
import type { ModelInfo } from '@chamber/shared/types';

export class SdkModelListContractError extends Error {
  constructor(cause: unknown) {
    super('SDK contract mismatch for client.listModels', { cause });
    this.name = 'SdkModelListContractError';
  }
}

const sdkModel = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough();

const sdkModelList = z.array(sdkModel);

export function mapSdkModelList(models: unknown): ModelInfo[] {
  const parsed = sdkModelList.safeParse(models);
  if (!parsed.success) {
    throw new SdkModelListContractError(parsed.error);
  }
  return parsed.data.map((model) => ({
    id: model.id,
    name: model.name,
  }));
}
