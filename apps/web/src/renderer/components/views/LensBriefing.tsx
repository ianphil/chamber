import React from 'react';
import {
  Inbox,
  Target,
  Globe,
  Calendar,
  MessageSquare,
  Mail,
  Bot,
  Brain,
  Wrench,
  CircleDot,
  Puzzle,
  BarChart3,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { formatTitle, formatDisplayValue } from '../../lib/utils';

interface Props {
  data: Record<string, unknown>;
  schema?: Record<string, unknown>;
}

const iconMap: Record<string, LucideIcon> = {
  inbox: Inbox,
  initiatives: Target,
  initiative: Target,
  domains: Globe,
  domain: Globe,
  calendar: Calendar,
  meetings: Calendar,
  teams: MessageSquare,
  email: Mail,
  agent: Bot,
  model: Brain,
  extensions: Wrench,
  status: CircleDot,
  mind: Puzzle,
  count: BarChart3,
};

function getIcon(key: string): LucideIcon {
  const lower = key.toLowerCase();
  for (const [keyword, Icon] of Object.entries(iconMap)) {
    if (lower.includes(keyword)) return Icon;
  }
  return ClipboardList;
}

 
export function LensBriefing({ data, schema }: Props) {
  const keys = Object.keys(data);
  const schemaProps = (schema as { properties?: Record<string, { title?: string }> })?.properties;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {keys.map((key) => {
        const value = data[key];
        const label = schemaProps?.[key]?.title ?? formatTitle(key);
        const Icon = getIcon(key);
        const isNumber = typeof value === 'number';

        return (
          <Card key={key} className="surface-card border-border bg-card">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {isNumber ? (
                <p className="text-3xl font-semibold leading-none tabular-nums tracking-tight text-foreground">{value}</p>
              ) : (
                <p className="text-sm font-medium leading-relaxed text-foreground/90">{formatDisplayValue(value)}</p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
