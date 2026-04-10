// MindBootstrap — seed default Lens views and install the Lens skill into a mind directory.
// Extracted from ViewDiscovery to keep scan() side-effect-free.

import * as fs from 'fs';
import * as path from 'path';

export function seedLensDefaults(mindPath: string): void {
  const lensDir = path.join(mindPath, '.github', 'lens');

  // Hello World
  const helloDir = path.join(lensDir, 'hello-world');
  const helloViewJson = path.join(helloDir, 'view.json');
  if (!fs.existsSync(helloViewJson)) {
    console.log('[MindBootstrap] Seeding default hello-world view');
    fs.mkdirSync(helloDir, { recursive: true });
    fs.writeFileSync(helloViewJson, JSON.stringify({
      name: 'Hello World',
      icon: 'zap',
      view: 'form',
      source: 'data.json',
      prompt: 'Report your current status including: your agent name, the mind directory name, how many files are in inbox/, how many initiatives exist, how many domains exist, and what extensions are loaded. Write the result as a flat JSON object to the path specified below.',
      refreshOn: 'click',
      schema: {
        properties: {
          agent: { type: 'string', title: 'Agent' },
          mind: { type: 'string', title: 'Mind' },
          inbox_count: { type: 'number', title: 'Inbox Items' },
          initiatives: { type: 'number', title: 'Initiatives' },
          domains: { type: 'number', title: 'Domains' },
          extensions: { type: 'string', title: 'Extensions' },
          status: { type: 'string', title: 'Status' },
        },
      },
    }, null, 2));
  }

  // Newspaper
  const newsDir = path.join(lensDir, 'newspaper');
  const newsViewJson = path.join(newsDir, 'view.json');
  if (!fs.existsSync(newsViewJson)) {
    console.log('[MindBootstrap] Seeding default newspaper view');
    fs.mkdirSync(newsDir, { recursive: true });
    fs.writeFileSync(newsViewJson, JSON.stringify({
      name: 'Newspaper',
      icon: 'newspaper',
      view: 'briefing',
      source: 'briefing.json',
      prompt: 'Generate a morning briefing for this mind. Count inbox/ items, list active initiatives with their status and next actions, count domains, and note any recent changes. Write the result as a flat JSON object to the path specified below.',
      refreshOn: 'click',
      schema: {
        properties: {
          inbox_items: { type: 'number', title: 'Inbox Items' },
          active_initiatives: { type: 'number', title: 'Active Initiatives' },
          domains: { type: 'number', title: 'Domains' },
          top_priorities: { type: 'string', title: 'Top Priorities' },
          recent_changes: { type: 'string', title: 'Recent Changes' },
          status: { type: 'string', title: 'Overall Status' },
        },
      },
    }, null, 2));
  }
}

export function installLensSkill(mindPath: string): void {
  const skillDir = path.join(mindPath, '.github', 'skills', 'lens');
  const skillPath = path.join(skillDir, 'SKILL.md');

  if (fs.existsSync(skillPath)) return;

  // Read bundled SKILL.md — check packaged, built, and dev paths
  const candidates = [
    path.join(process.resourcesPath ?? '', 'assets', 'lens-skill', 'SKILL.md'),
    path.join(__dirname, '..', 'assets', 'lens-skill', 'SKILL.md'),
    path.join(__dirname, '..', '..', 'src', 'main', 'assets', 'lens-skill', 'SKILL.md'),
  ];

  let content: string | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      content = fs.readFileSync(p, 'utf-8');
      break;
    }
  }

  if (!content) {
    console.warn('[MindBootstrap] Lens skill asset not found, skipping install');
    return;
  }

  console.log('[MindBootstrap] Installing Lens skill into mind');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(skillPath, content);
}
