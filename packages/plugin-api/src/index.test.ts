import { describe, it, expect, expectTypeOf } from 'vitest';
import {
  defineMainPlugin,
  defineRendererPlugin,
  type ChamberMainPlugin,
  type ChamberRendererPlugin,
  type MainPluginContext,
  type OnboardingProps,
  type OnboardingProvider,
  type PluginLogLevel,
} from './index';

describe('defineRendererPlugin', () => {
  it('returns the same plugin object (identity helper)', () => {
    const plugin: ChamberRendererPlugin = { id: 'x' };
    expect(defineRendererPlugin(plugin)).toBe(plugin);
  });

  it('allows declaring only the overridden surfaces', () => {
    const onboarding: OnboardingProvider = () => null;
    const plugin = defineRendererPlugin({ id: 'x', onboarding });
    expect(plugin.onboarding).toBe(onboarding);
  });
});

describe('defineMainPlugin', () => {
  it('returns the same plugin object (identity helper)', () => {
    const plugin: ChamberMainPlugin = { id: 'm', registerMain: () => {} };
    expect(defineMainPlugin(plugin)).toBe(plugin);
  });
});

describe('plugin API contracts', () => {
  it('OnboardingProps exposes a void onComplete callback', () => {
    expectTypeOf<OnboardingProps['onComplete']>().toEqualTypeOf<() => void>();
  });

  it('renderer onboarding is optional', () => {
    expectTypeOf<ChamberRendererPlugin['onboarding']>().toEqualTypeOf<OnboardingProvider | undefined>();
  });

  it('main context carries version, data path, and a leveled logger', () => {
    expectTypeOf<MainPluginContext['appVersion']>().toEqualTypeOf<string>();
    expectTypeOf<MainPluginContext['userDataPath']>().toEqualTypeOf<string>();
    expectTypeOf<PluginLogLevel>().toEqualTypeOf<'info' | 'warn' | 'error'>();
  });

  it('registerMain takes the context and may be sync or async', () => {
    expectTypeOf<ChamberMainPlugin['registerMain']>().parameter(0).toEqualTypeOf<MainPluginContext>();
    expectTypeOf<ReturnType<ChamberMainPlugin['registerMain']>>().toEqualTypeOf<void | Promise<void>>();
  });
});
