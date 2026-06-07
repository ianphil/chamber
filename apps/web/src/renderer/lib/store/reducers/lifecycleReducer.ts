import type { AppState, AppAction } from '../state';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

function setActiveView(state: AppState, action: Extract<AppAction, { type: 'SET_ACTIVE_VIEW' }>): Partial<AppState> {
  const next = action.payload;
  if (next === state.activeView) return { activeView: next };
  // Track the previous built-in view so a lens header can offer a back
  // button. Going TO a lens (non-built-in) saves where we came from; going
  // BACK to a built-in clears it. The activity bar's built-ins are: chat,
  // chatroom, settings, a2a-relay -- everything else is a discovered lens
  // (LensView is `'chat' | string` with no enum we can rely on).
  const BUILT_INS = new Set(['chat', 'chatroom', 'settings', 'a2a-relay']);
  const goingToLens = !BUILT_INS.has(next);
  if (goingToLens) {
    return { activeView: next, previousView: state.activeView };
  }
  return { activeView: next, previousView: null };
}

function setFeatureFlags(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_FEATURE_FLAGS' }>,
): Partial<AppState> {
  return { featureFlags: action.payload };
}

function setDiscoveredViews(
  _state: AppState,
  action: Extract<AppAction, { type: 'SET_DISCOVERED_VIEWS' }>,
): Partial<AppState> {
  return { discoveredViews: action.payload };
}

function showLanding(): Partial<AppState> {
  return { showLanding: true };
}

function hideLanding(): Partial<AppState> {
  return { showLanding: false };
}

function accountSwitchStarted(
  _state: AppState,
  action: Extract<AppAction, { type: 'ACCOUNT_SWITCH_STARTED' }>,
): Partial<AppState> {
  return {
    runtimePhase: 'switching-account',
    switchingAccountLogin: action.payload.login,
    showLanding: false,
  };
}

function accountSwitchCompleted(): Partial<AppState> {
  return {
    runtimePhase: 'ready',
    switchingAccountLogin: null,
  };
}

function loggedOut(): Partial<AppState> {
  return {
    runtimePhase: 'ready',
    switchingAccountLogin: null,
  };
}

export const lifecycleHandlers: {
  SET_ACTIVE_VIEW: Handler<'SET_ACTIVE_VIEW'>;
  SET_FEATURE_FLAGS: Handler<'SET_FEATURE_FLAGS'>;
  SET_DISCOVERED_VIEWS: Handler<'SET_DISCOVERED_VIEWS'>;
  SHOW_LANDING: Handler<'SHOW_LANDING'>;
  HIDE_LANDING: Handler<'HIDE_LANDING'>;
  ACCOUNT_SWITCH_STARTED: Handler<'ACCOUNT_SWITCH_STARTED'>;
  ACCOUNT_SWITCH_COMPLETED: Handler<'ACCOUNT_SWITCH_COMPLETED'>;
  LOGGED_OUT: Handler<'LOGGED_OUT'>;
} = {
  SET_ACTIVE_VIEW: setActiveView,
  SET_FEATURE_FLAGS: setFeatureFlags,
  SET_DISCOVERED_VIEWS: setDiscoveredViews,
  SHOW_LANDING: showLanding,
  HIDE_LANDING: hideLanding,
  ACCOUNT_SWITCH_STARTED: accountSwitchStarted,
  ACCOUNT_SWITCH_COMPLETED: accountSwitchCompleted,
  LOGGED_OUT: loggedOut,
};
