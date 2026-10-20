import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { EDITOR_STALE_SAVE_MESSAGE } from '@/components/editor/editor-save-disk-precondition'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'

export const MOBILE_STALE_SAVE_MESSAGE =
  'This file changed on the computer. Reload to get the latest version, then reapply your edit.'

/**
 * A tab with no baseline never loaded, so no cached text disagrees with the version mobile just
 * verified; record it provisionally. Returns the stamped signature, or null.
 */
export function stampMobileVerifiedBaseline(
  file: OpenFile,
  current: { content: string; source: 'draft' | 'file' }
): string | null {
  if (current.source !== 'file' || file.lastKnownDiskSignature !== undefined) {
    return null
  }
  const signature = getDiskBaselineSignature(current.content)
  useAppStore.getState().setLastKnownDiskSignature(file.id, signature)
  return signature
}

/** Puts the desktop tab back as it was and returns the error to send to mobile. */
export function rollBackFailedMobileSave(
  error: unknown,
  save: {
    fileId: string
    injectedContent: string
    previousDraft: string | undefined
    previousDirty: boolean
    stampedBaseline: string | null
  }
): unknown {
  restoreFailedMobileSaveDraft(
    save.fileId,
    save.injectedContent,
    save.previousDraft,
    save.previousDirty
  )
  const state = useAppStore.getState()
  const liveFile = state.openFiles.find((openFile) => openFile.id === save.fileId)
  // Why: nothing was written, so the provisional baseline must not outlive the save.
  if (
    save.stampedBaseline !== null &&
    state.editorDrafts[save.fileId] === undefined &&
    liveFile?.lastKnownDiskSignature === save.stampedBaseline
  ) {
    state.setLastKnownDiskSignature(save.fileId, undefined)
  }
  if (!(error instanceof Error) || error.message !== EDITOR_STALE_SAVE_MESSAGE) {
    return error
  }
  // Why: desktop edits rode along in this save, so the desktop must learn of the conflict too.
  if (save.previousDirty) {
    state.setExternalMutation(save.fileId, 'changed')
  }
  return new Error(MOBILE_STALE_SAVE_MESSAGE)
}

function restoreFailedMobileSaveDraft(
  fileId: string,
  injectedContent: string,
  previousDraft: string | undefined,
  previousDirty: boolean
): void {
  const state = useAppStore.getState()
  const currentDraft = state.editorDrafts[fileId]
  if (currentDraft !== undefined && currentDraft !== injectedContent) {
    return
  }
  // Why: mobile save injects a desktop draft only to reuse the editor save path.
  // If save or verification fails, put the desktop editor back exactly as it was before.
  if (previousDraft === undefined) {
    state.clearEditorDraft(fileId)
  } else {
    state.setEditorDraft(fileId, previousDraft)
  }
  state.markFileDirty(fileId, previousDirty)
}
