import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = process.cwd();

function walkSourceFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern = /\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImportPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(importPattern)) specifiers.push(match[1]);
  for (const match of source.matchAll(dynamicImportPattern)) specifiers.push(match[1]);
  return specifiers;
}

describe('architecture invariants', () => {
  it('renderer source never imports Electron directly', () => {
    const rendererRoot = path.join(repoRoot, 'apps', 'web', 'src');
    const violations = walkSourceFiles(rendererRoot).flatMap((filePath) => {
      const imports = importSpecifiers(fs.readFileSync(filePath, 'utf8'));
      return imports.includes('electron') ? [path.relative(repoRoot, filePath)] : [];
    });

    expect(violations).toEqual([]);
  });

  it('renderer source only reaches Electron through the preload-exposed API', () => {
    const rendererRoot = path.join(repoRoot, 'apps', 'web', 'src');
    const forbidden = /\b(?:ipcRenderer|contextBridge)\b/;
    const violations = walkSourceFiles(rendererRoot).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8');
      return forbidden.test(source)
        ? [`${path.relative(repoRoot, filePath)} bypasses the preload bridge`]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it('shared source never imports main-process or renderer modules', () => {
    const sharedRoot = path.join(repoRoot, 'packages', 'shared', 'src');
    const forbidden = /^(?:@\/(?:main|renderer)\b|.*\/(?:main|renderer)(?:\/|$))/;
    const violations = walkSourceFiles(sharedRoot).flatMap((filePath) => {
      const imports = importSpecifiers(fs.readFileSync(filePath, 'utf8'));
      return imports
        .filter((specifier) => forbidden.test(specifier))
        .map((specifier) => `${path.relative(repoRoot, filePath)} imports ${specifier}`);
    });

    expect(violations).toEqual([]);
  });
});
