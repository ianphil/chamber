import { DEMO_SCENARIOS, type DemoScenario } from './chatroomScenarios';

interface ChatroomSessionPickerProps {
  hasSessions: boolean;
  mindCount: number;
  onPickPrompt: (prompt: string, mode: DemoScenario['mode']) => void;
  onGoToChat: () => void;
}

export function ChatroomSessionPicker({ hasSessions, mindCount, onPickPrompt, onGoToChat }: ChatroomSessionPickerProps) {
  const noAgents = mindCount === 0;
  const singleAgent = mindCount === 1;

  return (
    <div className="chamber-fade-in flex-1 flex flex-col items-center justify-center px-4 gap-5 overflow-y-auto py-6">
      <div className="max-w-md space-y-2 text-center">
        <h2 className="text-base font-semibold text-foreground">
          {noAgents
            ? 'Add an agent to start a chatroom'
            : hasSessions
              ? 'Pick a chatroom on the right, or start a new one'
              : 'Start your first chatroom'}
        </h2>
        <p className="text-xs text-muted-foreground">
          {noAgents
            ? 'Chatrooms run a prompt across multiple agents at once. Add an agent first, then come back here.'
            : 'Pick a pattern below or type a message in the composer to start fresh. The chatroom is created on your first send, so you can change your mind before committing.'}
        </p>
      </div>

      {singleAgent ? (
        <div className="max-w-md rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-left text-xs text-amber-100">
          <p className="font-medium text-amber-50">You only have one agent loaded.</p>
          <p className="mt-1 opacity-90">
            Chatrooms shine with two or more agents (debate, handoff, manager-led
            workflows). With just one agent, this behaves the same as a regular
            chat - which Chat already does better.
          </p>
          <button
            type="button"
            onClick={onGoToChat}
            className="mt-2 rounded-md border border-amber-500/40 px-2.5 py-1 text-xs text-amber-50 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Open Chat instead
          </button>
        </div>
      ) : null}

      {!noAgents ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
          {DEMO_SCENARIOS.map((scenario) => {
            const Icon = scenario.icon;
            return (
              <button
                key={scenario.label}
                onClick={() => onPickPrompt(scenario.prompt, scenario.mode)}
                title={scenario.summary}
                className="text-left px-3 py-2.5 rounded-lg border border-border bg-secondary/40 hover:bg-secondary/70 hover:border-border transition-colors group"
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
      ) : null}
    </div>
  );
}
