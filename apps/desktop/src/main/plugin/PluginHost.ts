import type { ChamberMainPlugin, MainPluginContext, PluginLogLevel } from '@chamber/plugin-api';

/** Dynamically imports a module by specifier. Injected so tests can supply fakes. */
export type ModuleImporter = (specifier: string) => Promise<unknown>;

/** Structured logger the host uses for its own diagnostics. */
export type PluginHostLogger = (level: PluginLogLevel, message: string, ...args: unknown[]) => void;

function asMainPlugin(module: unknown): ChamberMainPlugin | null {
  const candidate =
    module && typeof module === 'object' && 'default' in module
      ? (module as { default: unknown }).default
      : module;
  if (
    candidate
    && typeof candidate === 'object'
    && typeof (candidate as ChamberMainPlugin).id === 'string'
    && typeof (candidate as ChamberMainPlugin).registerMain === 'function'
  ) {
    return candidate as ChamberMainPlugin;
  }
  return null;
}

/**
 * Loads an optional trusted main-process plugin and invokes its `registerMain`
 * hook exactly once. Every failure is logged and swallowed so a misbehaving
 * plugin can never block Chamber boot. When no specifier is configured this is a
 * no-op.
 *
 * The plugin is resolved by dynamic import of a build-time-trusted specifier
 * (package name or absolute path), kept deliberately narrow so the security
 * boundary stays auditable.
 */
export class PluginHost {
  constructor(
    private readonly importModule: ModuleImporter,
    private readonly log: PluginHostLogger,
  ) {}

  async load(specifier: string | undefined, context: MainPluginContext): Promise<ChamberMainPlugin | null> {
    const target = specifier?.trim();
    if (!target) {
      return null;
    }
    try {
      const loaded = await this.importModule(target);
      const plugin = asMainPlugin(loaded);
      if (!plugin) {
        this.log('warn', `Chamber plugin "${target}" did not export a valid main plugin; ignoring.`);
        return null;
      }
      await plugin.registerMain(context);
      this.log('info', `Chamber plugin "${plugin.id}" registered.`);
      return plugin;
    } catch (error) {
      this.log('error', `Chamber plugin "${target}" failed to load; continuing without it.`, error);
      return null;
    }
  }
}
