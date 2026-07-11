#!/usr/bin/env node
// Small, checked-in runtime host for the Chamber WTD topology advisor.
//
// Spawned as a Node child process (via `child_process.fork`, so a Node IPC
// channel is attached automatically) by WtdRuntimeProcess
// (packages/services/src/wtd/WtdRuntimeProcess.ts). Talks to its parent
// exclusively over `process.send` / `process.on('message')`. stdout/stderr
// are diagnostics only — never protocol data, and never raw query/draft
// content (the parent process forbids logging that content, and this host
// must not undo that by echoing it here).
//
// Usage: node host.mjs <path-to-@ianphil/ttasks-wtd-package-entry>

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_K = 5;
const VALID_MODES = new Set(['auto', 'structural', 'metadata']);

const wtdEntryPath = process.argv[2];

let advisor = null;
let retrieveQueue = Promise.resolve();

main();

function main() {
  if (typeof process.send !== 'function') {
    console.error('[wtd-runtime] must be spawned with an IPC channel (child_process.fork)');
    process.exit(1);
    return;
  }
  if (!wtdEntryPath) {
    console.error('[wtd-runtime] missing required WTD package entry path argument');
    process.exit(1);
    return;
  }

  process.on('message', (message) => {
    handleMessage(message).catch((error) => {
      console.error('[wtd-runtime] unhandled error while processing message:', describeError(error));
    });
  });

  // Parent closed the IPC channel (e.g. it exited without an explicit
  // shutdown) — exit rather than lingering as an orphaned process.
  process.on('disconnect', () => {
    process.exit(0);
  });
}

async function handleMessage(message) {
  if (!message || typeof message !== 'object') return;

  if (message.type === 'shutdown') {
    process.exit(0);
    return;
  }
  if (message.type === 'initialize') {
    await handleInitialize(message);
    return;
  }
  if (message.type === 'retrieve') {
    retrieveQueue = retrieveQueue.then(
      () => handleRetrieve(message),
      () => handleRetrieve(message),
    );
    await retrieveQueue;
    return;
  }

  send({ type: 'error', requestId: message.requestId, message: `Unknown WTD host message type: ${String(message.type)}` });
}

async function handleInitialize(message) {
  const { requestId, cacheDir, modelRepo, modelRevision } = message;
  try {
    if (!cacheDir || typeof cacheDir !== 'string') {
      throw new Error('initialize requires an explicit cacheDir');
    }

    console.log(`[wtd-runtime] loading WTD entry from ${wtdEntryPath}`);
    const wtd = await import(pathToFileURL(wtdEntryPath).href);
    const { downloadWtdRuntime, WtdAdvisor } = wtd;
    const packageVersion = readPackageVersion(wtdEntryPath);

    console.log(`[wtd-runtime] preparing runtime bundle in ${cacheDir}`);
    const runtime = await downloadWtdRuntime({
      ...(modelRepo ? { repo: modelRepo } : {}),
      ...(modelRevision ? { revision: modelRevision } : {}),
      outDir: cacheDir,
    });

    // `downloadWtdRuntime` already verifies the bundle's checksums before
    // returning — whether it just finished a fresh download or reused an
    // existing cache. Asking `WtdAdvisor.load` to verify again would re-hash
    // every bundle file a second time for no benefit, so skip that pass here.
    advisor = await WtdAdvisor.load({ bundlePath: runtime.bundlePath, verifyChecksums: false });

    console.log(
      `[wtd-runtime] ready (cacheHit=${runtime.cacheHit}, packageVersion=${packageVersion}, revision=${runtime.revision})`,
    );
    send({
      type: 'initialized',
      requestId,
      cacheHit: runtime.cacheHit,
      packageVersion,
      revision: runtime.revision,
    });
  } catch (error) {
    send({ type: 'error', requestId, message: describeError(error) });
  }
}

// The @ianphil/ttasks-wtd entry is `<pkg>/dist/index.js`; its package.json
// (with the installed version) lives two directories up.
function readPackageVersion(entryPath) {
  try {
    const packageJsonPath = join(dirname(entryPath), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function handleRetrieve(message) {
  const { requestId } = message;
  try {
    if (!advisor) {
      throw new Error('WTD runtime received a retrieve request before initialize completed');
    }
    const request = validateRetrieveMessage(message);
    const result = await advisor.retrieve(request);
    send({ type: 'retrieved', requestId, result: mapResult(result) });
  } catch (error) {
    send({ type: 'error', requestId, message: describeError(error) });
  }
}

// Defense-in-depth bounded validation. WtdRuntimeProcess validates the same
// contract before it ever sends a message, but the host re-checks so a bug or
// a future caller cannot smuggle an out-of-range request past this boundary.
function validateRetrieveMessage(message) {
  const mode = message.mode ?? 'auto';
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid WTD retrieve mode: ${String(mode)}`);
  }
  const k = message.k ?? MAX_K;
  if (!Number.isInteger(k) || k < 1 || k > MAX_K) {
    throw new Error(`Invalid WTD retrieve k: ${String(k)} (must be an integer between 1 and ${MAX_K})`);
  }
  const hasQuery = typeof message.query === 'string' && message.query.length > 0;
  const hasDraftDag = Boolean(message.draftDag) && typeof message.draftDag === 'object';
  if (!hasQuery && !hasDraftDag) {
    throw new Error('WTD retrieve requires a query and/or a draftDag');
  }
  return {
    ...(hasQuery ? { query: message.query } : {}),
    ...(hasDraftDag ? { draftDag: message.draftDag } : {}),
    k,
    mode,
  };
}

function mapResult(result) {
  return {
    queryKind: result.queryKind,
    querySummary: result.querySummary,
    candidates: (result.candidates ?? []).map((candidate) => ({
      ...(candidate.id ? { id: candidate.id } : {}),
      name: candidate.name,
      description: candidate.description,
      score: candidate.score,
      nodeCount: candidate.nodeCount,
      edgeCount: candidate.edgeCount,
      ...(candidate.depth !== undefined ? { depth: candidate.depth } : {}),
      ...(candidate.rankReason ? { rankReason: candidate.rankReason } : {}),
      guidance: candidate.guidance,
      ...(candidate.risks && candidate.risks.length > 0 ? { risks: candidate.risks } : {}),
    })),
    ...(result.fallback ? { fallback: result.fallback } : {}),
  };
}

function describeError(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function send(message) {
  try {
    process.send?.(message);
  } catch (error) {
    console.error('[wtd-runtime] failed to send IPC message:', describeError(error));
  }
}
