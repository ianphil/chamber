import type { ModelInfo, ModelSelection } from './types';

const COPILOT_MODEL_PREFIX = 'copilot:';
const BYO_MODEL_PREFIX = 'byo:';

export function modelSelectionFromModel(model: ModelInfo): ModelSelection {
  return model.provider === 'byo'
    ? { id: model.id, provider: 'byo' }
    : { id: model.id };
}

export function modelSelectionKey(selection: ModelSelection | null | undefined): string | null {
  if (!selection?.id) return null;
  const prefix = selection.provider === 'byo' ? BYO_MODEL_PREFIX : COPILOT_MODEL_PREFIX;
  return `${prefix}${encodeURIComponent(selection.id)}`;
}

export function modelSelectionKeyFromModel(model: ModelInfo): string {
  const key = modelSelectionKey(modelSelectionFromModel(model));
  if (!key) throw new Error('Model id is required');
  return key;
}

export function parseModelSelectionKey(value: string | null | undefined): ModelSelection | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith(BYO_MODEL_PREFIX)) {
    return parsePrefixedModelSelection(trimmed.slice(BYO_MODEL_PREFIX.length), 'byo');
  }

  if (trimmed.startsWith(COPILOT_MODEL_PREFIX)) {
    return parsePrefixedModelSelection(trimmed.slice(COPILOT_MODEL_PREFIX.length), undefined);
  }

  return { id: trimmed };
}

export function modelSelectionEqualsModel(selection: ModelSelection | null | undefined, model: ModelInfo): boolean {
  if (!selection) return false;
  return selection.id === model.id && selection.provider === model.provider;
}

function parsePrefixedModelSelection(encodedId: string, provider: ModelSelection['provider']): ModelSelection | null {
  try {
    const id = decodeURIComponent(encodedId).trim();
    if (!id) return null;
    return provider === 'byo' ? { id, provider } : { id };
  } catch {
    return null;
  }
}
