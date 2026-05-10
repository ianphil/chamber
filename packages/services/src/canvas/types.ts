export interface CanvasAction {
  mindId: string;
  canvas: string;
  action: string;
  data: unknown;
  timestamp: number;
  lensViewId?: string;
}

export interface CanvasEntry {
  name: string;
  filename: string;
  url: string;
  token: string;
}

export interface CanvasShowInput {
  name: string;
  html?: string;
  file?: string;
  title?: string;
  open_browser?: boolean;
}

export interface CanvasUpdateInput {
  name: string;
  html: string;
  title?: string;
}

export interface CanvasCloseInput {
  name: string;
}

export interface CanvasServerLike {
  start(): Promise<number>;
  stop(): Promise<void>;
  reload(mindId?: string, filename?: string): void;
  closeClients(mindId?: string, filename?: string): void;
  getPort(): number | null;
  isRunning(): boolean;
}
