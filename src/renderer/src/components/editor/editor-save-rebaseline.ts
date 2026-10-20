import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { getWrittenContentDiskSignature } from '../../../../shared/disk-baseline-signature'
import { ORCA_EDITOR_FILE_REBASELINED_EVENT, type EditorFileSavedDetail } from './editor-autosave'
import {
  editorModelSiblingTabs,
  noteEditorBaselineWrite,
  waitForEditorBaselineRestamp
} from './editor-save-disk-precondition'

/** A Keep in any tab of this text restamps the baseline the save uses, so wait for all of them. */
export function waitForModelBaselineRestamps(state: AppState, file: OpenFile): Promise<unknown> {
  const tab = state.openFiles.find((openFile) => openFile.id === file.id)
  const tabs = tab ? editorModelSiblingTabs(state, tab) : [file]
  return Promise.all(tabs.map((sibling) => waitForEditorBaselineRestamp(sibling.id)))
}

/**
 * After a write, the saving tab and every sibling showing the written text take its signature.
 * A sibling holding other text keeps its old baseline. Fingerprint and cached text move together.
 */
export function rebaselineAfterEditorWrite(
  getState: () => AppState,
  fileId: string,
  siblings: readonly OpenFile[],
  content: string
): void {
  // Why computed: the signature of what a UTF-8 write leaves on disk, with no extra stat.
  const signature = getWrittenContentDiskSignature(content)
  noteEditorBaselineWrite(fileId)
  getState().setLastKnownDiskSignature(fileId, signature)
  for (const sibling of siblings) {
    const draft = getState().editorDrafts[sibling.id]
    if (sibling.id === fileId || (draft !== undefined && draft !== content)) {
      continue
    }
    noteEditorBaselineWrite(sibling.id)
    getState().setLastKnownDiskSignature(sibling.id, signature)
    window.dispatchEvent(
      new CustomEvent<EditorFileSavedDetail>(ORCA_EDITOR_FILE_REBASELINED_EVENT, {
        detail: { fileId: sibling.id, content }
      })
    )
  }
}
