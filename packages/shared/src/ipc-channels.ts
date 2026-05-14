/**
 * Centralized IPC channel constants.
 *
 * Every channel string used between the desktop main process, preload, and
 * renderer must be declared here and consumed via the `IPC` object so there
 * is a single source of truth for channel names. Adding a new channel: pick
 * the appropriate namespace (or add one), add the constant, and use it from
 * both ends of the IPC.
 *
 * The literal values must remain stable — they are part of the IPC wire
 * format between main and renderer. Renaming a constant is fine; changing
 * its string value is a breaking change.
 */
export const IPC = {
  CHAT: {
    SEND: 'chat:send',
    STOP: 'chat:stop',
    NEW_CONVERSATION: 'chat:newConversation',
    LIST_MODELS: 'chat:listModels',
    EVENT: 'chat:event',
  },
  CONVERSATION_HISTORY: {
    LIST: 'conversationHistory:list',
    RESUME: 'conversationHistory:resume',
    RENAME: 'conversationHistory:rename',
    DELETE: 'conversationHistory:delete',
  },
  MIND: {
    ADD: 'mind:add',
    REMOVE: 'mind:remove',
    LIST: 'mind:list',
    SET_ACTIVE: 'mind:setActive',
    SET_MODEL: 'mind:setModel',
    SET_DREAM_DAEMON: 'mind:setDreamDaemon',
    SELECT_DIRECTORY: 'mind:selectDirectory',
    OPEN_WINDOW: 'mind:openWindow',
    CHANGED: 'mind:changed',
  },
  LENS: {
    GET_VIEWS: 'lens:getViews',
    GET_VIEW_DATA: 'lens:getViewData',
    REFRESH_VIEW: 'lens:refreshView',
    SEND_ACTION: 'lens:sendAction',
    GET_CANVAS_URL: 'lens:getCanvasUrl',
    VIEWS_CHANGED: 'lens:viewsChanged',
  },
  AUTH: {
    GET_STATUS: 'auth:getStatus',
    LIST_ACCOUNTS: 'auth:listAccounts',
    START_LOGIN: 'auth:startLogin',
    CANCEL_LOGIN: 'auth:cancelLogin',
    SWITCH_ACCOUNT: 'auth:switchAccount',
    LOGOUT: 'auth:logout',
    PROGRESS: 'auth:progress',
    ACCOUNT_SWITCH_STARTED: 'auth:accountSwitchStarted',
    ACCOUNT_SWITCHED: 'auth:accountSwitched',
    LOGGED_OUT: 'auth:loggedOut',
  },
  GENESIS: {
    GET_DEFAULT_PATH: 'genesis:getDefaultPath',
    PICK_PATH: 'genesis:pickPath',
    LIST_TEMPLATES: 'genesis:listTemplates',
    CREATE: 'genesis:create',
    CREATE_FROM_TEMPLATE: 'genesis:createFromTemplate',
    PROGRESS: 'genesis:progress',
  },
  MARKETPLACE: {
    LIST_GENESIS_REGISTRIES: 'marketplace:listGenesisRegistries',
    ADD_GENESIS_REGISTRY: 'marketplace:addGenesisRegistry',
    REFRESH_GENESIS_REGISTRY: 'marketplace:refreshGenesisRegistry',
    SET_GENESIS_REGISTRY_ENABLED: 'marketplace:setGenesisRegistryEnabled',
    REMOVE_GENESIS_REGISTRY: 'marketplace:removeGenesisRegistry',
  },
  USER_PROFILE: {
    GET: 'userProfile:get',
    SAVE: 'userProfile:save',
    IMPORT_FROM_MICROSOFT: 'userProfile:importFromMicrosoft',
  },
  TOOLS: {
    LIST: 'tools:list',
    INSTALL: 'tools:install',
    UNINSTALL: 'tools:uninstall',
  },
  CHATROOM: {
    SEND: 'chatroom:send',
    HISTORY: 'chatroom:history',
    TASK_LEDGER: 'chatroom:task-ledger',
    CLEAR: 'chatroom:clear',
    STOP: 'chatroom:stop',
    SET_ORCHESTRATION: 'chatroom:set-orchestration',
    GET_ORCHESTRATION: 'chatroom:get-orchestration',
    EVENT: 'chatroom:event',
    SET_MIND_ENABLED: 'chatroom:set-mind-enabled',
    GET_DISABLED_MIND_IDS: 'chatroom:get-disabled-mind-ids',
    STATE_CHANGED: 'chatroom:state-changed',
  },
  UPDATER: {
    GET_STATE: 'updater:get-state',
    CHECK: 'updater:check',
    DOWNLOAD: 'updater:download',
    INSTALL_AND_RESTART: 'updater:install-and-restart',
    STATE_CHANGED: 'updater:state-changed',
  },
  A2A: {
    INCOMING: 'a2a:incoming',
    LIST_AGENTS: 'a2a:listAgents',
    TASK_STATUS_UPDATE: 'a2a:task-status-update',
    TASK_ARTIFACT_UPDATE: 'a2a:task-artifact-update',
    GET_TASK: 'a2a:getTask',
    LIST_TASKS: 'a2a:listTasks',
    CANCEL_TASK: 'a2a:cancelTask',
    RELAY_STATUS: 'a2a:relay-status',
    RELAY_CONNECT: 'a2a:relay-connect',
    RELAY_DISCONNECT: 'a2a:relay-disconnect',
    RELAY_STATE_CHANGED: 'a2a:relay-state-changed',
  },
  WINDOW: {
    MINIMIZE: 'window:minimize',
    MAXIMIZE: 'window:maximize',
    CLOSE: 'window:close',
  },
  DESKTOP: {
    GET_BRANDING: 'desktop:getBranding',
    CONFIRM: 'desktop:confirm',
  },
  E2E: {
    IS_ENABLED: 'e2e:is-enabled',
    A2A_INCOMING: 'e2e:a2a:incoming',
    AUTH_EMIT_PROGRESS: 'e2e:auth:emit-progress',
    AUTH_COMPLETE_LOGIN: 'e2e:auth:complete-login',
  },
} as const;

type IpcNamespace = typeof IPC;
type ChannelOf<NS extends keyof IpcNamespace> = IpcNamespace[NS][keyof IpcNamespace[NS]];

export type IpcChannel = {
  [NS in keyof IpcNamespace]: ChannelOf<NS>;
}[keyof IpcNamespace];
