const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SEND_TIMEOUT_MS = 180_000;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const repoRoot = process.cwd();
  const modulesDir = path.join(repoRoot, 'node_modules');
  const sdkEntry = path.join(modulesDir, '@github', 'copilot-sdk', 'dist', 'index.js');
  const cliPath = path.join(
    modulesDir,
    '@github',
    getPlatformCopilotPackageName().split('/')[1],
    process.platform === 'win32' ? 'copilot.exe' : 'copilot',
  );
  const mindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-sdk-smoke-'));
  const logDir = path.join(os.homedir(), '.chamber', 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(mindPath, 'SOUL.md'), '# Smoke Mind\n\nReply briefly and do not use tools.\n');

  const sdk = await import(pathToFileURL(sdkEntry).href);
  const contracts = await importSdkContractMappers(repoRoot);
  const client = createSmokeClient(sdk, { cliPath, mindPath, logDir });

  let session;
  try {
    await client.start();
    session = await client.createSession({
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: async () => ({ kind: 'allow' }),
      onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
    });
    await session.rpc.permissions.setApproveAll({ enabled: true });

    const response = await sendAndWaitForResponse(session, 'Reply with exactly: Chamber SDK smoke ok');
    if (!response.includes('Chamber')) {
      throw new Error(`Unexpected SDK smoke response: ${response}`);
    }
    await assertToolEventContract({ client, contracts, logDir });
    await assertNamedSessionResume({ sdk, cliPath, mindPath, logDir, contracts });
    console.log('SDK smoke passed.');
  } finally {
    await session?.disconnect().catch(() => undefined);
    await client.stop().catch(() => undefined);
    await cleanupMind(mindPath);
  }
}

async function assertNamedSessionResume({ sdk, cliPath, mindPath, logDir, contracts }) {
  const sessionId = `chamber-sdk-smoke-${Date.now()}`;
  const firstClient = createSmokeClient(sdk, { cliPath, mindPath, logDir });
  const secondClient = createSmokeClient(sdk, { cliPath, mindPath, logDir });
  const thirdClient = createSmokeClient(sdk, { cliPath, mindPath, logDir });
  let firstSession;
  let resumedSession;
  let resumedAgainSession;
  try {
    await firstClient.start();
    firstSession = await firstClient.createSession({
      sessionId,
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: async () => ({ kind: 'allow' }),
      onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
    });
    await firstSession.rpc.permissions.setApproveAll({ enabled: true });
    await sendAndWaitForResponse(firstSession, 'Remember this exact token: chamber-resume-smoke');
    await firstSession.disconnect();
    firstSession = undefined;
    await firstClient.stop();

    await secondClient.start();
    resumedSession = await secondClient.resumeSession(sessionId, {
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: async () => ({ kind: 'allow' }),
      onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
    });
    await resumedSession.rpc.permissions.setApproveAll({ enabled: true });
    const messages = await resumedSession.getEvents();
    if (!messages.some((event) => JSON.stringify(event).includes('chamber-resume-smoke'))) {
      throw new Error('Named SDK session resume did not restore prior messages.');
    }
    const response = await sendAndWaitForResponse(resumedSession, 'What exact token did I ask you to remember?');
    if (!response.includes('chamber-resume-smoke')) {
      throw new Error(`Named SDK session did not continue prior context: ${response}`);
    }
    await resumedSession.disconnect();
    resumedSession = undefined;
    await secondClient.stop();

    await thirdClient.start();
    resumedAgainSession = await thirdClient.resumeSession(sessionId, {
      streaming: true,
      workingDirectory: mindPath,
      onPermissionRequest: async () => ({ kind: 'allow' }),
      onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
    });
    await resumedAgainSession.rpc.permissions.setApproveAll({ enabled: true });
    const secondResumeMessages = await resumedAgainSession.getEvents();
    if (!secondResumeMessages.some((event) => JSON.stringify(event).includes('chamber-resume-smoke'))) {
      throw new Error('Named SDK session second resume did not restore prior messages.');
    }
    await resumedAgainSession.disconnect();
    resumedAgainSession = undefined;

    await assertModelResumePreservesContext({ client: thirdClient, sessionId, mindPath, contracts });
  } finally {
    await resumedAgainSession?.disconnect().catch(() => undefined);
    await resumedSession?.disconnect().catch(() => undefined);
    await firstSession?.disconnect().catch(() => undefined);
    await thirdClient.deleteSession?.(sessionId).catch(() => undefined);
    await thirdClient.stop().catch(() => undefined);
    await secondClient.stop().catch(() => undefined);
    await firstClient.stop().catch(() => undefined);
  }
}

