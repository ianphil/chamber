export interface GenesisMindTemplateSource {
  owner: string;
  repo: string;
  ref: string;
  plugin: string;
  manifestPath: string;
  rootPath: string;
  marketplaceId?: string;
  marketplaceLabel?: string;
  marketplaceUrl?: string;
}

export interface GenesisMindTemplate {
  id: string;
  displayName: string;
  description: string;
  role: string;
  voice: string;
  templateVersion: string;
  agent: string;
  requiredFiles: string[];
  source: GenesisMindTemplateSource;
}

export interface GenesisMindTemplateMarketplaceSource {
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

export type GenesisMindTemplateMarketplaceStatusKind = 'ok' | 'disabled' | 'error';

export interface GenesisMindTemplateMarketplaceStatus {
  id: string;
  label: string;
  url: string;
  status: GenesisMindTemplateMarketplaceStatusKind;
  templateCount: number;
  message?: string;
}

export interface GenesisMindTemplateMarketplaceResult {
  templates: GenesisMindTemplate[];
  sources: GenesisMindTemplateMarketplaceStatus[];
}
