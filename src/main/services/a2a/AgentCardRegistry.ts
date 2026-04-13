import * as fs from 'fs';
import * as path from 'path';
import type { AgentCard, AgentSkill } from './types';
import type { MindContext } from '../../../shared/types';

export class AgentCardRegistry {
  private cards = new Map<string, AgentCard>();

  getCard(mindId: string): AgentCard | null {
    return this.cards.get(mindId) ?? null;
  }

  getCards(): AgentCard[] {
    return [...this.cards.values()];
  }

  getCardByName(name: string): AgentCard | null {
    const matches = this.getCards().filter((c) => c.name === name);
    return matches.length === 1 ? matches[0] : null;
  }

  register(ctx: MindContext): void {
    const skills = this.discoverSkills(ctx.mindPath);
    const description = this.extractDescription(ctx.identity.systemMessage, ctx.identity.name);

    const card: AgentCard = {
      name: ctx.identity.name,
      description,
      version: '1.0.0',
      supportedInterfaces: [
        { url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills,
      mindId: ctx.mindId,
    };
    this.cards.set(ctx.mindId, card);
  }

  unregister(mindId: string): void {
    this.cards.delete(mindId);
  }

  private discoverSkills(mindPath: string): AgentSkill[] {
    const skillsDir = path.join(mindPath, '.github', 'skills');
    if (!fs.existsSync(skillsDir)) return [];

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => {
        const skillMd = path.join(skillsDir, e.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) return null;
        const content = fs.readFileSync(skillMd, 'utf-8');
        const name = this.extractSkillName(content, e.name);
        const description = this.extractSkillDescription(content);
        return { id: e.name, name, description, tags: [e.name] } as AgentSkill;
      })
      .filter((s): s is AgentSkill => s !== null);
  }

  private extractDescription(systemMessage: string, fallbackName: string): string {
    const lines = systemMessage.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) return trimmed;
    }
    return `${fallbackName} agent`;
  }

  private extractSkillName(content: string, fallback: string): string {
    const match = content.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : fallback;
  }

  private extractSkillDescription(content: string): string {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) return trimmed;
    }
    return '';
  }
}
