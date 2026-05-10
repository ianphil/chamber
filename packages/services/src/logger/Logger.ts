export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

function resolveThreshold(): LogLevel {
  const env = typeof process !== 'undefined' ? process.env?.CHAMBER_LOG_LEVEL : undefined;
  if (env && env in LEVEL_PRIORITY) return env as LogLevel;
  return 'info';
}

let globalThreshold: LogLevel | null = null;

function getThreshold(): LogLevel {
  if (globalThreshold === null) {
    globalThreshold = resolveThreshold();
  }
  return globalThreshold;
}

export class Logger {
  private constructor(private readonly tag: string) {}

  static create(tag: string): Logger {
    return new Logger(tag);
  }

  static setLevel(level: LogLevel): void {
    globalThreshold = level;
  }

  static resetLevel(): void {
    globalThreshold = null;
  }

  debug(...args: unknown[]): void {
    if (LEVEL_PRIORITY[getThreshold()] <= LEVEL_PRIORITY.debug) {
      console.log(`[${this.tag}]`, ...args);
    }
  }

  info(...args: unknown[]): void {
    if (LEVEL_PRIORITY[getThreshold()] <= LEVEL_PRIORITY.info) {
      console.log(`[${this.tag}]`, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (LEVEL_PRIORITY[getThreshold()] <= LEVEL_PRIORITY.warn) {
      console.warn(`[${this.tag}]`, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (LEVEL_PRIORITY[getThreshold()] <= LEVEL_PRIORITY.error) {
      console.error(`[${this.tag}]`, ...args);
    }
  }
}
