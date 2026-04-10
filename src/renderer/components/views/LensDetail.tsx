import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { formatTitle, formatDisplayValue } from '../../lib/utils';

interface Props {
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

export function LensDetail({ data, schema }: Props) {
  const schemaProps = (schema as { properties?: Record<string, { title?: string }> })?.properties;
  const title = String(data.name ?? data.title ?? data.id ?? 'Detail');
  const description = data.description ? String(data.description) : null;
  const status = data.status ? String(data.status) : null;

  // Show everything except title/description/status as metadata
  const metaKeys = Object.keys(data).filter(k => !['name', 'title', 'id', 'description', 'status'].includes(k));

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">{title}</CardTitle>
          {status && (
            <Badge variant={status.toLowerCase().includes('active') || status.toLowerCase().includes('online') ? 'default' : 'secondary'}>
              {status}
            </Badge>
          )}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        )}
      </CardHeader>
      {metaKeys.length > 0 && (
        <CardContent className="space-y-2">
          {metaKeys.map((key) => {
            const value = data[key];
            const label = schemaProps?.[key]?.title ?? formatTitle(key);
            const display = formatDisplayValue(value);

            return (
              <div key={key} className="flex justify-between items-start text-sm gap-4">
                <span className="text-muted-foreground shrink-0">{label}</span>
                <span className="font-medium text-right break-words min-w-0">{display}</span>
              </div>
            );
          })}
        </CardContent>
      )}
    </Card>
  );
}
