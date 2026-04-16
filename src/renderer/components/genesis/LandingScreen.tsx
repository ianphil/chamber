import React from 'react';
import { X } from 'lucide-react';

interface Props {
  onNewAgent: () => void;
  onOpenExisting: () => void;
  onClose?: () => void;
}

export function LandingScreen({ onNewAgent, onOpenExisting, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-background flex flex-col items-center justify-center z-50">
      {onClose && (
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute top-4 right-4 w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X size={18} />
        </button>
      )}
      <div className="text-center space-y-8">
        <div className="w-20 h-20 rounded-2xl bg-genesis flex items-center justify-center text-3xl font-bold text-primary-foreground mx-auto">
          C
        </div>

        <div>
          <h1 className="text-3xl font-semibold mb-2">Chamber</h1>
          <p className="text-muted-foreground">Where agents are born and operate.</p>
        </div>

        <div className="flex flex-col gap-3 w-64 mx-auto">
          <button
            onClick={onNewAgent}
            className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <span>✨</span> New Agent
          </button>
          <button
            onClick={onOpenExisting}
            className="px-6 py-3 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center justify-center gap-2"
          >
            <span>📂</span> Open Existing
          </button>
        </div>
      </div>
    </div>
  );
}
