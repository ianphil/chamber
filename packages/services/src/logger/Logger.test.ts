import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from './Logger';

describe('Logger', () => {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

  beforeEach(() => {
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
    Logger.resetLevel();
  });

  afterEach(() => {
    Logger.resetLevel();
  });

  it('prefixes output with the tag', () => {
    Logger.setLevel('debug');
    const log = Logger.create('Auth');
    log.info('logged in');
    expect(logSpy).toHaveBeenCalledWith('[Auth]', 'logged in');
  });

  it('routes warn and error to the correct console methods', () => {
    const log = Logger.create('Tray');
    log.warn('icon missing');
    log.error('crash');
    expect(warnSpy).toHaveBeenCalledWith('[Tray]', 'icon missing');
    expect(errorSpy).toHaveBeenCalledWith('[Tray]', 'crash');
  });

  it('suppresses debug messages at the default info level', () => {
    Logger.setLevel('info');
    const log = Logger.create('SDK');
    log.debug('verbose detail');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('shows debug messages when level is set to debug', () => {
    Logger.setLevel('debug');
    const log = Logger.create('SDK');
    log.debug('verbose detail');
    expect(logSpy).toHaveBeenCalledWith('[SDK]', 'verbose detail');
  });

  it('suppresses all output when level is silent', () => {
    Logger.setLevel('silent');
    const log = Logger.create('Test');
    log.debug('a');
    log.info('b');
    log.warn('c');
    log.error('d');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('only shows error when level is error', () => {
    Logger.setLevel('error');
    const log = Logger.create('Strict');
    log.info('ignored');
    log.warn('ignored');
    log.error('shown');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[Strict]', 'shown');
  });

  it('passes multiple arguments through', () => {
    const log = Logger.create('Multi');
    const obj = { key: 'value' };
    log.info('data:', obj, 42);
    expect(logSpy).toHaveBeenCalledWith('[Multi]', 'data:', obj, 42);
  });
});
