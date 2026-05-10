import { describe, expect, it } from 'vitest';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext, stripInjectedCurrentDateTimeContext } from './currentDateTimeContext';

describe('currentDateTimeContext', () => {
  it('formats the current datetime as ISO with the local timezone name', () => {
    const context = getCurrentDateTimeContext(new Date('2026-05-05T15:37:12.065Z'));

    expect(context.currentDateTime).toBe('2026-05-05T15:37:12.065Z');
    expect(context.timezone.length).toBeGreaterThan(0);
  });

  it('injects datetime context before the user prompt', () => {
    expect(injectCurrentDateTimeContext('hello', {
      currentDateTime: '2026-05-05T15:37:12.065Z',
      timezone: 'America/New_York',
    })).toBe('<current_datetime>\n2026-05-05T15:37:12.065Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nhello');
  });

  it('keeps A2A agent-message prompts as a single XML root', () => {
    expect(injectCurrentDateTimeContext('<agent-message role="user">\n  <content>hello</content>\n</agent-message>', {
      currentDateTime: '2026-05-05T15:37:12.065Z',
      timezone: 'America/New_York',
    })).toBe('<agent-message role="user">\n  <current_datetime>2026-05-05T15:37:12.065Z</current_datetime>\n  <timezone>America/New_York</timezone>\n  <content>hello</content>\n</agent-message>');
  });

  it('strips injected datetime context from persisted user prompts', () => {
    const hydrated = '<current_datetime>\n2026-05-07T03:19:51.220Z\n</current_datetime>\n<timezone>\nAmerica/New_York\n</timezone>\n\nyou should add another comment to the gh issue 125';

    expect(stripInjectedCurrentDateTimeContext(hydrated)).toBe('you should add another comment to the gh issue 125');
  });

  it('leaves ordinary prompts untouched when no injected datetime prefix exists', () => {
    expect(stripInjectedCurrentDateTimeContext('hello Q')).toBe('hello Q');
  });
});
