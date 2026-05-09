const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'docs', 'assets', 'user-docs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-user-docs-shots-'));
const userDataPath = path.join(tempRoot, 'user-data');
const cdpPort = Number(process.env.CHAMBER_USER_DOCS_CDP_PORT ?? 9560);
const cdpUrl = `http://127.0.0.1:${cdpPort}`;

const mindPaths = {
  monica: path.join(tempRoot, 'monica'),
  lucy: path.join(tempRoot, 'lucy'),
  bob: path.join(tempRoot, 'bob'),
};

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  seedMind(mindPaths.monica, 'Monica', 'A meticulous, upbeat organizer for plans and follow-through.');
  seedMind(mindPaths.lucy, 'Lucy', 'A strategic clarity partner for decisions and briefings.');
  seedMind(mindPaths.bob, 'Bob', 'A pragmatic reviewer for risks and tradeoffs.');
  writeLensView(mindPaths.monica);
  writeCanvasLensView(mindPaths.monica);

  const child = spawnNpmStart();
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  let browser;
  try {
    await waitForCdp(logs);
    browser = await chromium.connectOverCDP(cdpUrl);
    const page = await findRendererPage(browser, logs);
    await preparePage(page);
    await authenticateIfNeeded(page);

    const minds = await loadMinds(page);
    await captureMainLayout(page, minds.monica);
    await captureChatWorkLog(page, minds.monica);
    await captureConversationHistory(page, minds.monica);
    await captureMindProfileControls(page);
    await captureLensStatusBoard(page);
    await captureCanvasBrowserSite(page);
    await captureChatroomModes(page);
    await captureSettingsAccounts(page);
    await captureUpdaterIconStates();

    console.log(`Captured user documentation screenshots in ${path.relative(repoRoot, outputDir)}`);
  } finally {
    await browser?.close().catch(() => {});
    if (!child.killed) child.kill();
    await removeTempRoot(tempRoot);
  }
}

async function preparePage(page) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => window.electronAPI !== undefined);
}

async function authenticateIfNeeded(page) {
  const signIn = page.getByRole('button', { name: /Sign in with GitHub/i });
  if (await signIn.count() === 0) return;

  await signIn.click();
  await page.waitForFunction(() => window.electronAPI?.e2e !== undefined);
  await page.evaluate(async () => {
    await window.electronAPI.e2e.completeLoginStub({ success: true, login: 'chamber-demo' });
  });
  await page.getByText(/Authenticated as @chamber-demo/i).waitFor({ state: 'visible', timeout: 10_000 });
}

async function loadMinds(page) {
  const minds = await page.evaluate(async (paths) => {
    const loaded = {};
    for (const [key, mindPath] of Object.entries(paths)) {
      loaded[key] = await window.electronAPI.mind.add(mindPath);
    }
    await window.electronAPI.mind.setActive(loaded.monica.mindId);
    return loaded;
  }, mindPaths);
  await page.locator('button').filter({ hasText: /\bMonica\b/ }).first().click();
  await page.getByPlaceholder(/Message your agent/).waitFor({ state: 'visible' });
  return minds;
}

async function captureMainLayout(page) {
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  await page.getByText('How can I help you today?').waitFor({ state: 'visible', timeout: 30_000 });
  await screenshot(page, 'main-layout.png');
}

async function captureChatWorkLog(page, monica) {
  await hydrateChatState(page, monica.mindId, [
    {
      id: 'user-docs-user-work-log',
      role: 'user',
      blocks: [{ type: 'text', content: 'Turn these launch notes into a status board and call out the blockers.' }],
      timestamp: Date.now() - 90_000,
    },
    {
      id: 'user-docs-assistant-work-log',
      role: 'assistant',
      blocks: [
        {
          type: 'tool_call',
          toolCallId: 'tc-read-notes',
          toolName: 'read_file',
          status: 'done',
          arguments: { path: 'launch-notes.md' },
          output: 'Read launch notes and found 8 action items.\nIdentified 2 blocked items and 3 owner gaps.',
        },
        {
          type: 'reasoning',
          reasoningId: 'r-grouping',
          content: 'Grouping the work by status makes the blockers visible without requiring a long chat reply.',
        },
        {
          type: 'tool_call',
          toolCallId: 'tc-lens',
          toolName: 'lens_create',
          status: 'running',
          arguments: { view: 'status-board', name: 'Launch Tracker' },
          output: 'Creating a status-board view for the launch plan...\nAdding columns for owner, next step, and blocker.',
        },
        {
          type: 'text',
          content: 'I found the main launch risks and started building a status board so you can track them visually.',
        },
      ],
      timestamp: Date.now() - 70_000,
      isStreaming: true,
    },
  ], { [monica.mindId]: true });
  await page.getByText(/Work log/).waitFor({ state: 'visible', timeout: 10_000 });
  await screenshot(page, 'chat-work-log.png');
}

