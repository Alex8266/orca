import type { AppState } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { toEditorModelUri } from './editor-model-uri'
import { getEditorModelOwnerKey } from './editor-model-owner'
import {
  missingOrIdenticalPrecondition,
  type FileWriteDiskPrecondition,
  type OlderHostDiskPreconditionFallback
} from '../../../../shared/file-write-disk-precondition'

/**
 * `user`: an explicit save (shortcut, save-and-close dialog, mobile). `restart`: the save-all before a
 * restart. `overwrite`: the conflict banner's Overwrite, the only consent to replace a disk change.
 */
export type EditorSaveTrigger = 'autosave' | 'user' | 'restart' | 'overwrite'

/**
 * `written`: disk holds the text. `blocked-stale`: the host refused because disk moved on since the
 * tab's baseline. `failed`: nothing was written (read-only, suspended, superseded). Write errors reject.
 * Callers treat anything but `written` as not saved.
 */
export type EditorSaveResult = 'written' | 'blocked-stale' | 'failed'

export const EDITOR_STALE_SAVE_MESSAGE =
  'This file changed on disk since your edits. Use the banner to compare, reload, or overwrite.'

/**
 * Compatibility fallback: a host without `files.writeIfUnchanged` takes the plain write editor
 * saves always used, so saving against an older remote keeps working (unguarded there).
 */
export const EDITOR_SAVE_OLDER_HOST_FALLBACK: OlderHostDiskPreconditionFallback = 'unguarded-write'

/** The Monaco model a tab edits; tabs of one file on one host share it, and so share its text. */
export function editorTabModelUri(state: AppState, file: OpenFile): string {
  return toEditorModelUri(file.filePath, getEditorModelOwnerKey(file, state))
}

/** Edit tabs showing the same model as `file`, `file` included. */
export function editorModelSiblingTabs(state: AppState, file: OpenFile): OpenFile[] {
  if (file.mode !== 'edit') {
    return [file]
  }
  const modelUri = editorTabModelUri(state, file)
  return state.openFiles.filter(
    (tab) =>
      tab.id === file.id || (tab.mode === 'edit' && editorTabModelUri(state, tab) === modelUri)
  )
}

/**
 * The disk state a save requires, `null` for a plain write, or `unknown-baseline` when the tabs
 * sharing this text disagree on which disk version it came from (so no compare would be honest).
 * A guarded save is refused when disk no longer holds that version, so an unnoticed external
 * write is never silently overwritten.
 */
export function editorSaveDiskPrecondition(
  file: OpenFile,
  siblings: readonly OpenFile[],
  content: string,
  trigger: EditorSaveTrigger
): FileWriteDiskPrecondition | null | 'unknown-baseline' {
  // Why: only the visible banner's Overwrite may replace a disk change the user was shown.
  if (trigger === 'overwrite') {
    return null
  }
  // Why skip clean unloaded tabs: they hold no text yet, so they can't disagree about it.
  const baselines = siblings
    .filter((tab) => tab.lastKnownDiskSignature !== undefined || tab.isDirty)
    .map((tab) => tab.lastKnownDiskSignature)
  if (new Set(baselines).size > 1) {
    return 'unknown-baseline'
  }
  const baseline = file.lastKnownDiskSignature
  if (baseline === undefined) {
    // Why: with no disk version known, only a missing file or one already holding this text is safe.
    return missingOrIdenticalPrecondition(content)
  }
  // Why: autosave must not resurrect a file deleted behind the editor's back; explicit saves may.
  return { expectedSignature: baseline, allowMissing: trigger !== 'autosave' }
}

// Why both clear when the read settles: entries live only while a Keep My Edits read is pending.
const pendingBaselineRestamps = new Map<string, Promise<void>>()
const supersededBaselineRestamps = new Set<string>()

/** A completed write re-baselines the tab, so a Keep read that started earlier must not restamp. */
export function noteEditorBaselineWrite(fileId: string): void {
  if (pendingBaselineRestamps.has(fileId)) {
    supersededBaselineRestamps.add(fileId)
  }
}

export function isEditorBaselineRestampSuperseded(fileId: string): boolean {
  return supersededBaselineRestamps.has(fileId)
}

/** Registers Keep My Edits' disk read so saves of that tab wait for its new baseline. */
export function trackEditorBaselineRestamp(fileId: string, restamp: Promise<void>): void {
  const tracked = restamp.catch(() => undefined)
  pendingBaselineRestamps.set(fileId, tracked)
  supersededBaselineRestamps.delete(fileId)
  void tracked.then(() => {
    if (pendingBaselineRestamps.get(fileId) === tracked) {
      pendingBaselineRestamps.delete(fileId)
      supersededBaselineRestamps.delete(fileId)
    }
  })
}

export function waitForEditorBaselineRestamp(fileId: string): Promise<void> {
  return pendingBaselineRestamps.get(fileId) ?? Promise.resolve()
}
