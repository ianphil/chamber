/**
 * View ids owned by Chamber's built-in routes (see ViewRouter and ActivityBar).
 * Discovered Lens views must not reuse them: ViewRouter resolves built-in ids
 * first, so a Lens view sharing one of these ids would be unreachable and would
 * render a duplicate activity-bar button. Discovered views carrying a reserved
 * id are filtered out when they enter the store.
 */
export const RESERVED_VIEW_IDS = ['chat', 'chatroom', 'settings', 'a2a-relay', 'extensions'] as const;

export function isReservedViewId(id: string): boolean {
  return (RESERVED_VIEW_IDS as readonly string[]).includes(id);
}
