import type { PermissionHandler } from '@github/copilot-sdk';

export const approveAllCompat: PermissionHandler = async () => ({ kind: 'approve-once' });
