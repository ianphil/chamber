import { useState } from 'react';
import { FolderUp } from 'lucide-react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import { useAppDispatch } from '../../lib/store';
import { selectPreferredMind } from '../../lib/mindSelection';
import { GenesisFlow } from './GenesisFlow';

/**
 * Center-pane "Add Agents" hub surfaced from the agents sidebar. Hosts the
 * marketplace + agent-creation content inline (no full-screen Genesis intro)
 * and an "Upload from machine" entry that imports an existing agent folder.
 */
export function AddAgentsView() {
  const dispatch = useAppDispatch();
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleUpload = async () => {
    setUploadError(null);
    const dirPath = await window.electronAPI.mind.selectDirectory();
    if (!dirPath) return;

    try {
      const openedMind = await window.electronAPI.mind.add(dirPath);
      const loadedMinds = await window.electronAPI.mind.list();
      dispatch({ type: 'SET_MINDS', payload: loadedMinds });
      const mindToSelect = selectPreferredMind(loadedMinds, openedMind);
      if (mindToSelect) dispatch({ type: 'SET_ACTIVE_MIND', payload: mindToSelect.mindId });
      dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' });
    } catch (error) {
      setUploadError(getErrorMessage(error));
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="h-12 shrink-0 border-b border-border px-4 flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Add Agents</h1>
          <p className="text-xs text-muted-foreground">Create, browse, or import agents.</p>
        </div>
        <button
          onClick={() => { void handleUpload(); }}
          className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors flex items-center gap-2"
        >
          <FolderUp size={14} aria-hidden /> Upload from machine
        </button>
      </div>

      {uploadError && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {uploadError}
        </p>
      )}

      <div className="flex-1 min-h-0">
        <GenesisFlow
          embedded
          initialStage="voice"
          onComplete={() => dispatch({ type: 'SET_ACTIVE_VIEW', payload: 'chat' })}
        />
      </div>
    </div>
  );
}
