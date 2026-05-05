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
  const agentMessageOpening = /^<agent-message\b[^>]*>/.exec(prompt)?.[0];
  if (agentMessageOpening) {
    return `${agentMessageOpening}
  <current_datetime>${escapeXml(context.currentDateTime)}</current_datetime>
  <timezone>${escapeXml(context.timezone)}</timezone>${prompt.slice(agentMessageOpening.length)}`;
  }

  return `<current_datetime>\n${context.currentDateTime}\n</current_datetime>\n<timezone>\n${context.timezone}\n</timezone>\n\n${prompt}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