async function captureConversationHistory(page, monica) {
  await hydrateChatState(page, monica.mindId, [
    {
      id: 'history-user',
      role: 'user',
      blocks: [{ type: 'text', content: 'Create a weekly priorities brief.' }],
      timestamp: Date.now() - 120_000,
    },
    {
      id: 'history-assistant',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'Here is a focused weekly brief with priorities, risks, and next actions.' }],
      timestamp: Date.now() - 100_000,
    },
  ], { [monica.mindId]: false });
  await page.evaluate((mindId) => {
    const now = new Date().toISOString();
    window.__chamberDocConversationHistory = [
      {
        sessionId: 'weekly-priorities',
        title: 'Weekly priorities brief',
        createdAt: now,
        updatedAt: now,
        kind: 'chat',
        active: true,
        hasMessages: true,
      },
      {
        sessionId: 'launch-review',
        title: 'Launch review follow-up',
        createdAt: now,
        updatedAt: now,
        kind: 'chat',
        active: false,
        hasMessages: true,
      },
    ];
    window.electronAPI.conversationHistory.list = async (requestedMindId) =>
      requestedMindId === mindId ? window.__chamberDocConversationHistory : [];
  }, monica.mindId);
  await page.reload();
  await preparePage(page);
  await page.locator('button').filter({ hasText: /\bMonica\b/ }).first().click();
  await hydrateChatState(page, monica.mindId, [
    {
      id: 'history-user',
      role: 'user',
      blocks: [{ type: 'text', content: 'Create a weekly priorities brief.' }],
      timestamp: Date.now() - 120_000,
    },
    {
      id: 'history-assistant',
      role: 'assistant',
      blocks: [{ type: 'text', content: 'Here is a focused weekly brief with priorities, risks, and next actions.' }],
      timestamp: Date.now() - 100_000,
    },
  ], { [monica.mindId]: false });
  await page.getByLabel('Conversation history').waitFor({ state: 'visible' });
  await screenshot(page, 'conversation-history.png');
}

async function captureMindProfileControls(page) {
  await page.locator('button').filter({ hasText: /\bLucy\b/ }).first().click();
  await page.getByRole('button', { name: 'Edit Lucy profile', exact: true }).waitFor({ state: 'visible' });
  await screenshot(page, 'mind-profile-controls.png');
}

