// IDEA extension adapter — runs tool handlers in a child process using system Node.js
// because @tobilu/qmd depends on better-sqlite3 (native C++ addon) which is compiled
// for system Node and can't load in Electron's runtime.

import * as path from 'path';
import * as fs from 'fs';
import { execSync, execFileSync } from 'child_process';
import type { LoadedExtension, ExtensionTool } from '../ExtensionLoader';
import { requireSystemNode } from '../nodeResolver';

/**
 * Execute an IDEA tool handlerin a child process under system Node.js.
 * Passes tool name and args as JSON, gets result back via stdout.
 */
function execIdeaTool(nodePath: string, extDir: string, toolName: string, args: Record<string, unknown>): string {
  // Inline script that imports qmd/embed and runs the requested tool
  const script = `
    import { pathToFileURL } from 'url';
    const extDir = ${JSON.stringify(extDir)};
    const toolName = ${JSON.stringify(toolName)};
    const args = ${JSON.stringify(args)};

    const qmdUrl = pathToFileURL(extDir + '/lib/qmd.mjs').href;
    const embedUrl = pathToFileURL(extDir + '/lib/embed.mjs').href;
    const qmd = await import(qmdUrl);
    const embed = await import(embedUrl);

    function normalizeLimit(limit, fallback = 10) {
      const value = Number(limit);
      if (!Number.isFinite(value) || value < 1) return fallback;
      return Math.min(Math.floor(value), 25);
    }
    function formatScore(score) { return Math.round(score * 100) + '%'; }
    function cleanSnippet(s) { return s.replace(/^@@\\s+[^@]+@@\\s*(?:\\([^)]*\\)\\s*)?/, '').trim(); }

    async function buildSnippet(store, result, query) {
      const body = await store.getDocumentBody(result.displayPath);
      if (!body) return null;
      const { line, snippet } = qmd.extractSnippet(body, query, 280, result.chunkPos);
      return { line, snippet: cleanSnippet(snippet) };
    }

    async function formatResults(store, query, results, label) {
      if (results.length === 0) return 'No ' + label + ' results found for "' + query + '".';
      const lines = [label + ' results for "' + query + '":', ''];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        lines.push((i+1) + '. ' + r.title);
        lines.push('   Path: ' + r.displayPath);
        lines.push('   Collection: ' + r.collectionName);
        lines.push('   Score: ' + formatScore(r.score) + ' (' + r.source + ')');
        const snippet = await buildSnippet(store, r, query);
        if (snippet && snippet.snippet) {
          lines.push('   Snippet (line ' + snippet.line + '): ' + snippet.snippet.replace(/\\s+/g, ' '));
        }
        lines.push('');
      }
      return lines.join('\\n').trimEnd();
    }

    try {
      const store = await qmd.openStore();
      let result;
      try {
        if (toolName === 'idea_search') {
          const results = await store.searchLex(args.query, {
            collection: args.collection, limit: normalizeLimit(args.limit),
          });
          result = await formatResults(store, args.query, results, 'Keyword');
        } else if (toolName === 'idea_recall') {
          const queryVector = await embed.embedQuery(args.query);
          const results = await store.internal.searchVec(
            args.query, 'text-embedding-3-small',
            normalizeLimit(args.limit), args.collection,
            undefined, queryVector,
          );
          result = await formatResults(store, args.query, results, 'Semantic');
        } else if (toolName === 'idea_reindex') {
          const update = await store.update();
          const em = await embed.embedPendingDocuments(store, { force: Boolean(args.force) });
          result = [
            'IDEA reindex complete.', '',
            'Collections scanned: ' + update.collections,
            'Indexed: ' + update.indexed + ' new',
            'Updated: ' + update.updated,
            'Unchanged: ' + update.unchanged,
            'Removed: ' + update.removed,
            'Pending embeddings after scan: ' + update.needsEmbedding, '',
            'Documents embedded: ' + em.documents,
            'Chunks embedded: ' + em.chunks,
            'Elapsed: ' + em.elapsedSeconds.toFixed(1) + 's',
            ...(em.force ? ['Mode: force re-embed'] : []),
          ].join('\\n');
        } else if (toolName === 'idea_status') {
          const [status, health, collections] = await Promise.all([
            store.getStatus(), store.getIndexHealth(), store.listCollections(),
          ]);
          const lines = [
            'IDEA index status:', '',
            'Total documents: ' + status.totalDocuments,
            'Needs embedding: ' + status.needsEmbedding,
            'Vector index: ' + (status.hasVectorIndex ? 'yes' : 'no'),
            'Days stale: ' + (health.daysStale ?? 'unknown'),
            'Collections: ' + status.collections.length, '',
          ];
          for (const c of status.collections) {
            const meta = collections.find(item => item.name === c.name);
            const flags = meta && meta.includeByDefault ? ' [default]' : '';
            lines.push('- ' + c.name + ': ' + c.documents + ' docs at ' + (c.path ?? '(db-only)') + flags);
          }
          result = lines.join('\\n');
        }
      } finally {
        await store.close();
      }
      process.stdout.write(JSON.stringify({ ok: true, result }));
    } catch (e) {
      process.stdout.write(JSON.stringify({ ok: false, error: e.message }));
    }
  `;

  const output = execFileSync(nodePath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    timeout: 120_000,
    cwd: extDir,
    windowsHide: true,
  });

  const parsed = JSON.parse(output.trim());
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.result;
}

