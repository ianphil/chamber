import type { Tool } from '../mind/types';

export interface ChamberToolProvider {
  getToolsForMind(mindId: string, mindPath: string): Tool[];
  activateMind?(mindId: string, mindPath: string): Promise<void>;
  releaseMind?(mindId: string): Promise<void>;
}