async function captureLensStatusBoard(page) {
  await page.locator('button').filter({ hasText: /\bMonica\b/ }).first().click();
  await page.getByRole('button', { name: 'Launch Tracker' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Launch Tracker' }).click();
  await page.getByRole('heading', { name: 'Launch Tracker' }).waitFor({ state: 'visible' });
  await screenshot(page, 'lens-status-board.png');
}

async function captureCanvasBrowserSite(page) {
  await page.getByRole('button', { name: 'Launch Dashboard' }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('button', { name: 'Launch Dashboard' }).click();
  const frame = page.frameLocator('iframe[title="Launch Dashboard"]');
  await frame.getByRole('heading', { name: 'Launch Command Center' }).waitFor({ state: 'visible' });
  await screenshot(page, 'canvas-browser-site.png');
}

async function captureChatroomModes(page) {
  await page.getByRole('button', { name: 'Chatroom' }).click();
  await page.getByTestId('orchestration-picker').waitFor({ state: 'visible' });
  await page.getByTestId('orchestration-picker').getByRole('button', { name: 'Magentic' }).click();
  await screenshot(page, 'chatroom-modes.png');
}

async function captureSettingsAccounts(page) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor({ state: 'visible' });
  await screenshot(page, 'settings-accounts.png');
}

async function hydrateChatState(page, mindId, messages, streamingByMind) {
  await page.evaluate(({ mindId, messages, streamingByMind }) => {
    const channel = new BroadcastChannel('chamber:chatState:v1');
    channel.postMessage({
      type: 'state',
      payload: {
        messagesByMind: { [mindId]: messages },
        streamingByMind,
      },
    });
    channel.close();
  }, { mindId, messages, streamingByMind });
  await delay(250);
}

async function screenshot(page, name) {
  await page.screenshot({
    path: path.join(outputDir, name),
    fullPage: false,
  });
  console.log(`Captured ${name}`);
}

async function captureUpdaterIconStates() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
body{margin:0;width:960px;height:540px;display:grid;place-items:center;background:linear-gradient(180deg,#f2f3f7,#e7e8ee);font-family:Inter,Segoe UI,sans-serif;color:#111114}
.panel{width:820px;border:1px solid rgba(17,17,20,.14);border-radius:18px;background:rgba(255,255,255,.76);padding:34px;box-shadow:0 28px 70px rgba(45,46,58,.18)}
h1{margin:0 0 8px;font-size:28px;font-weight:500}.hint{margin:0 0 28px;color:#62636f}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}
.card{position:relative;border:1px solid rgba(17,17,20,.14);border-radius:14px;background:white;padding:18px;min-height:150px}
.bar{width:48px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:#15151a;padding:8px;display:grid;gap:8px;margin-bottom:14px}
.icon{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;color:#a9abb8}.active{background:#2b2c34;color:white}.attention{color:#fde047}.dot{position:absolute;top:24px;left:47px;width:8px;height:8px;border-radius:50%;background:#fde047}
svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.title{font-weight:700;margin-bottom:8px}.copy{font-size:12px;color:#62636f;line-height:1.45}
</style>
</head>
<body>
<section class="panel">
<h1>Chamber updater states</h1>
<p class="hint">The updater lives near Settings at the bottom of the Activity Bar.</p>
<div class="grid">
${updaterCard('Check', 'Up to date or ready to check again.', refreshIcon())}
${updaterCard('Download', 'A new version is available.', downloadIcon(), true)}
${updaterCard('Downloading', 'Wait while progress completes.', refreshIcon(), false, true)}
${updaterCard('Restart', 'Downloaded and ready to install.', rocketIcon(), true)}
${updaterCard('Retry', 'Something failed; try again.', rotateIcon())}
</div>
</section>
</body>
</html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  await page.setContent(html);
  await page.screenshot({ path: path.join(outputDir, 'updater-icon-states.png'), fullPage: false });
  await browser.close();
  console.log('Captured updater-icon-states.png');
}

function updaterCard(title, copy, icon, attention = false, busy = false) {
  return `<article class="card">${attention ? '<span class="dot"></span>' : ''}
  <div class="bar"><div class="icon active ${attention ? 'attention' : ''}">${icon}</div><div class="icon">${settingsIcon()}</div></div>
  <div class="title">${title}</div><div class="copy">${copy}${busy ? ' The icon may spin in the app.' : ''}</div></article>`;
}

function refreshIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.2 6.5"/><path d="M3 12A9 9 0 0 1 18.2 5.5"/><path d="M18 2v4h4"/><path d="M6 22v-4H2"/></svg>';
}

function downloadIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';
}

function rocketIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M4.5 16.5c-1 1-1.5 3-1.5 4.5 1.5 0 3.5-.5 4.5-1.5"/><path d="M9 15l-3-3a20 20 0 0 1 10-9l5 5a20 20 0 0 1-9 10z"/><path d="M15 9h.01"/></svg>';
}

function rotateIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 0 1 15.7-6.2L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.7 6.2L3 16"/><path d="M3 21v-5h5"/></svg>';
}

function settingsIcon() {
  return '<svg viewBox="0 0 24 24"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
}

function writeLensView(root) {
  const viewDir = path.join(root, '.github', 'lens', 'launch-tracker');
  fs.mkdirSync(viewDir, { recursive: true });
  fs.writeFileSync(
    path.join(viewDir, 'view.json'),
    JSON.stringify({
      name: 'Launch Tracker',
      icon: 'layout',
      view: 'status-board',
      source: 'data.json',
      prompt: 'Refresh the launch tracker.',
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(viewDir, 'data.json'),
    JSON.stringify({
      name: 'Executive readiness',
      status: 'active',
      owner: 'Lucy',
      nextStep: 'Confirm launch narrative',
      blocker: 'Customer quotes pending',
    }, null, 2),
  );
}

function writeCanvasLensView(root) {
  const viewDir = path.join(root, '.github', 'lens', 'launch-dashboard');
  fs.mkdirSync(viewDir, { recursive: true });
  fs.writeFileSync(
    path.join(viewDir, 'view.json'),
    JSON.stringify({
      name: 'Launch Dashboard',
      icon: 'layout',
      view: 'canvas',
      source: 'index.html',
    }, null, 2),
  );
  fs.writeFileSync(
    path.join(viewDir, 'index.html'),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
body{margin:0;background:#101014;color:#f6f6f8;font-family:Inter,Segoe UI,sans-serif}
main{min-height:100vh;padding:42px;background:radial-gradient(circle at 75% 0%,rgba(117,87,223,.32),transparent 360px),#101014}
.badge{display:inline-block;color:#b9a8ff;border:1px solid rgba(185,168,255,.35);border-radius:999px;padding:6px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.18em}
h1{font-size:48px;font-weight:300;letter-spacing:.08em;text-transform:uppercase;margin:24px 0}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.card{border:1px solid rgba(255,255,255,.13);border-radius:18px;background:rgba(255,255,255,.07);padding:22px}
.metric{font-size:34px;color:#fff}.label{color:#a7a7b4;font-size:13px}.wide{grid-column:span 3}
</style>
</head>
<body>
<main>
<span class="badge">Canvas generated site</span>
<h1>Launch Command Center</h1>
<section class="grid">
<article class="card"><div class="metric">87%</div><div class="label">Readiness</div></article>
<article class="card"><div class="metric">3</div><div class="label">Open decisions</div></article>
<article class="card"><div class="metric">1</div><div class="label">Blocked item</div></article>
<article class="card wide"><strong>Next action:</strong> confirm customer quotes, then refresh the executive briefing.</article>
</section>
</main>
</body>
</html>`,
    'utf8',
  );
}

function seedMind(root, name, description) {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.mkdirSync(path.join(root, '.working-memory'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [`# ${name}`, '', description, '', '## Focus', '', '- Keep work visible.', '- Explain next steps clearly.', ''].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', `${slugify(name)}.agent.md`),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`, ''].join('\n'),
  );
  for (const file of ['memory.md', 'rules.md', 'log.md']) {
    fs.writeFileSync(path.join(root, '.working-memory', file), '');
  }
}

function spawnNpmStart() {
  const env = {
    ...process.env,
    CHAMBER_DISABLE_SINGLE_INSTANCE_LOCK: '1',
    CHAMBER_E2E: '1',
    CHAMBER_E2E_CDP_PORT: String(cdpPort),
    CHAMBER_E2E_USER_DATA: userDataPath,
  };
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/d', '/s', '/c', 'npm start'], {
      cwd: repoRoot,
      env,
      windowsHide: true,
    });
  }
  return spawn('sh', ['-lc', 'npm start'], { cwd: repoRoot, env });
}

async function waitForCdp(logs) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) return;
    } catch {
      // Keep polling until Electron enables the debugging endpoint.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for Electron CDP endpoint at ${cdpUrl}.\n${logsPreview(logs)}`);
}

async function findRendererPage(browser, logs) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => /localhost|127\.0\.0\.1/.test(candidate.url()));
      if (page) return page;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for Electron renderer page.\n${logsPreview(logs)}`);
}

function logsPreview(logs) {
  return logs.slice(-80).join('\n');
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function removeTempRoot(root) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== 'EPERM' || attempt === 9) {
        console.warn(`[capture-user-docs-screenshots] Failed to remove temp root ${root}:`, error);
        return;
      }
      await delay(250);
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
