import { describe, it, expect } from 'vitest';
import { buildChamberPluginModuleSource, chamberPluginVirtualModule } from './chamberPluginVirtualModule';

describe('buildChamberPluginModuleSource', () => {
  it('exports a no-op plugin when no renderer entry is configured', () => {
    const source = buildChamberPluginModuleSource(undefined);
    expect(source).toContain('export default');
    expect(source).toContain('chamber-noop');
    expect(source).not.toContain('export { default } from');
  });

  it('treats a blank or whitespace entry as unconfigured', () => {
    expect(buildChamberPluginModuleSource('   ')).toBe(buildChamberPluginModuleSource(undefined));
  });

  it('re-exports the default from a configured renderer entry', () => {
    const source = buildChamberPluginModuleSource('@genesis/chamber-enterprise/renderer');
    expect(source).toContain('export { default } from "@genesis/chamber-enterprise/renderer"');
  });
});

describe('chamberPluginVirtualModule', () => {
  const resolveIdOf = (plugin: ReturnType<typeof chamberPluginVirtualModule>) =>
    plugin.resolveId as unknown as (id: string) => string | null;
  const loadOf = (plugin: ReturnType<typeof chamberPluginVirtualModule>) =>
    plugin.load as unknown as (id: string) => string | null;

  it('resolves the virtual module id to a stable internal id and ignores others', () => {
    const plugin = chamberPluginVirtualModule(undefined);
    const resolveId = resolveIdOf(plugin);
    expect(resolveId.call(plugin, 'virtual:chamber-plugin')).toBe('\0virtual:chamber-plugin');
    expect(resolveId.call(plugin, 'some-other-module')).toBeNull();
  });

  it('loads the no-op source for the resolved id and ignores others', () => {
    const plugin = chamberPluginVirtualModule(undefined);
    const load = loadOf(plugin);
    expect(load.call(plugin, '\0virtual:chamber-plugin')).toContain('chamber-noop');
    expect(load.call(plugin, 'something-else')).toBeNull();
  });

  it('loads the enterprise re-export when a renderer entry is configured', () => {
    const plugin = chamberPluginVirtualModule('/abs/enterprise/renderer.tsx');
    const load = loadOf(plugin);
    expect(load.call(plugin, '\0virtual:chamber-plugin')).toContain(
      'export { default } from "/abs/enterprise/renderer.tsx"',
    );
  });
});
