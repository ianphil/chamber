// Shared A2A types — re-exported from the service layer for use at the IPC boundary.
// These are protocol types (from A2A v1.0 spec), not service internals.

export type { Role, Part, Message, AgentCard, AgentSkill } from '../main/services/a2a/types';
