import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ONBOARDING_DOCUMENT_RELATIVE_PATH, seedOnboardingDocument } from './seedOnboardingDocument';

describe('seedOnboardingDocument', () => {
  let mindDir = '';

  beforeEach(() => {
    mindDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-seed-'));
  });

  afterEach(() => {
    fs.rmSync(mindDir, { recursive: true, force: true });
  });

  it('writes the document to .chamber/onboarding.md inside the mind directory', () => {
    seedOnboardingDocument(mindDir, '# Onboarding\n\nhello');
    const written = path.join(mindDir, ONBOARDING_DOCUMENT_RELATIVE_PATH);
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.readFileSync(written, 'utf-8')).toBe('# Onboarding\n\nhello');
  });

  it('creates the .chamber directory when missing', () => {
    expect(fs.existsSync(path.join(mindDir, '.chamber'))).toBe(false);
    seedOnboardingDocument(mindDir, 'content');
    expect(fs.existsSync(path.join(mindDir, '.chamber'))).toBe(true);
  });

  it('overwrites an existing onboarding document', () => {
    seedOnboardingDocument(mindDir, 'first');
    seedOnboardingDocument(mindDir, 'second');
    expect(fs.readFileSync(path.join(mindDir, ONBOARDING_DOCUMENT_RELATIVE_PATH), 'utf-8')).toBe('second');
  });

  it('rejects empty content', () => {
    expect(() => seedOnboardingDocument(mindDir, '   ')).toThrow(/empty/i);
  });

  it('rejects content over the size limit', () => {
    expect(() => seedOnboardingDocument(mindDir, 'a'.repeat(256_001))).toThrow(/too large/i);
  });

  it('rejects a non-existent mind directory', () => {
    expect(() => seedOnboardingDocument(path.join(mindDir, 'nope'), 'x')).toThrow(/does not exist/i);
  });

  it('rejects writing through a symlinked .chamber directory', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-seed-outside-'));
    try {
      fs.symlinkSync(outside, path.join(mindDir, '.chamber'), 'dir');
    } catch {
      // Windows without symlink privilege — skip the assertion in that case.
      return;
    }
    expect(() => seedOnboardingDocument(mindDir, 'x')).toThrow(/symlink/i);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});
