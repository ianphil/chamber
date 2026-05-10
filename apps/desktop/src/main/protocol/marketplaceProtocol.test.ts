import { describe, expect, it, vi } from 'vitest';
import { enrollMarketplaceFromProtocolUrl, findMarketplaceInstallUrl, parseMarketplaceInstallUrl } from './marketplaceProtocol';

describe('marketplaceProtocol', () => {
  it('parses chamber install registry URLs', () => {
    expect(parseMarketplaceInstallUrl('chamber://install?registry=https%3A%2F%2Fgithub.com%2Fagency-microsoft%2Fgenesis-minds')).toEqual({
      registryUrl: 'https://github.com/agency-microsoft/genesis-minds',
    });
  });

  it('rejects unrelated or incomplete protocol URLs', () => {
    expect(parseMarketplaceInstallUrl('chamber://open?registry=https://github.com/org/repo')).toBeNull();
    expect(parseMarketplaceInstallUrl('https://chmbr.dev/install?registry=https://github.com/org/repo')).toBeNull();
    expect(parseMarketplaceInstallUrl('chamber://install')).toBeNull();
    expect(parseMarketplaceInstallUrl('not a url')).toBeNull();
  });

  it('finds install URLs in second-instance argv', () => {
    expect(findMarketplaceInstallUrl([
      'C:\\Program Files\\Chamber\\chamber.exe',
      'chamber://install?registry=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
    ])).toBe('chamber://install?registry=https%3A%2F%2Fgithub.com%2Forg%2Frepo');
  });

  it('routes install URLs to marketplace enrollment', async () => {
    const enroll = vi.fn().mockResolvedValue({ success: true });

    await expect(enrollMarketplaceFromProtocolUrl(
      'chamber://install?registry=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      enroll,
    )).resolves.toBe(true);

    expect(enroll).toHaveBeenCalledWith('https://github.com/org/repo');
  });

  it('reports enrollment failures without throwing', async () => {
    const reportFailure = vi.fn();

    await expect(enrollMarketplaceFromProtocolUrl(
      'chamber://install?registry=https%3A%2F%2Fgithub.com%2Forg%2Frepo',
      async () => ({ success: false, error: 'Unable to access marketplace.' }),
      reportFailure,
    )).resolves.toBe(false);

    expect(reportFailure).toHaveBeenCalledWith('Unable to access marketplace.');
  });
});
