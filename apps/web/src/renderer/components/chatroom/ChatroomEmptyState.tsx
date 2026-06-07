import { DEMO_SCENARIOS, type DemoScenario } from './chatroomScenarios';

// ---------------------------------------------------------------------------
// ChatroomEmptyState
// ---------------------------------------------------------------------------

export function ChatroomEmptyState({ connected, onPickPrompt }: { connected: boolean; onPickPrompt?: (prompt: string, mode: DemoScenario['mode']) => void }) {
  if (!connected) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-sm text-muted-foreground text-center">
          No agents loaded. Add an agent to start chatting.
        </p>
      </div>
    );
  }

  return (
    <div className="chamber-fade-in flex-1 flex flex-col items-center justify-center px-4 gap-6">
      <div className="text-center">
        <h3 className="text-sm font-medium text-foreground mb-1">Work with several agents at once</h3>
        <p className="text-xs text-muted-foreground">Pick how they should collaborate, then ask the room -- or start from a pattern below.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
        {DEMO_SCENARIOS.map((scenario) => {
          const Icon = scenario.icon;
          return (
            <button
              key={scenario.label}
              onClick={() => onPickPrompt?.(scenario.prompt, scenario.mode)}
              title={scenario.summary}
              className="text-left px-3 py-2.5 rounded-lg border border-border bg-secondary/40 transition-[background-color,border-color,box-shadow] duration-150 group hover:bg-secondary/90 hover:border-foreground/20 hover:shadow-sm dark:hover:bg-secondary/70 dark:hover:border-border dark:hover:shadow-none"
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className="shrink-0 text-foreground/70 group-hover:text-foreground" />
                <span className="text-sm font-medium text-foreground group-hover:text-foreground">{scenario.label}</span>
                <span className="text-[10px] text-foreground/50 ml-auto uppercase tracking-wide">{scenario.modeLabel}</span>
              </div>
              <p className="text-xs text-foreground/70 line-clamp-2">{scenario.summary}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
