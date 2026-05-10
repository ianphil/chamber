import React from 'react';
import { cn } from '../../lib/utils';

interface AgentAvatarProps {
  name: string;
  avatarDataUrl?: string | null;
  className: string;
  fallbackClassName?: string;
  fallback?: React.ReactNode;
  style?: React.CSSProperties;
}

export function AgentAvatar({ name, avatarDataUrl, className, fallbackClassName, fallback, style }: AgentAvatarProps) {
  if (avatarDataUrl) {
    return (
      <img
        src={avatarDataUrl}
        alt={`${name} avatar`}
        className={cn(className, 'object-cover')}
      />
    );
  }

  return (
    <div className={cn(className, fallbackClassName)} style={style}>
      {fallback ?? name.trim().charAt(0).toUpperCase()}
    </div>
  );
}
