import * as fs from 'fs';
import * as path from 'path';
import type { AgentCard, AgentSkill } from './types';
import type { MindContext } from '@chamber/shared/types';

export interface RemoteAgentAuth {
  scheme: 'bearer';
  token: string;
}

export class AgentCardRegistry {
  private localCards = new Map<string, AgentCard>();
  private remoteCards = new Map<string, AgentCard>();
  private remoteAuth = new Map<string, RemoteAgentAuth>();

  getCard(identifier: string): AgentCard | null {
    return this.localCards.get(identifier) ?? this.remoteCards.get(identifier) ?? null;
  }

  getCards(): AgentCard[] {
    return [...this.localCards.values(), ...this.remoteCards.values()];
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
    this.localCards.set(ctx.mindId, card);
  }

  unregister(mindId: string): void {
    this.localCards.delete(mindId);
  }

  registerRemote(card: AgentCard, auth?: RemoteAgentAuth): void {
    this.validateRemoteCard(card);
    if (auth) this.validateRemoteAuth(auth);
    this.remoteCards.set(card.name, card);
    if (auth) {
      this.remoteAuth.set(card.name, auth);
    } else {
      this.remoteAuth.delete(card.name);
    }
  }

  unregisterRemote(name: string): void {
    this.remoteCards.delete(name);
    this.remoteAuth.delete(name);
  }

  getRemoteAuth(identifier: string): RemoteAgentAuth | null {
    const card = this.remoteCards.get(identifier) ?? this.getRemoteCardByName(identifier);
    if (!card) return null;
    return this.remoteAuth.get(card.name) ?? null;
  }

  private validateRemoteCard(card: AgentCard): void {
    if (card.mindId) {
      throw new Error('Remote agent cards must not include a Chamber mindId');
    }
    if (!card.name.trim()) {
      throw new Error('Remote agent card name is required');
    }
    if (this.localCards.has(card.name) || this.getLocalCardByName(card.name)) {
      throw new Error(`Remote agent card conflicts with local agent: ${card.name}`);
    }
    const httpInterfaces = card.supportedInterfaces.filter((iface) => iface.protocolBinding === 'HTTP+JSON');
    if (httpInterfaces.length === 0) {
      throw new Error('Remote agent card must declare a HTTP+JSON interface');
    }
    for (const iface of httpInterfaces) {
      if (!isLoopbackHttpUrl(iface.url)) {
        throw new Error(`Remote A2A interface must be loopback HTTP: ${iface.url}`);
      }
    }
  }

  private getLocalCardByName(name: string): AgentCard | null {
    return [...this.localCards.values()].find((card) => card.name === name) ?? null;
  }

  private getRemoteCardByName(name: string): AgentCard | null {
    return [...this.remoteCards.values()].find((card) => card.name === name) ?? null;
  }

  private validateRemoteAuth(auth: RemoteAgentAuth): void {
    if (auth.scheme !== 'bearer') {
      throw new Error(`Unsupported remote A2A auth scheme: ${auth.scheme}`);
    }
    if (!auth.token.trim()) {
      throw new Error('Remote A2A bearer token is required');
    }
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

export function isLoopbackHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]')
  );
}
