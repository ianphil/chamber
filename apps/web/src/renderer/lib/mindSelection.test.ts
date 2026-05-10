import { describe, expect, it } from 'vitest';
import type { MindContext } from '@chamber/shared/types';
import { normalizeMindPath, selectPreferredMind } from './mindSelection';

const upperPosixMind: MindContext = {
  mindId: 'upper',
  mindPath: '/agents/Foo',
  identity: { name: 'Foo', systemMessage: '' },
  status: 'ready',
};

const lowerPosixMind: MindContext = {
  mindId: 'lower',
  mindPath: '/agents/foo',
  identity: { name: 'foo', systemMessage: '' },
  status: 'ready',
};

describe('mindSelection', () => {
  it('does not collapse distinct POSIX paths by case', () => {
    expect(normalizeMindPath('/agents/Foo')).toBe('/agents/Foo');
    expect(normalizeMindPath('/agents/foo')).toBe('/agents/foo');

    expect(selectPreferredMind([upperPosixMind, lowerPosixMind], { mindPath: '/agents/foo' })?.mindId).toBe('lower');
  });

  it('case-folds Windows-style paths', () => {
    expect(normalizeMindPath('C:\\Agents\\Foo\\')).toBe('c:/agents/foo');
  });
});
