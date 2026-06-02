import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ManagedSkillService } from './ManagedSkillService';
import type { MarketplaceSkillCatalogResult } from './MarketplaceSkillCatalog';
import type { ManagedSkillAsset, MarketplaceSkillEntry } from './skillTypes';

const CORE_SKILL = skillEntry('lens');
const NON_CORE_SKILL = skillEntry('team-helper');

describe('ManagedSkillService', () => {
  let catalog: { listSkills: ReturnType<typeof vi.fn<() => Promise<MarketplaceSkillCatalogResult>>> };
  let materializer: { materialize: ReturnType<typeof vi.fn<(skill: MarketplaceSkillEntry) => Promise<ManagedSkillAsset>>> };
  let install: ReturnType<typeof vi.fn<(mindPath: string, asset: ManagedSkillAsset) => void>>;

  beforeEach(() => {
    catalog = { listSkills: vi.fn<() => Promise<MarketplaceSkillCatalogResult>>() };
    materializer = { materialize: vi.fn<(skill: MarketplaceSkillEntry) => Promise<ManagedSkillAsset>>() };
    install = vi.fn<(mindPath: string, asset: ManagedSkillAsset) => void>();
  });

  it('fetches reserved core skill bundles once and installs cached bundles into every mind', async () => {
    const asset = skillAsset('lens');
    catalog.listSkills.mockResolvedValue({ skills: [CORE_SKILL, NON_CORE_SKILL], errors: [] });
    materializer.materialize.mockResolvedValue(asset);
    const service = new ManagedSkillService(catalog, materializer, install);

    await service.refresh();
    service.installIntoMind('C:\\minds\\alpha');
    service.installIntoMind('C:\\minds\\beta');

    expect(catalog.listSkills).toHaveBeenCalledTimes(1);
    expect(materializer.materialize).toHaveBeenCalledTimes(1);
    expect(materializer.materialize).toHaveBeenCalledWith(CORE_SKILL);
    expect(install).toHaveBeenCalledWith('C:\\minds\\alpha', asset);
    expect(install).toHaveBeenCalledWith('C:\\minds\\beta', asset);
  });

  it('refreshes lazily when a mind loads before startup refresh completes', async () => {
    catalog.listSkills.mockResolvedValue({ skills: [CORE_SKILL], errors: [] });
    materializer.materialize.mockResolvedValue(skillAsset('lens'));
    const service = new ManagedSkillService(catalog, materializer, install);

    await service.installIntoMind('C:\\minds\\alpha');

    expect(catalog.listSkills).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('reports degraded status when catalog or materialization fails and keeps existing cached bundles', async () => {
    const asset = skillAsset('lens');
    catalog.listSkills
      .mockResolvedValueOnce({ skills: [CORE_SKILL], errors: [] })
      .mockResolvedValueOnce({ skills: [CORE_SKILL], errors: [{ marketplaceId: 'team', message: 'bad manifest' }] });
    materializer.materialize
      .mockResolvedValueOnce(asset)
      .mockRejectedValueOnce(new Error('network down'));
    const service = new ManagedSkillService(catalog, materializer, install);

    const ok = await service.refresh();
    const degraded = await service.refresh();
    service.installIntoMind('C:\\minds\\alpha');

    expect(ok.status).toBe('ok');
    expect(degraded.status).toBe('degraded');
    expect(degraded.errors).toEqual([
      { marketplaceId: 'team', message: 'bad manifest' },
      { marketplaceId: 'github:ianphil/genesis-minds', skillId: 'lens', message: 'network down' },
    ]);
    expect(install).toHaveBeenCalledWith('C:\\minds\\alpha', asset);
  });
});

function skillEntry(id: string): MarketplaceSkillEntry {
  return {
    id,
    displayName: id,
    description: id,
    root: `skills/${id}`,
    requiredFiles: ['SKILL.md'],
    capabilities: [id],
    reserved: id === 'lens',
    source: {
      owner: 'ianphil',
      repo: 'genesis-minds',
      ref: 'master',
      plugin: 'genesis-minds',
      marketplaceId: 'github:ianphil/genesis-minds',
      marketplaceLabel: 'Public Genesis Minds',
      marketplaceUrl: 'https://github.com/ianphil/genesis-minds',
      isDefault: true,
    },
  };
}

function skillAsset(name: string): ManagedSkillAsset {
  return {
    manifest: { name, version: '1.0.0', capabilities: [name] },
    files: [{ path: 'SKILL.md', content: Buffer.from(`# ${name}`), sha256: 'hash' }],
  };
}
