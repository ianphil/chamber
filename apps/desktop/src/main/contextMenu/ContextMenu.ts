import { BrowserWindow, Menu } from 'electron';
import type { ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron';

export function buildContextMenuTemplate(
  params: ContextMenuParams,
): MenuItemConstructorOptions[] {
  const { isEditable, selectionText, editFlags } = params;
  const hasSelection = selectionText.length > 0;
  const items: MenuItemConstructorOptions[] = [];

  if (isEditable) {
    items.push({ role: 'cut', label: 'Cut', enabled: editFlags.canCut });
  }

  if (isEditable || hasSelection) {
    items.push({ role: 'copy', label: 'Copy', enabled: editFlags.canCopy });
  }

  if (isEditable) {
    items.push({ role: 'paste', label: 'Paste', enabled: editFlags.canPaste });
  }

  const showSelectAll = isEditable || hasSelection;

  if (showSelectAll) {
    items.push({ type: 'separator' });
  }

  if (showSelectAll) {
    items.push({ role: 'selectAll', label: 'Select All', enabled: editFlags.canSelectAll });
  }

  return items;
}

// Must be called once per webContents. Multiple calls stack listeners,
// which would open duplicate menus on every right-click.
export function installContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params);
    if (template.length === 0) return;

    const menu = Menu.buildFromTemplate(template);
    const win = BrowserWindow.fromWebContents(webContents);
    menu.popup(win ? { window: win } : undefined);
  });
}
