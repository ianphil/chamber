// Lightweight browser-compatible Logger matching the @chamber/services Logger API.
// apps/web cannot depend on @chamber/services, so we duplicate the minimal surface.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

let globalThreshold: LogLevel = 'info';

export class Logger {
  private constructor(private readonly tag: string) {}

  static create(tag: string): Logger {
    return new Logger(tag);
  }

  static setLevel(level: LogLevel): void {
    globalThreshold = level;
  }

  debug(...args: unknown[]): void {
    if (LEVEL_PRIORITY[globalThreshold] <= LEVEL_PRIORITY.debug) {
      console.log(`[${this.tag}]`, ...args);
    }
  }

  info(...args: unknown[]): void {
    if (LEVEL_PRIORITY[globalThreshold] <= LEVEL_PRIORITY.info) {
      console.log(`[${this.tag}]`, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (LEVEL_PRIORITY[globalThreshold] <= LEVEL_PRIORITY.warn) {
      console.warn(`[${this.tag}]`, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (LEVEL_PRIORITY[globalThreshold] <= LEVEL_PRIORITY.error) {
      console.error(`[${this.tag}]`, ...args);
    }
  }
}
