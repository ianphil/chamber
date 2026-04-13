import React from 'react';

interface Props {
  name: string;
}

export function SenderBadge({ name }: Props) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-genesis bg-genesis/10 rounded-full px-2 py-0.5 mb-1">
      <span>↪</span>
      <span>from {name}</span>
    </span>
  );
}
