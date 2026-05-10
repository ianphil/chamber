export interface MarketplaceInstallUrl {
  registryUrl: string;
}

export interface MarketplaceEnrollmentResult {
  success: boolean;
  error?: string;
}

export type EnrollMarketplace = (registryUrl: string) => Promise<MarketplaceEnrollmentResult>;
export type ReportMarketplaceEnrollmentFailure = (error: string) => void;

export function parseMarketplaceInstallUrl(rawUrl: string): MarketplaceInstallUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== 'chamber:' || url.hostname !== 'install') {
    return null;
  }

  const registryUrl = url.searchParams.get('registry')?.trim();
  if (!registryUrl) {
    return null;
  }

  return { registryUrl };
}

export function findMarketplaceInstallUrl(argv: string[]): string | null {
  return argv.find((value) => parseMarketplaceInstallUrl(value) !== null) ?? null;
}

export async function enrollMarketplaceFromProtocolUrl(
  rawUrl: string,
  enrollMarketplace: EnrollMarketplace,
  reportFailure?: ReportMarketplaceEnrollmentFailure,
): Promise<boolean> {
  const installUrl = parseMarketplaceInstallUrl(rawUrl);
  if (!installUrl) {
    return false;
  }

  const result = await enrollMarketplace(installUrl.registryUrl);
  if (!result.success) {
    reportFailure?.(result.error ?? 'Marketplace enrollment failed.');
    return false;
  }

  return true;
}
