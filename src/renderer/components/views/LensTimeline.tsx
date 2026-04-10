import React from 'react';

interface Props {
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

export function LensTimeline({ data, schema }: Props) {
  const items = Array.isArray(data) ? data as Record<string, unknown>[] : [data];

  return (
    <div className="relative space-y-0">
      {/* Vertical line */}
      <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />

      {items.map((item, i) => {
        const title = String(item.title ?? item.name ?? item.event ?? `Entry ${i + 1}`);
        const time = item.time ?? item.timestamp ?? item.date ?? item.created_at ?? null;
        const description = item.description ?? item.message ?? item.content ?? null;
        const status = item.status ? String(item.status) : null;

        return (
          <div key={i} className="relative flex gap-4 py-3">
            {/* Dot */}
            <div className="relative z-10 mt-1.5 w-2 h-2 rounded-full bg-muted-foreground shrink-0 ml-2" />

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium truncate">{title}</p>
                {status && (
                  <span className="text-xs text-muted-foreground">· {status}</span>
                )}
              </div>
              {time && (
                <p className="text-xs text-muted-foreground">{String(time)}</p>
              )}
              {description && (
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{String(description)}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