async function assertModelResumePreservesContext({ client, sessionId, mindPath, contracts }) {
  const models = assertLiveModelListContract(await client.listModels(), contracts);
  if (!Array.isArray(models) || models.length < 2) {
    console.warn('SDK smoke skipped cross-model resume check: fewer than two models available.');
    return;
  }
  const model = models[1].id;
  let modelSession;
  try {
    modelSession = await client.resumeSession(sessionId, {
      streaming: true,
      workingDirectory: mindPath,
      model,
      onPermissionRequest: async () => ({ kind: 'allow' }),
      onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
    });
    await modelSession.rpc.permissions.setApproveAll({ enabled: true });
    const messages = await modelSession.getEvents();
    if (!messages.some((event) => JSON.stringify(event).includes('chamber-resume-smoke'))) {
      throw new Error(`Named SDK session resumed with model ${model} did not restore prior messages.`);
    }
    const response = await sendAndWaitForResponse(modelSession, 'What exact token did I ask you to remember?');
    if (!response.includes('chamber-resume-smoke')) {
      throw new Error(`Named SDK session resumed with model ${model} did not continue prior context: ${response}`);
    }
  } finally {
    await modelSession?.disconnect().catch(() => undefined);
  }
}

async function assertToolEventContract({ client, contracts }) {
  const toolMindPath = fs.mkdtempSync(path.join(os.tmpdir(), 'chamber-sdk-tool-smoke-'));
  fs.writeFileSync(
    path.join(toolMindPath, 'SOUL.md'),
    [
      '# Tool Contract Smoke Mind',
      '',
      'When asked to run the Chamber SDK contract probe, call the chamber_contract_probe tool exactly once.',
      'After the tool result returns, reply briefly with the returned token.',
    ].join('\n'),
  );

  const tool = {
    name: 'chamber_contract_probe',
    description: 'Return a deterministic Chamber SDK contract smoke payload. Use this when asked to run the Chamber SDK contract probe.',
    parameters: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'The exact token to echo.' },
      },
      required: ['token'],
    },
    skipPermission: true,
    handler: async (args) => {
      return `CHAMBER_TOOL_CONTRACT_OK:${args?.token ?? ''}`;
    },
  };

  let lastResponse = '';
  try {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const startEvents = [];
      const completeEvents = [];
      let toolSession;
      const unsubs = [];
      try {
        toolSession = await client.createSession({
          streaming: true,
          workingDirectory: toolMindPath,
          tools: [tool],
          systemMessage: {
            mode: 'append',
            content: 'For this smoke test, tool use is required when the user asks for the Chamber SDK contract probe.',
          },
          onPermissionRequest: async () => ({ kind: 'allow' }),
          onUserInputRequest: async () => ({ answer: 'Proceed.', wasFreeform: true }),
        });
        await toolSession.rpc.permissions.setApproveAll({ enabled: true });
        unsubs.push(
          toolSession.on('tool.execution_start', (event) => startEvents.push(event)),
          toolSession.on('tool.execution_complete', (event) => completeEvents.push(event)),
        );

        lastResponse = await sendAndWaitForResponse(
          toolSession,
          'Run the Chamber SDK contract probe now. Call chamber_contract_probe with token "chamber-tool-contract" before answering.',
        );

        const start = startEvents.find((event) => {
          const mapped = contracts.mapSdkToolExecutionStart(event);
          return mapped.toolName === 'chamber_contract_probe';
        });
        if (start) {
          const mappedStart = contracts.mapSdkToolExecutionStart(start);
          const complete = completeEvents.find((event) => {
            const mapped = contracts.mapSdkToolExecutionComplete(event);
            return mapped.toolCallId === mappedStart.toolCallId;
          });
          if (!complete) continue;
          const mappedComplete = contracts.mapSdkToolExecutionComplete(complete);
          if (mappedStart.args?.token !== 'chamber-tool-contract') {
            throw new Error(`SDK tool start contract emitted unexpected arguments: ${JSON.stringify(mappedStart.args)}`);
          }
          if (!mappedComplete.success || !mappedComplete.result?.includes('CHAMBER_TOOL_CONTRACT_OK:chamber-tool-contract')) {
            throw new Error(`SDK tool complete contract emitted unexpected result: ${JSON.stringify(mappedComplete)}`);
          }
          return;
        }
      } finally {
        for (const unsub of unsubs) unsub();
        await toolSession?.disconnect().catch(() => undefined);
      }
    }

    throw new Error(`SDK smoke did not observe deterministic tool execution events. Last response: ${lastResponse}`);
  } finally {
    await cleanupMind(toolMindPath);
  }
}

