/** Severity levels Chamber's structured logger understands. */
export type PluginLogLevel = 'info' | 'warn' | 'error';

/**
 * Capabilities Chamber hands to a main-process plugin during startup. The
 * surface is intentionally small and grows only as concrete override needs are
 * proven, so the trusted-plugin handoff stays easy to audit.
 *
 * This is a default-narrow handoff, not a sandbox: a main-process plugin is
 * trusted code loaded by dynamic import and runs with Chamber's full
 * main-process privileges. It can reach Node and Electron on its own; this
 * context only hands it Chamber's blessed entry points for the common case.
 */
export interface MainPluginContext {
  /** Chamber's application version (`app.getVersion()`). */
  readonly appVersion: string;
  /** Absolute path to Chamber's user-data directory. */
  readonly userDataPath: string;
  /** Emit a structured log line through Chamber's logger, scoped to the plugin. */
  log(level: PluginLogLevel, message: string, ...args: unknown[]): void;
}

/**
 * Main-process contribution surface. Loaded by Chamber's composition root via a
 * dynamic import of the configured plugin package, then invoked exactly once.
 */
export interface ChamberMainPlugin {
  /** Stable identifier, surfaced in diagnostics. */
  readonly id: string;
  /**
   * Called once during composition-root startup, after Chamber's own services
   * and IPC adapters are wired. May be async; rejections are logged and
   * swallowed so a failing plugin never blocks Chamber boot.
   */
  registerMain(context: MainPluginContext): void | Promise<void>;
}
