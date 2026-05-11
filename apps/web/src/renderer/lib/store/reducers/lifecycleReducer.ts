import type { AppState, AppAction } from '../state';

type Handler<T extends AppAction['type']> = (
  state: AppState,
  action: Extract<AppAction, { type: T }>,
) => Partial<AppState> | AppState;

function setActiveView(_state: AppState, action: Extract<AppAction, { type: 'SET_ACTIVE_VIEW' }>): Partial<AppState> {
  return { activeView: action.payload };
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
  SET_DISCOVERED_VIEWS: Handler<'SET_DISCOVERED_VIEWS'>;
  SHOW_LANDING: Handler<'SHOW_LANDING'>;
  HIDE_LANDING: Handler<'HIDE_LANDING'>;
  ACCOUNT_SWITCH_STARTED: Handler<'ACCOUNT_SWITCH_STARTED'>;
  ACCOUNT_SWITCH_COMPLETED: Handler<'ACCOUNT_SWITCH_COMPLETED'>;
  LOGGED_OUT: Handler<'LOGGED_OUT'>;
} = {
  SET_ACTIVE_VIEW: setActiveView,
  SET_DISCOVERED_VIEWS: setDiscoveredViews,
  SHOW_LANDING: showLanding,
  HIDE_LANDING: hideLanding,
  ACCOUNT_SWITCH_STARTED: accountSwitchStarted,
  ACCOUNT_SWITCH_COMPLETED: accountSwitchCompleted,
  LOGGED_OUT: loggedOut,
};
