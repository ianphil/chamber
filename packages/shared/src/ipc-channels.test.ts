import { describe, it, expect, expectTypeOf } from 'vitest';
import { IPC, type IpcChannel } from './ipc-channels';

describe('IPC channel constants', () => {
  it('preserves the exact channel strings used on the IPC wire', () => {
    expect(IPC.CHAT.SEND).toBe('chat:send');
    expect(IPC.CHAT.STOP).toBe('chat:stop');
    expect(IPC.CHAT.NEW_CONVERSATION).toBe('chat:newConversation');
    expect(IPC.CHAT.LIST_MODELS).toBe('chat:listModels');
    expect(IPC.CHAT.GET_EVENT_SEQUENCE).toBe('chat:getEventSequence');
    expect(IPC.CHAT.REPLAY_EVENTS).toBe('chat:replayEvents');
    expect(IPC.CHAT.EVENT).toBe('chat:event');

    expect(IPC.CONVERSATION_HISTORY.LIST).toBe('conversationHistory:list');
    expect(IPC.CONVERSATION_HISTORY.RESUME).toBe('conversationHistory:resume');
    expect(IPC.CONVERSATION_HISTORY.RENAME).toBe('conversationHistory:rename');
    expect(IPC.CONVERSATION_HISTORY.DELETE).toBe('conversationHistory:delete');

    expect(IPC.MIND.ADD).toBe('mind:add');
    expect(IPC.MIND.REMOVE).toBe('mind:remove');
    expect(IPC.MIND.LIST).toBe('mind:list');
    expect(IPC.MIND.SET_ACTIVE).toBe('mind:setActive');
    expect(IPC.MIND.SET_MODEL).toBe('mind:setModel');
    expect(IPC.MIND.SELECT_DIRECTORY).toBe('mind:selectDirectory');
    expect(IPC.MIND.OPEN_WINDOW).toBe('mind:openWindow');
    expect(IPC.MIND.CHANGED).toBe('mind:changed');

    expect(IPC.LENS.GET_VIEWS).toBe('lens:getViews');
    expect(IPC.LENS.GET_VIEW_DATA).toBe('lens:getViewData');
    expect(IPC.LENS.REFRESH_VIEW).toBe('lens:refreshView');
    expect(IPC.LENS.SEND_ACTION).toBe('lens:sendAction');
    expect(IPC.LENS.GET_CANVAS_URL).toBe('lens:getCanvasUrl');
    expect(IPC.LENS.VIEWS_CHANGED).toBe('lens:viewsChanged');

    expect(IPC.AUTH.GET_STATUS).toBe('auth:getStatus');
    expect(IPC.AUTH.LIST_ACCOUNTS).toBe('auth:listAccounts');
    expect(IPC.AUTH.START_LOGIN).toBe('auth:startLogin');
    expect(IPC.AUTH.CANCEL_LOGIN).toBe('auth:cancelLogin');
    expect(IPC.AUTH.SWITCH_ACCOUNT).toBe('auth:switchAccount');
    expect(IPC.AUTH.LOGOUT).toBe('auth:logout');
    expect(IPC.AUTH.PROGRESS).toBe('auth:progress');
    expect(IPC.AUTH.ACCOUNT_SWITCH_STARTED).toBe('auth:accountSwitchStarted');
    expect(IPC.AUTH.ACCOUNT_SWITCHED).toBe('auth:accountSwitched');
    expect(IPC.AUTH.LOGGED_OUT).toBe('auth:loggedOut');

    expect(IPC.GENESIS.GET_DEFAULT_PATH).toBe('genesis:getDefaultPath');
    expect(IPC.GENESIS.PICK_PATH).toBe('genesis:pickPath');
    expect(IPC.GENESIS.LIST_TEMPLATES).toBe('genesis:listTemplates');
    expect(IPC.GENESIS.CREATE).toBe('genesis:create');
    expect(IPC.GENESIS.CREATE_FROM_TEMPLATE).toBe('genesis:createFromTemplate');
    expect(IPC.GENESIS.PROGRESS).toBe('genesis:progress');

    expect(IPC.MARKETPLACE.LIST_GENESIS_REGISTRIES).toBe('marketplace:listGenesisRegistries');
    expect(IPC.MARKETPLACE.ADD_GENESIS_REGISTRY).toBe('marketplace:addGenesisRegistry');
    expect(IPC.MARKETPLACE.REFRESH_GENESIS_REGISTRY).toBe('marketplace:refreshGenesisRegistry');
    expect(IPC.MARKETPLACE.SET_GENESIS_REGISTRY_ENABLED).toBe('marketplace:setGenesisRegistryEnabled');
    expect(IPC.MARKETPLACE.REMOVE_GENESIS_REGISTRY).toBe('marketplace:removeGenesisRegistry');

    expect(IPC.TOOLS.LIST).toBe('tools:list');
    expect(IPC.TOOLS.INSTALL).toBe('tools:install');
    expect(IPC.TOOLS.UNINSTALL).toBe('tools:uninstall');

    expect(IPC.BYO_LLM.GET).toBe('byoLlm:get');
    expect(IPC.BYO_LLM.SAVE).toBe('byoLlm:save');
    expect(IPC.BYO_LLM.DISABLE).toBe('byoLlm:disable');
    expect(IPC.BYO_LLM.PROBE).toBe('byoLlm:probe');
    expect(IPC.BYO_LLM.RESTART_AGENTS).toBe('byoLlm:restartAgents');
    expect(IPC.BYO_LLM.CHANGED).toBe('byoLlm:changed');

    expect(IPC.VOICE.GET_CONFIG).toBe('voice:getConfig');
    expect(IPC.VOICE.SAVE_CONFIG).toBe('voice:saveConfig');
    expect(IPC.VOICE.CHANGED).toBe('voice:changed');
    expect(IPC.VOICE.GET_PERMISSION_STATE).toBe('voice:getPermissionState');
    expect(IPC.VOICE.OPEN_MIC_PREFERENCES).toBe('voice:openMicPreferences');
    expect(IPC.VOICE.GET_MODEL_STATUS).toBe('voice:getModelStatus');
    expect(IPC.VOICE.DOWNLOAD_MODEL).toBe('voice:downloadModel');
    expect(IPC.VOICE.CANCEL_DOWNLOAD).toBe('voice:cancelDownload');
    expect(IPC.VOICE.MODEL_PROGRESS).toBe('voice:modelProgress');
    expect(IPC.VOICE.START_SESSION).toBe('voice:startSession');
    expect(IPC.VOICE.APPEND_AUDIO).toBe('voice:appendAudio');
    expect(IPC.VOICE.END_SESSION).toBe('voice:endSession');
    expect(IPC.VOICE.TRANSCRIPT).toBe('voice:transcript');
    expect(IPC.VOICE.TEST_MIC).toBe('voice:testMic');

    expect(IPC.CHATROOM.SEND).toBe('chatroom:send');
    expect(IPC.CHATROOM.HISTORY).toBe('chatroom:history');
    expect(IPC.CHATROOM.TASK_LEDGER).toBe('chatroom:task-ledger');
    expect(IPC.CHATROOM.CLEAR).toBe('chatroom:clear');
    expect(IPC.CHATROOM.STOP).toBe('chatroom:stop');
    expect(IPC.CHATROOM.SET_ORCHESTRATION).toBe('chatroom:set-orchestration');
    expect(IPC.CHATROOM.GET_ORCHESTRATION).toBe('chatroom:get-orchestration');
    expect(IPC.CHATROOM.EVENT).toBe('chatroom:event');
    expect(IPC.CHATROOM.SET_MIND_ENABLED).toBe('chatroom:set-mind-enabled');
    expect(IPC.CHATROOM.GET_DISABLED_MIND_IDS).toBe('chatroom:get-disabled-mind-ids');
    expect(IPC.CHATROOM.STATE_CHANGED).toBe('chatroom:state-changed');

    expect(IPC.UPDATER.GET_STATE).toBe('updater:get-state');
    expect(IPC.UPDATER.CHECK).toBe('updater:check');
    expect(IPC.UPDATER.DOWNLOAD).toBe('updater:download');
    expect(IPC.UPDATER.INSTALL_AND_RESTART).toBe('updater:install-and-restart');
    expect(IPC.UPDATER.STATE_CHANGED).toBe('updater:state-changed');

    expect(IPC.A2A.INCOMING).toBe('a2a:incoming');
    expect(IPC.A2A.LIST_AGENTS).toBe('a2a:listAgents');
    expect(IPC.A2A.TASK_STATUS_UPDATE).toBe('a2a:task-status-update');
    expect(IPC.A2A.TASK_ARTIFACT_UPDATE).toBe('a2a:task-artifact-update');
    expect(IPC.A2A.GET_TASK).toBe('a2a:getTask');
    expect(IPC.A2A.LIST_TASKS).toBe('a2a:listTasks');
    expect(IPC.A2A.CANCEL_TASK).toBe('a2a:cancelTask');
    expect(IPC.A2A.RELAY_STATUS).toBe('a2a:relay-status');
    expect(IPC.A2A.RELAY_CONNECT).toBe('a2a:relay-connect');
    expect(IPC.A2A.RELAY_DISCONNECT).toBe('a2a:relay-disconnect');
    expect(IPC.A2A.RELAY_STATE_CHANGED).toBe('a2a:relay-state-changed');

    expect(IPC.WINDOW.MINIMIZE).toBe('window:minimize');
    expect(IPC.WINDOW.MAXIMIZE).toBe('window:maximize');
    expect(IPC.WINDOW.CLOSE).toBe('window:close');

    expect(IPC.DESKTOP.GET_BRANDING).toBe('desktop:getBranding');
    expect(IPC.DESKTOP.CONFIRM).toBe('desktop:confirm');

    expect(IPC.E2E.IS_ENABLED).toBe('e2e:is-enabled');
    expect(IPC.E2E.A2A_INCOMING).toBe('e2e:a2a:incoming');
    expect(IPC.E2E.AUTH_EMIT_PROGRESS).toBe('e2e:auth:emit-progress');
    expect(IPC.E2E.AUTH_COMPLETE_LOGIN).toBe('e2e:auth:complete-login');
    expect(IPC.E2E.VOICE_SET_FAKE_PROVIDER).toBe('e2e:voice:setFakeProvider');
    expect(IPC.E2E.VOICE_EMIT_TRANSCRIPT).toBe('e2e:voice:emitTranscript');

    expect(IPC.APP.STARTUP_PROGRESS).toBe('app:startupProgress');
  });

  it('exposes channels as readonly literals via IpcChannel', () => {
    expectTypeOf<typeof IPC.CHAT.SEND>().toEqualTypeOf<'chat:send'>();
    expectTypeOf<'chat:send'>().toMatchTypeOf<IpcChannel>();
    expectTypeOf<'byoLlm:save'>().toMatchTypeOf<IpcChannel>();
    expectTypeOf<'voice:startSession'>().toMatchTypeOf<IpcChannel>();
    expectTypeOf<'chatroom:set-orchestration'>().toMatchTypeOf<IpcChannel>();
    // Sanity: an unrelated string is not assignable to IpcChannel.
    expectTypeOf<'not:a:channel'>().not.toMatchTypeOf<IpcChannel>();
  });

  it('has no duplicate channel strings across namespaces', () => {
    const all: string[] = [];
    for (const ns of Object.values(IPC)) {
      for (const value of Object.values(ns)) {
        all.push(value);
      }
    }
    const unique = new Set(all);
    expect(unique.size).toBe(all.length);
  });
});
