import type React from 'react';
import { Layers, ListOrdered, MessagesSquare, GitBranch, ClipboardList } from 'lucide-react';

// ---------------------------------------------------------------------------
// Mode-driven starter scenarios
//
// One per orchestration mode so the empty state demonstrates what each
// collaboration shape *is*, rather than pitching a particular industry.
// Domain-specific demos (manufacturing, fintech, customer-escalation, etc.)
// were swapped out because they hid the underlying primitives.
// ---------------------------------------------------------------------------

export interface DemoScenario {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  modeLabel: string;
  mode: 'concurrent' | 'sequential' | 'group-chat' | 'handoff' | 'magentic';
  prompt: string;
  summary: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    icon: Layers,
    label: 'Brainstorm three angles',
    modeLabel: 'Concurrent',
    mode: 'concurrent',
    summary: 'All agents weigh in on the same question, independently.',
    prompt: 'I want three independent takes on the same question. Each of you, give your best answer to: "What is the most important risk in this plan, and how would you mitigate it?" Do not coordinate with each other.',
  },
  {
    icon: ListOrdered,
    label: 'Outline, draft, polish',
    modeLabel: 'Sequential',
    mode: 'sequential',
    summary: 'Each agent improves the previous agent\'s output.',
    prompt: 'Work as a writing pipeline. The first agent outlines a short briefing on the topic I share next, the second drafts it from the outline, the third polishes tone and tightens it. Topic: introducing a new internal process to a busy team.',
  },
  {
    icon: MessagesSquare,
    label: 'Roundtable discussion',
    modeLabel: 'Group Chat',
    mode: 'group-chat',
    summary: 'Agents take turns; the moderator decides who speaks next.',
    prompt: 'Hold a roundtable on this question: "Should we prioritize shipping a smaller feature this week, or invest the week in reducing tech debt?" Each agent should make their case once, respond to one other agent, then propose a recommendation.',
  },
  {
    icon: GitBranch,
    label: 'Triage and route',
    modeLabel: 'Handoff',
    mode: 'handoff',
    summary: 'First agent diagnoses, hands off to the right specialist.',
    prompt: 'Triage this problem and hand off to the agent best suited to solve it. Problem: a teammate is blocked on a task they took on two days ago and has gone quiet. Diagnose the most likely cause, then hand off to whoever should follow up.',
  },
  {
    icon: ClipboardList,
    label: 'Plan, delegate, verify',
    modeLabel: 'Manager-led',
    mode: 'magentic',
    summary: 'One agent breaks the work down and coordinates the others.',
    prompt: 'Treat this as a small project. Break the goal into 3-5 sub-tasks, delegate each to the most suitable agent, then verify the results and produce a final summary. Goal: prepare a one-page brief I can share with my manager about how my team is using AI tools today.',
  },
];
