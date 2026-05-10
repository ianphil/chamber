import React from 'react';
import { formatTitle, formatDisplayValue } from '../../lib/utils';

interface Props {
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

export function LensForm({ data, schema }: Props) {
  const schemaProps = (schema as { properties?: Record<string, { title?: string }> })?.properties;
  const keys = Object.keys(data);
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      {keys.map((key) => {
        const value = data[key];
        const label = schemaProps?.[key]?.title ?? formatTitle(key);
        const displayValue = formatDisplayValue(value);
        return (
          <div key={key} className="flex justify-between items-start text-sm gap-4">
            <span className="text-muted-foreground shrink-0">{label}</span>
            <span className="font-medium text-right break-words min-w-0">{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
}
