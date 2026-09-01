import { describe, expect, it, vi } from 'vitest';
import { LinuxKeyringCredentialStore, type KeyringModule } from './LinuxKeyringCredentialStore';

function createKeyring() {
  const entries = new Map<string, string>();
  const key = (service: string, username: string) => `${service}\0${username}`;

  class FakeAsyncEntry {
    constructor(
      private readonly service: string,
      private readonly username: string,
    ) {}

    async setPassword(password: string): Promise<void> {
      entries.set(key(this.service, this.username), password);
    }

    async deleteCredential(): Promise<boolean> {
      return entries.delete(key(this.service, this.username));
    }
  }

  const findCredentialsAsync = vi.fn(async (service: string) =>
    [...entries.entries()]
      .filter(([entryKey]) => entryKey.startsWith(`${service}\0`))
      .map(([entryKey, password]) => ({
        account: entryKey.slice(service.length + 1),
        password,
      })));

  return {
    entries,
    keyring: {
      AsyncEntry: FakeAsyncEntry,
      findCredentialsAsync,
    } satisfies KeyringModule,
    findCredentialsAsync,
  };
}

describe('LinuxKeyringCredentialStore', () => {
  it('lists credentials written with Copilot keyring usernames', async () => {
    const { entries, keyring, findCredentialsAsync } = createKeyring();
    entries.set('copilot-cli\0https://github.com:alice', 'token');
    const store = new LinuxKeyringCredentialStore(keyring);

    await expect(store.findCredentials('copilot-cli')).resolves.toEqual([
      { account: 'https://github.com:alice', password: 'token' },
    ]);
    expect(findCredentialsAsync).toHaveBeenCalledWith('copilot-cli');
  });

  it('sets and deletes credentials through keyed entries', async () => {
    const { entries, keyring } = createKeyring();
    const store = new LinuxKeyringCredentialStore(keyring);
    const account = 'https://github.com:alice';

    await store.setPassword('copilot-cli', account, 'token');
    expect(entries.get(`copilot-cli\0${account}`)).toBe('token');

    await expect(store.deletePassword('copilot-cli', account)).resolves.toBe(true);
    await expect(store.deletePassword('copilot-cli', account)).resolves.toBe(false);
  });
});
