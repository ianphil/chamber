export interface SkillMarketplaceSource {
  id?: string;
  label?: string;
  url?: string;
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface MarketplaceSkillEntry {
  id: string;
  displayName: string;
  description: string;
  root: string;
  requiredFiles: string[];
  capabilities: string[];
  reserved: boolean;
  source: {
    owner: string;
    repo: string;
    ref: string;
    plugin: string;
    marketplaceId: string;
    marketplaceLabel: string;
    marketplaceUrl: string;
    isDefault: boolean;
  };
}

export interface ManagedSkillManifest {
  name: string;
  version: string;
  capabilities: string[];
}

export interface ManagedSkillAssetFile {
  path: string;
  content: Buffer;
  sha256: string;
}

export interface ManagedSkillMarketplaceSource {
  type: 'marketplace';
  marketplaceId: string;
  marketplaceLabel: string;
  marketplaceUrl: string;
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  root: string;
}

export interface ManagedSkillAsset {
  manifest: ManagedSkillManifest;
  files: ManagedSkillAssetFile[];
  source?: ManagedSkillMarketplaceSource;
}
