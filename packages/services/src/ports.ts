import { randomBytes, randomUUID } from 'node:crypto';

export interface AppPaths {
  readonly userData: string;
  readonly logs: string;
  readonly cache: string;
  readonly temp: string;
}

export interface SdkRuntimeLayout {
  readonly isPackaged: boolean;
  readonly cwd: string;
  readonly resourcesPath?: string;
}

export interface CredentialStore {
  findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

export interface ExternalOpener {
  open(url: string): Promise<void> | void;
}

export interface UserAlert {
  kind: 'info' | 'warning' | 'error';
  title: string;
  body?: string;
  actions?: readonly string[];
  onClick?: () => void;
}

export interface Notifier {
  notify(alert: UserAlert): void;
}

export interface Disposable {
  dispose(): void;
}

export interface PowerEvents {
  onResume(callback: () => void): Disposable;
}

export interface Clock {
  now(): number;
}

export interface RandomBytes {
  bytes(length: number): Buffer;
}

export interface IdGenerator {
  id(): string;
}

export interface SessionPublisher<TEvent = unknown> {
  publish(sessionId: string, event: TEvent): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export const nodeRandomBytes: RandomBytes = {
  bytes: (length) => randomBytes(length),
};

export const uuidGenerator: IdGenerator = {
  id: () => randomUUID(),
};
