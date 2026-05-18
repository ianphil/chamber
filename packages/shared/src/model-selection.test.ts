import { describe, expect, it } from 'vitest';
import {
  modelSelectionEqualsModel,
  modelSelectionFromModel,
  modelSelectionKey,
  modelSelectionKeyFromModel,
  parseModelSelectionKey,
} from './model-selection';

describe('model-selection', () => {
  it('serializes cloud and BYO models with distinct provider-aware keys', () => {
    expect(modelSelectionKeyFromModel({ id: 'same/id', name: 'Cloud' })).toBe('copilot:same%2Fid');
    expect(modelSelectionKeyFromModel({ id: 'same/id', name: 'Local', provider: 'byo' })).toBe('byo:same%2Fid');
  });

  it('parses provider-aware keys and treats unprefixed values as cloud model ids', () => {
    expect(parseModelSelectionKey('byo:google%2Fgemma')).toEqual({ id: 'google/gemma', provider: 'byo' });
    expect(parseModelSelectionKey('copilot:claude-opus')).toEqual({ id: 'claude-opus' });
    expect(parseModelSelectionKey('gpt-5.4')).toEqual({ id: 'gpt-5.4' });
  });

  it('returns null for empty or malformed prefixed values', () => {
    expect(parseModelSelectionKey('')).toBeNull();
    expect(parseModelSelectionKey('byo:')).toBeNull();
    expect(parseModelSelectionKey('byo:%E0%A4%A')).toBeNull();
  });

  it('compares model selections by id and provider', () => {
    const byoModel = { id: 'm1', name: 'Local M1', provider: 'byo' as const };
    expect(modelSelectionFromModel(byoModel)).toEqual({ id: 'm1', provider: 'byo' });
    expect(modelSelectionEqualsModel({ id: 'm1', provider: 'byo' }, byoModel)).toBe(true);
    expect(modelSelectionEqualsModel({ id: 'm1' }, byoModel)).toBe(false);
  });

  it('returns null when serializing no selection', () => {
    expect(modelSelectionKey(null)).toBeNull();
    expect(modelSelectionKey(undefined)).toBeNull();
  });
});
