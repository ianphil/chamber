import { describe, expect, it } from 'vitest';
import { getCurrentDateTimeContext, injectCurrentDateTimeContext } from './currentDateTimeContext';

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
});
