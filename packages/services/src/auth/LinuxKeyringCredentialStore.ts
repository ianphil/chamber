import type { CredentialStore } from '../ports';

interface KeyringEntry {
  setPassword(password: string): Promise<void>;
  deleteCredential(): Promise<boolean>;
}

export interface KeyringModule {
  AsyncEntry: new (service: string, username: string) => KeyringEntry;
  findCredentialsAsync(service: string): Promise<Array<{ account: string; password: string }>>;
}

export class LinuxKeyringCredentialStore implements CredentialStore {
  constructor(private readonly keyring: KeyringModule) {}

  findCredentials(service: string): Promise<Array<{ account: string; password: string }>> {
    return this.keyring.findCredentialsAsync(service);
  }

  async setPassword(service: string, account: string, password: string): Promise<void> {
    await new this.keyring.AsyncEntry(service, account).setPassword(password);
  }

  async deletePassword(service: string, account: string): Promise<boolean> {
    const credentials = await this.findCredentials(service);
    if (!credentials.some((credential) => credential.account === account)) return false;
    await new this.keyring.AsyncEntry(service, account).deleteCredential();
    return true;
  }
}