function createSmokeClient(sdk, { cliPath, mindPath, logDir }) {
  return new sdk.CopilotClient({
    connection: sdk.RuntimeConnection.forStdio({
      path: cliPath,
      args: [
        '--log-dir', logDir,
        '--allow-all-tools',
        '--allow-all-paths',
        '--allow-all-urls',
      ],
    }),
    workingDirectory: mindPath,
    logLevel: 'all',
  });
}

function assertLiveModelListContract(rawModels, contracts) {
  const models = contracts.mapSdkModelList(rawModels);
  if (!models.some((model) => model.id.trim() && model.name.trim())) {
    throw new Error('SDK model-list contract returned no usable models.');
  }
  return models;
}

async function cleanupMind(mindPath) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(mindPath, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        console.warn(`SDK smoke could not delete temp mind ${mindPath}: ${error.message}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function importSdkContractMappers(repoRoot) {
  const sdkDir = path.join(repoRoot, 'packages', 'services', 'src', 'sdk');
  const [chatContracts, modelContracts] = await Promise.all([
    import(pathToFileURL(path.join(sdkDir, 'sdkChatEventMapper.ts')).href),
    import(pathToFileURL(path.join(sdkDir, 'sdkModelMapper.ts')).href),
  ]);

  return {
    mapSdkModelList: modelContracts.mapSdkModelList,
    mapSdkToolExecutionStart: chatContracts.mapSdkToolExecutionStart,
    mapSdkToolExecutionComplete: chatContracts.mapSdkToolExecutionComplete,
  };
}

function sendAndWaitForResponse(session, prompt) {
  return new Promise((resolve, reject) => {
    let finalMessage = '';
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for SDK smoke response.'));
    }, SEND_TIMEOUT_MS);

    const unsubMessage = session.on('assistant.message', (event) => {
      finalMessage = event.data.content;
    });
    const unsubIdle = session.on('session.idle', () => {
      cleanup();
      resolve(finalMessage);
    });
    const unsubError = session.on('session.error', (event) => {
      cleanup();
      reject(new Error(event.data.message));
    });

    session.send({ prompt }).catch((error) => {
      cleanup();
      reject(error);
    });

    function cleanup() {
      clearTimeout(timeout);
      unsubMessage();
      unsubIdle();
      unsubError();
    }
  });
}

function getPlatformCopilotPackageName() {
  return `@github/copilot-${normalizePlatform(process.platform)}-${normalizeArch(process.arch)}`;
}

function normalizePlatform(platform) {
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    return platform;
  }
  throw new Error(`Unsupported Copilot runtime platform: ${platform}`);
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 'arm64') {
    return arch;
  }
  throw new Error(`Unsupported Copilot runtime arch: ${arch}`);
}
