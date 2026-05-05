export interface CurrentDateTimeContext {
  currentDateTime: string;
  timezone: string;
}

export type DateTimeContextProvider = () => CurrentDateTimeContext;

export function getCurrentDateTimeContext(date = new Date()): CurrentDateTimeContext {
  return {
    currentDateTime: date.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

export function injectCurrentDateTimeContext(prompt: string, context: CurrentDateTimeContext): string {
  return `<current_datetime>\n${context.currentDateTime}\n</current_datetime>\n<timezone>\n${context.timezone}\n</timezone>\n\n${prompt}`;
}

