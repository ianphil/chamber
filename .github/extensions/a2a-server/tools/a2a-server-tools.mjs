export function createA2AServerTools(state) {
  return [
    {
      name: "chamber_a2a_server_start",
      description: "Start the local A2A relay server and return its loopback URL and bearer token.",
      parameters: {
        type: "object",
        properties: {
          port: {
            type: "number",
            description: "Optional loopback port. Defaults to an ephemeral port.",
          },
        },
      },
      handler: async (args) => {
        const { port, token } = await state.server.start(Number.isInteger(args.port) ? args.port : 0);
        return { base_url: `http://127.0.0.1:${port}`, token };
      },
    },
    {
      name: "chamber_a2a_server_list_agents",
      description: "List agent cards currently registered with the local A2A relay.",
      parameters: { type: "object", properties: {} },
      handler: async () => ({ agents: state.server.listAgents() }),
    },
    {
      name: "chamber_a2a_server_stop",
      description: "Stop the local A2A relay server.",
      parameters: { type: "object", properties: {} },
      handler: async () => {
        await state.server.stop();
        return { stopped: true };
      },
    },
  ];
}
