import React, { useEffect, useState } from 'react';
import { FolderOpen, RefreshCw, Route, Send, Square, Trash2, Users } from 'lucide-react';
import type { SquadRoomEvent, SquadRoomMessage, SquadRoomSnapshot } from '@chamber/shared/squad-types';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import squadLogo from '../../assets/squad-logo.png';

const emptySnapshot: SquadRoomSnapshot = {
  id: 'unselected',
  repoPath: null,
  repoName: null,
  squadPath: null,
  status: 'unselected',
  version: null,
  coordinator: null,
  agents: [],
  routingRules: [],
  decisions: [],
  directives: null,
  sessions: [],
  lastError: null,
};

export function SquadRoomPanel() {
  const [room, setRoom] = useState<SquadRoomSnapshot>(emptySnapshot);
  const [repoPathInput, setRepoPathInput] = useState('');
  const [messages, setMessages] = useState<SquadRoomMessage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [targetAgentName, setTargetAgentName] = useState('');
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return window.electronAPI.squad.onEvent((event) => {
      setMessages((current) => applySquadEvent(current, event));
      if (event.type === 'message-start' || event.type === 'message-delta') setActiveTurnId(event.type === 'message-start' ? event.message.turnId : event.turnId);
      if (event.type === 'message-complete' || event.type === 'canceled' || event.type === 'error') setActiveTurnId(null);
      if (event.type === 'error') setError(event.message);
    });
  }, []);

  const loadRoom = async (repoPath: string) => {
    setBusy(true);
    setError(null);
    try {
      const snapshot = await window.electronAPI.squad.getRoom(repoPath);
      setRoom(snapshot);
      if (snapshot.repoPath) setRepoPathInput(snapshot.repoPath);
      if (snapshot.status === 'ready') {
        setMessages(await window.electronAPI.squad.history(snapshot.id));
      } else {
        setMessages([]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const chooseRepository = async () => {
    setBusy(true);
    setError(null);
    try {
      const snapshot = await window.electronAPI.squad.selectRepository();
      if (snapshot) {
        setRoom(snapshot);
        if (snapshot.repoPath) setRepoPathInput(snapshot.repoPath);
        if (snapshot.status === 'ready') {
          setMessages(await window.electronAPI.squad.history(snapshot.id));
        } else {
          setMessages([]);
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (!room.repoPath) return;
    await loadRoom(room.repoPath);
  };

  const sendPrompt = async () => {
    if (!room.repoPath || !prompt.trim()) return;
    const content = prompt.trim();
    setPrompt('');
    setSending(true);
    setError(null);
    const userMessage: SquadRoomMessage = {
      id: `pending-${Date.now()}`,
      roomId: room.id,
      turnId: null,
      role: 'user',
      sender: { kind: 'user', id: 'user', name: 'User' },
      content,
      timestamp: Date.now(),
    };
    setMessages((current) => [...current, userMessage]);
    try {
      const result = await window.electronAPI.squad.send({
        roomId: room.id,
        repoPath: room.repoPath,
        prompt: content,
        ...(targetAgentName ? { targetAgentName } : {}),
      });
      if (!result.success) {
        setError(result.error);
      } else {
        setMessages(await window.electronAPI.squad.history(room.id));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
      setActiveTurnId(null);
    }
  };

  const stopActiveTurn = async () => {
    if (!activeTurnId) return;
    await window.electronAPI.squad.stop(activeTurnId);
    setActiveTurnId(null);
  };

  const clearTranscript = async () => {
    await window.electronAPI.squad.clear(room.id);
    setMessages([]);
  };

  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-3 text-blue-300">
              <img src={squadLogo} alt="" className="h-12 w-12 object-contain brightness-0 invert" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Squad Room</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Open a repository-backed Squad team and inspect its roster, routing, decisions, and sessions.
              </p>
            </div>
          </div>
          <StatusBadge room={room} />
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Repository</CardTitle>
            <CardDescription>Select a repo that contains a .squad directory.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 md:flex-row">
              <input
                aria-label="Repository path"
                className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                placeholder="C:\\src\\cmux"
                value={repoPathInput}
                onChange={(event) => setRepoPathInput(event.target.value)}
              />
              <button
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy}
                onClick={chooseRepository}
              >
                <FolderOpen size={16} />
                Choose repo
              </button>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !repoPathInput.trim()}
                onClick={() => loadRoom(repoPathInput.trim())}
              >
                Load
              </button>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || !room.repoPath}
                onClick={refresh}
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>
            {(error || room.lastError) && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-red-200">
                {error ?? room.lastError}
              </div>
            )}
          </CardContent>
        </Card>

        {room.status === 'unselected' && <EmptyState />}
        {room.status === 'missing' && <MissingState room={room} />}
        {room.status === 'ready' && (
          <ReadyState
            room={room}
            messages={messages}
            prompt={prompt}
            targetAgentName={targetAgentName}
            sending={sending}
            activeTurnId={activeTurnId}
            onPromptChange={setPrompt}
            onTargetAgentChange={setTargetAgentName}
            onSend={sendPrompt}
            onStop={stopActiveTurn}
            onClear={clearTranscript}
          />
        )}
      </div>
    </div>
  );
}

function StatusBadge({ room }: { room: SquadRoomSnapshot }) {
  const variant = room.status === 'ready' ? 'default' : room.status === 'error' ? 'destructive' : 'outline';
  const label = room.status === 'unselected'
    ? 'No repo selected'
    : room.status === 'missing'
      ? 'No .squad found'
      : room.status === 'ready'
        ? 'Ready'
        : 'Error';
  return <Badge variant={variant}>{label}</Badge>;
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
      <h2 className="text-lg font-semibold">Choose a repository to open a Squad Room</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
        Chamber will inspect the repo&apos;s .squad directory and render the team state without starting any agents.
      </p>
    </div>
  );
}

function MissingState({ room }: { room: SquadRoomSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No Squad setup found</CardTitle>
        <CardDescription>{room.repoPath}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This repository does not have a .squad directory yet. Run Squad init in the repo to create one, then refresh this room.
        </p>
      </CardContent>
    </Card>
  );
}

function ReadyState({
  room,
  messages,
  prompt,
  targetAgentName,
  sending,
  activeTurnId,
  onPromptChange,
  onTargetAgentChange,
  onSend,
  onStop,
  onClear,
}: {
  room: SquadRoomSnapshot;
  messages: SquadRoomMessage[];
  prompt: string;
  targetAgentName: string;
  sending: boolean;
  activeTurnId: string | null;
  onPromptChange: (value: string) => void;
  onTargetAgentChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
}) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
      <main className="flex flex-col gap-6">
        <MessagingPanel
          room={room}
          messages={messages}
          prompt={prompt}
          targetAgentName={targetAgentName}
          sending={sending}
          activeTurnId={activeTurnId}
          onPromptChange={onPromptChange}
          onTargetAgentChange={onTargetAgentChange}
          onSend={onSend}
          onStop={onStop}
          onClear={onClear}
        />

        <Card>
          <CardHeader>
            <CardTitle>{room.repoName}</CardTitle>
            <CardDescription>{room.repoPath}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm md:grid-cols-3">
            <Metric label="Squad path" value={room.squadPath ?? 'None'} />
            <Metric label="Config version" value={room.version === null ? 'Unknown' : String(room.version)} />
            <Metric label="Saved sessions" value={String(room.sessions.length)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users size={18} /> Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {room.coordinator && <AgentRow label="Coordinator" agent={room.coordinator} />}
            {room.agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No Squad members are listed yet.</p>
            ) : (
              room.agents.map((agent) => <AgentRow key={`${agent.name}:${agent.role}`} label="Member" agent={agent} />)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Route size={18} /> Routing</CardTitle>
          </CardHeader>
          <CardContent>
            {room.routingRules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No routing rules found.</p>
            ) : (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Work type</th>
                      <th className="px-3 py-2 text-left font-medium">Route to</th>
                      <th className="px-3 py-2 text-left font-medium">Examples</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {room.routingRules.map((rule) => (
                      <tr key={`${rule.workType}:${rule.routeTo}`}>
                        <td className="px-3 py-2">{rule.workType}</td>
                        <td className="px-3 py-2">{rule.routeTo}</td>
                        <td className="px-3 py-2 text-muted-foreground">{rule.examples}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Decisions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {room.decisions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No decisions recorded yet.</p>
            ) : (
              room.decisions.map((decision) => (
                <div key={decision.title} className="rounded-lg border border-border p-3">
                  <div className="font-medium">{decision.title}</div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{decision.body}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Directives</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              {room.directives?.trim() || 'No directives.md file found.'}
            </pre>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function MessagingPanel({
  room,
  messages,
  prompt,
  targetAgentName,
  sending,
  activeTurnId,
  onPromptChange,
  onTargetAgentChange,
  onSend,
  onStop,
  onClear,
}: {
  room: SquadRoomSnapshot;
  messages: SquadRoomMessage[];
  prompt: string;
  targetAgentName: string;
  sending: boolean;
  activeTurnId: string | null;
  onPromptChange: (value: string) => void;
  onTargetAgentChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Conversation</CardTitle>
            <CardDescription>Send a prompt to the Squad coordinator or a named member.</CardDescription>
          </div>
          <button
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={messages.length === 0}
            onClick={onClear}
          >
            <Trash2 size={16} />
            Clear
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex max-h-96 min-h-40 flex-col gap-3 overflow-auto rounded-lg border border-border bg-background p-3">
          {messages.length === 0 ? (
            <p className="m-auto text-sm text-muted-foreground">No Squad messages yet.</p>
          ) : (
            messages.map((message) => <MessageBubble key={message.id} message={message} />)
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-[12rem_1fr_auto]">
          <select
            aria-label="Target Squad agent"
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            value={targetAgentName}
            onChange={(event) => onTargetAgentChange(event.target.value)}
          >
            <option value="">Coordinator</option>
            {room.agents.map((agent) => (
              <option key={agent.name} value={agent.name}>{agent.name}</option>
            ))}
          </select>
          <textarea
            aria-label="Squad prompt"
            className="min-h-20 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
            placeholder="Ask the Squad what to do next..."
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
          />
          <div className="flex flex-col gap-2">
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              disabled={sending || !prompt.trim()}
              onClick={onSend}
            >
              <Send size={16} />
              Send
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!activeTurnId}
              onClick={onStop}
            >
              <Square size={16} />
              Stop
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MessageBubble({ message }: { message: SquadRoomMessage }) {
  const align = message.role === 'user' ? 'self-end bg-primary text-primary-foreground' : 'self-start bg-muted text-foreground';
  return (
    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${align}`}>
      <div className="mb-1 text-xs opacity-75">{message.sender.name}</div>
      <div className="whitespace-pre-wrap">{message.content || (message.isStreaming ? '...' : '')}</div>
    </div>
  );
}

function AgentRow({ label, agent }: { label: string; agent: { name: string; role: string; charterPath: string | null; status: string | null } }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{agent.name}</span>
          <Badge variant="outline">{label}</Badge>
        </div>
        <div className="mt-1 text-sm text-muted-foreground">{agent.role}</div>
        {agent.charterPath && <div className="mt-1 text-xs text-muted-foreground">{agent.charterPath}</div>}
      </div>
      {agent.status && <Badge variant="secondary">{agent.status}</Badge>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-medium" title={value}>{value}</div>
    </div>
  );
}

function applySquadEvent(messages: SquadRoomMessage[], event: SquadRoomEvent): SquadRoomMessage[] {
  if (event.type === 'message-start') {
    return upsertMessage(messages, event.message);
  }
  if (event.type === 'message-delta') {
    return messages.map((message) => message.id === event.messageId
      ? { ...message, content: `${message.content}${event.delta}`, isStreaming: true }
      : message);
  }
  if (event.type === 'message-complete') {
    return messages.map((message) => message.id === event.messageId
      ? { ...message, content: event.content, isStreaming: false }
      : message);
  }
  return messages;
}

function upsertMessage(messages: SquadRoomMessage[], next: SquadRoomMessage): SquadRoomMessage[] {
  return messages.some((message) => message.id === next.id)
    ? messages.map((message) => message.id === next.id ? next : message)
    : [...messages, next];
}