export async function loadIdeaExtension(extDir: string): Promise<LoadedExtension> {
  const qmdPath = path.join(extDir, 'lib', 'qmd.mjs');
  const embedPath = path.join(extDir, 'lib', 'embed.mjs');

  if (!fs.existsSync(qmdPath) || !fs.existsSync(embedPath)) {
    throw new Error(`IDEA extension missing required lib files in ${extDir}`);
  }

  const hasQmd = fs.existsSync(path.join(extDir, 'node_modules', '@tobilu', 'qmd'));
  if (!hasQmd) {
    throw new Error(`IDEA extension requires @tobilu/qmd. Run: cd ${extDir} && npm install`);
  }

  const nodePath = requireSystemNode('IDEA extension native modules');
  console.log(`[IDEA] Using system Node: ${nodePath}`);

  const tools: ExtensionTool[] = [
    {
      name: 'idea_search',
      description: 'Keyword search across the IDEA mind using BM25 lexical search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Exact words or phrases to search for.' },
          collection: { type: 'string', description: 'Optional collection name to limit the search.' },
          limit: { type: 'integer', description: 'Maximum number of matches to return (default 10, max 25).' },
        },
        required: ['query'],
      },
      handler: async (args) => execIdeaTool(nodePath, extDir, 'idea_search', args),
    },
    {
      name: 'idea_recall',
      description: 'Semantic search across the IDEA mind using Copilot embeddings and QMD vector search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural-language question or concept to recall.' },
          collection: { type: 'string', description: 'Optional collection name to limit the search.' },
          limit: { type: 'integer', description: 'Maximum number of matches to return (default 10, max 25).' },
        },
        required: ['query'],
      },
      handler: async (args) => execIdeaTool(nodePath, extDir, 'idea_recall', args),
    },
    {
      name: 'idea_reindex',
      description: 'Re-scan the IDEA collections from disk and refresh Copilot-backed vector embeddings.',
      parameters: {
        type: 'object',
        properties: {
          force: { type: 'boolean', description: 'Rebuild all embeddings instead of only missing ones.' },
        },
      },
      handler: async (args) => execIdeaTool(nodePath, extDir, 'idea_reindex', args),
    },
    {
      name: 'idea_status',
      description: 'Show IDEA index health, document counts, staleness, and configured collections.',
      parameters: { type: 'object', properties: {} },
      handler: async (args) => execIdeaTool(nodePath, extDir, 'idea_status', args),
    },
  ];

  console.log(`[IDEA] Loaded ${tools.length} tools (child-process mode)`);

  return {
    name: 'idea',
    tools,
    cleanup: async () => {
      console.log('[IDEA] Cleaned up');
    },
  };
}
