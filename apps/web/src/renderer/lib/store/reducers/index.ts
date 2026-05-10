import type { AppState, AppAction } from '../state';
import { messagesHandlers } from './messagesReducer';
import { conversationHandlers } from './conversationReducer';
import { mindsHandlers } from './mindsReducer';
import { lifecycleHandlers } from './lifecycleReducer';
import { a2aHandlers } from './a2aReducer';
import { chatroomHandlers } from './chatroomReducer';

type AnyHandler = (state: AppState, action: AppAction) => Partial<AppState> | AppState;

// Compile-time exhaustiveness: if a new AppAction['type'] is added without a
// handler in one of the slice maps, the assignment below fails to compile
// because the union of slice keys no longer covers every action type.
type HandlerKeys =
  | keyof typeof messagesHandlers
  | keyof typeof conversationHandlers
  | keyof typeof mindsHandlers
  | keyof typeof lifecycleHandlers
  | keyof typeof a2aHandlers
  | keyof typeof chatroomHandlers;
type _Exhaustive = AppAction['type'] extends HandlerKeys ? true : 'MISSING_HANDLER_FOR_ACTION';
const _exhaustivenessCheck: _Exhaustive = true;
void _exhaustivenessCheck;

// The cast pile is forced by function-parameter contravariance: each slice
// declares handlers narrowed to a specific AppAction discriminant (so the
// implementation gets the right payload type), but Record<type, AnyHandler>
// expects every handler to accept any AppAction. The compile-time check
// above catches missing handlers; this cast satisfies the variance.
const HANDLERS: Record<AppAction['type'], AnyHandler> = {
  ...(messagesHandlers as unknown as Record<string, AnyHandler>),
  ...(conversationHandlers as unknown as Record<string, AnyHandler>),
  ...(mindsHandlers as unknown as Record<string, AnyHandler>),
  ...(lifecycleHandlers as unknown as Record<string, AnyHandler>),
  ...(a2aHandlers as unknown as Record<string, AnyHandler>),
  ...(chatroomHandlers as unknown as Record<string, AnyHandler>),
} as Record<AppAction['type'], AnyHandler>;

export function appReducer(state: AppState, action: AppAction): AppState {
  const handler = HANDLERS[action.type];
  if (!handler) return state;
  const next = handler(state, action);
  if (next === state) return state;
  return { ...state, ...next };
}

export { handleChatEvent, getPlainContent } from './helpers';



