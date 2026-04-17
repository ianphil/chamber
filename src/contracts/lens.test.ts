import { describe, it, expect } from 'vitest';
import {
  LensViewSchema,
  LensViewManifestSchema,
  LensGetViewsArgs,
  LensGetViewDataArgs,
  LensRefreshViewArgs,
  LensSendActionArgs,
} from './lens';

describe('lens contract', () => {
  it('LensView enum accepts known view kinds', () => {
    for (const v of [
      'form',
      'table',
      'briefing',
      'status-board',
      'list',
      'monitor',
      'detail',
      'timeline',
      'editor',
    ] as const) {
      expect(LensViewSchema.safeParse(v).success).toBe(true);
    }
    expect(LensViewSchema.safeParse('unknown').success).toBe(false);
  });

  it('LensViewManifest requires id/name/icon/view/source', () => {
    expect(
      LensViewManifestSchema.safeParse({
        id: 'v1',
        name: 'Overview',
        icon: 'eye',
        view: 'form',
        source: 'overview.json',
      }).success,
    ).toBe(true);
    expect(LensViewManifestSchema.safeParse({ id: 'v1' }).success).toBe(false);
  });

  it('lens:getViews accepts [] and [mindId]', () => {
    expect(LensGetViewsArgs.safeParse([]).success).toBe(true);
    expect(LensGetViewsArgs.safeParse(['m1']).success).toBe(true);
    expect(LensGetViewsArgs.safeParse([42]).success).toBe(false);
  });

  it('lens:getViewData requires viewId; mindId optional', () => {
    expect(LensGetViewDataArgs.safeParse(['v1']).success).toBe(true);
    expect(LensGetViewDataArgs.safeParse(['v1', 'm1']).success).toBe(true);
    expect(LensGetViewDataArgs.safeParse([]).success).toBe(false);
    expect(LensGetViewDataArgs.safeParse(['']).success).toBe(false);
  });

  it('lens:refreshView mirrors getViewData', () => {
    expect(LensRefreshViewArgs.safeParse(['v1']).success).toBe(true);
    expect(LensRefreshViewArgs.safeParse(['v1', 'm1']).success).toBe(true);
    expect(LensRefreshViewArgs.safeParse([]).success).toBe(false);
  });

  it('lens:sendAction requires viewId + action; mindId optional', () => {
    expect(LensSendActionArgs.safeParse(['v1', 'save']).success).toBe(true);
    expect(LensSendActionArgs.safeParse(['v1', 'save', 'm1']).success).toBe(true);
    expect(LensSendActionArgs.safeParse(['v1']).success).toBe(false);
    expect(LensSendActionArgs.safeParse(['v1', '']).success).toBe(false);
  });
});
