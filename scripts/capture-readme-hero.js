const { chromium } = require('@playwright/test');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const cdpPort = Number(process.env.CHAMBER_HERO_CDP_PORT ?? 9555);
const cdpUrl = `http://127.0.0.1:${cdpPort}`;
const outputPath = path.join(repoRoot, 'docs', 'assets', 'chamber-hero.png');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-readme-hero-'));
const userDataPath = path.join(tempRoot, 'user-data');
const mindPath = path.join(tempRoot, 'demo-chief-of-staff');

async function main() {
  seedMind(mindPath);
  const child = spawnNpmStart();
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr.on('data', (chunk) => logs.push(String(chunk)));

  let browser;
  try {
    await waitForCdp(logs);
    browser = await chromium.connectOverCDP(cdpUrl);
    const page = await findRendererPage(browser, logs);

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
    await authenticateIfNeeded(page);

    const mind = await page.evaluate(async (pathToMind) => {
      const loaded = await window.electronAPI.mind.add(pathToMind);
      await window.electronAPI.mind.setActive(loaded.mindId);
      return loaded;
    }, mindPath);

    await page.getByRole('button', { name: mind.identity.name }).click();
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await page.getByPlaceholder(/Message your agent/).focus();
    await page.getByText('How can I help you today?').waitFor({ state: 'visible', timeout: 30_000 });

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.screenshot({ path: outputPath, fullPage: false });
    console.log(`Captured README hero image at ${path.relative(repoRoot, outputPath)}`);
  } finally {
    await browser?.close().catch(() => {});
    if (!child.killed) child.kill();
    await removeTempRoot(tempRoot);
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

async function authenticateIfNeeded(page) {
  const signIn = page.getByRole('button', { name: /Sign in with GitHub/i });
  if (await signIn.count() === 0) return;

  await signIn.click();
  await page.waitForFunction(() => window.electronAPI?.e2e !== undefined);
  await page.evaluate(async () => {
    await window.electronAPI.e2e.completeLoginStub({ success: true, login: 'chamber-demo' });
  });
  await page.getByText(/Authenticated as @chamber-demo/i).waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByRole('button', { name: /New Agent/i }).waitFor({ state: 'visible', timeout: 10_000 });
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

function seedMind(root) {
  fs.mkdirSync(path.join(root, '.github', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'SOUL.md'),
    [
      '# Demo Chief of Staff',
      '',
      'A deterministic demo mind for the Chamber README hero image.',
      '',
      '## Focus',
      '',
      '- Keep priorities visible.',
      '- Turn scattered context into next actions.',
      '- Coordinate work across agents and tools.',
      '',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(root, '.github', 'agents', 'demo-chief-of-staff.agent.md'),
    [
      '---',
      'name: Demo Chief of Staff',
      'description: Demo persona for Chamber product screenshots',
      '---',
      '',
      '# Demo Chief of Staff',
      '',
      'You help the user understand priorities, context, and next actions.',
      '',
    ].join('\n'),
  );
}

function logsPreview(logs) {
  return logs.slice(-80).join('\n');
}

async function removeTempRoot(root) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error.code !== 'EPERM' || attempt === 9) {
        console.warn(`[capture-readme-hero] Failed to remove temp root ${root}:`, error);
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
