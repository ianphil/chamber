import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSessionTools } from './tools';

const mockRouter = {
  sendMessage: vi.fn(async (req: any) => ({
    message: {
      messageId: req.message.messageId,
      contextId: 'ctx-assigned',
      role: 'user',
      parts: req.message.parts,
    },
  })),
};

const mockRegistry = {
  getCard: vi.fn(),
  getCards: vi.fn(() => [
    {
      mindId: 'mind-a',
      name: 'Agent A',
      description: 'First agent',
      version: '1.0.0',
      supportedInterfaces: [
        { url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    },
    {
      mindId: 'mind-b',
      name: 'Agent B',
      description: 'Second agent',
      version: '1.0.0',
      supportedInterfaces: [
        { url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    },
    {
      mindId: 'mind-c',
      name: 'Agent C',
      description: 'Third agent',
      version: '1.0.0',
      supportedInterfaces: [
        { url: 'in-process', protocolBinding: 'IN_PROCESS', protocolVersion: '1.0' },
      ],
      capabilities: { streaming: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [],
    },
  ]),
  getCardByName: vi.fn(),
};

const extensionTools = [
  { name: 'canvas_show', description: 'Show canvas', handler: vi.fn() },
  { name: 'cron_create', description: 'Create cron', handler: vi.fn() },
];

describe('A2A Tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('buildSessionTools() merges extension tools with A2A tools', () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    expect(tools.length).toBe(4); // 2 extension + 2 A2A
  });

  it('buildSessionTools() includes send_message and list_agents', () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    const names = tools.map((t) => t.name);
    expect(names).toContain('a2a_send_message');
    expect(names).toContain('a2a_list_agents');
  });

  it('send_message tool has correct parameter schema', () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message')!;
    expect(sendTool.parameters).toBeDefined();
    const params = sendTool.parameters as any;
    expect(params.properties.recipient).toBeDefined();
    expect(params.properties.message).toBeDefined();
    expect(params.required).toContain('recipient');
    expect(params.required).toContain('message');
  });

  it('send_message handler constructs conformant A2A Message', async () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message')!;
    await sendTool.handler({ recipient: 'mind-b', message: 'Hello B' });

    expect(mockRouter.sendMessage).toHaveBeenCalledTimes(1);
    const req = mockRouter.sendMessage.mock.calls[0][0];
    expect(req.message.role).toBe('user');
    expect(req.message.parts[0].text).toBe('Hello B');
    expect(req.message.parts[0].mediaType).toBe('text/plain');
    expect(req.message.metadata.fromId).toBe('mind-a');
    expect(req.message.metadata.hopCount).toBe(0);
  });

  it('send_message handler constructs SendMessageRequest with returnImmediately', async () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message')!;
    await sendTool.handler({ recipient: 'mind-b', message: 'Hello' });

    const req = mockRouter.sendMessage.mock.calls[0][0];
    expect(req.recipient).toBe('mind-b');
    expect(req.configuration.returnImmediately).toBe(true);
  });

  it('send_message handler returns SendMessageResponse shape', async () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message')!;
    const result = await sendTool.handler({ recipient: 'mind-b', message: 'Hello' });

    expect(result).toHaveProperty('message');
    expect((result as any).message.contextId).toBe('ctx-assigned');
  });

  it('send_message handler passes context_id when provided', async () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    const sendTool = tools.find((t) => t.name === 'a2a_send_message')!;
    await sendTool.handler({
      recipient: 'mind-b',
      message: 'Follow up',
      context_id: 'ctx-existing',
    });

    const req = mockRouter.sendMessage.mock.calls[0][0];
    expect(req.message.contextId).toBe('ctx-existing');
  });

  it('list_agents returns AgentCards excluding self', async () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    const listTool = tools.find((t) => t.name === 'a2a_list_agents')!;
    const result = await listTool.handler({});

    expect(Array.isArray(result)).toBe(true);
    const agents = result as any[];
    expect(agents.length).toBe(2); // 3 total minus self (mind-a)
    expect(agents.every((a: any) => a.mindId !== 'mind-a')).toBe(true);
  });

  it('list_agents returns full A2A AgentCard shape', async () => {
    const tools = buildSessionTools(
      'mind-a',
      extensionTools as any,
      mockRouter as any,
      mockRegistry as any,
    );
    const listTool = tools.find((t) => t.name === 'a2a_list_agents')!;
    const result = (await listTool.handler({})) as any[];

    const card = result[0];
    expect(card).toHaveProperty('name');
    expect(card).toHaveProperty('description');
    expect(card).toHaveProperty('skills');
    expect(card).toHaveProperty('supportedInterfaces');
    expect(card).toHaveProperty('mindId');
  });

  it('tools are mind-scoped via closure', async () => {
    const toolsA = buildSessionTools('mind-a', [], mockRouter as any, mockRegistry as any);
    const toolsB = buildSessionTools('mind-b', [], mockRouter as any, mockRegistry as any);

    const sendA = toolsA.find((t) => t.name === 'a2a_send_message')!;
    const sendB = toolsB.find((t) => t.name === 'a2a_send_message')!;

    await sendA.handler({ recipient: 'mind-c', message: 'From A' });
    await sendB.handler({ recipient: 'mind-c', message: 'From B' });

    expect(mockRouter.sendMessage.mock.calls[0][0].message.metadata.fromId).toBe('mind-a');
    expect(mockRouter.sendMessage.mock.calls[1][0].message.metadata.fromId).toBe('mind-b');
  });
});
