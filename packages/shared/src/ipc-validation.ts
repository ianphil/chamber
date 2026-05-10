import type { ZodType } from 'zod';
import type { IpcChannel } from './ipc-channels';

/**
 * Parse an IPC payload against a Zod schema, throwing a `TypeError` that
 * names the channel and lists every Zod issue if validation fails.
 *
 * Why a plain `TypeError` with a string message rather than a richer
 * `IpcValidationError` subclass with `.channel` / `.issues` properties:
 * errors thrown from `ipcMain.handle` do **not** survive serialization to
 * the renderer with custom prototypes or own properties intact — Electron
 * flattens them to a plain `Error` carrying only `name`, `message`, and
 * `stack`. A subclass would not round-trip and the renderer would have to
 * re-parse the message anyway, so the message string is the only durable
 * carrier for diagnostic data across the IPC boundary.
 *
 * `channel` is used purely to label the error message; the helper does not
 * inspect it structurally.
 *
 * Preload stays passthrough — IPC handlers in the main process call this
 * helper before invoking the underlying service. Schemas live alongside the
 * IPC adapter that owns the channel.
 */
export function parseIpcArgs<T>(
  channel: IpcChannel,
  schema: ZodType<T>,
  payload: unknown,
): T {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  const issues = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<payload>';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
  throw new TypeError(`${channel}: invalid payload — ${issues}`);
}
