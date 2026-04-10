import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { formatTitle } from '../../lib/utils';

interface Props {
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

type StatusVariant = 'default' | 'secondary' | 'destructive' | 'outline';

function getStatusVariant(status: string): StatusVariant {
  const s = status.toLowerCase();
  if (s.includes('ok') || s.includes('running') || s.includes('active') || s.includes('success') || s.includes('healthy')) return 'default';
  if (s.includes('error') || s.includes('fail') || s.includes('down') || s.includes('critical')) return 'destructive';
  if (s.includes('warn') || s.includes('pending') || s.includes('degraded')) return 'outline';
  return 'secondary';
}

function getStatusDot(status: string): string {
  const s = status.toLowerCase();
  if (s.includes('ok') || s.includes('running') || s.includes('active') || s.includes('success') || s.includes('healthy')) return '🟢';
  if (s.includes('error') || s.includes('fail') || s.includes('down') || s.includes('critical')) return '🔴';
  if (s.includes('warn') || s.includes('pending') || s.includes('degraded')) return '🟡';
  return '⚪';
}

export function LensStatusBoard({ data, schema }: Props) {
  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [data];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {rows.map((item, i) => {
        const name = String(item.name ?? item.title ?? item.id ?? `Item ${i + 1}`);
        const status = item.status ? String(item.status) : null;
        const metaKeys = Object.keys(item).filter(k => !['name', 'title', 'id', 'status'].includes(k));

        return (
          <Card key={i} className="bg-card border-border">
            <CardHeader className="pb-2 pt-4 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  {status && <span>{getStatusDot(status)}</span>}
                  {name}
                </CardTitle>
                {status && (
                  <Badge variant={getStatusVariant(status)} className="text-xs">
                    {status}
                  </Badge>
                )}
              </div>
            </CardHeader>
            {metaKeys.length > 0 && (
              <CardContent className="px-4 pb-3 space-y-1">
                {metaKeys.slice(0, 3).map((key) => (
                  <p key={key} className="text-xs text-muted-foreground truncate">
                    {formatTitle(key)}: {String(item[key] ?? '—')}
                  </p>
                ))}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
