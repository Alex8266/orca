import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ORCA_EDITOR_SAVE_AND_CLOSE_EVENT,
  requestEditorFileSave,
  requestEditorSaveQuiesce,
  type EditorSaveAndCloseDetail
} from './editor-autosave'
import { attachEditorAutosaveController } from './editor-autosave-controller'
import { __clearSelfWriteRegistryForTests } from './editor-self-write-registry'
import { createEditorStore } from './editor-autosave-controller-test-fixture'
import { keepTabEditsOverExternalChange } from './ExternalFileChangeBanner'
import { attemptEditorFileSave } from './editor-file-save-attempt'
import {
  getDiskBaselineSignature,
  getWrittenContentDiskSignature
} from '../../../../shared/disk-baseline-signature'
import { GUARDED_PATH, openGuardedFile, stubGuardedDisk } from './editor-save-guarded-disk-fixture'

const mocks = vi.hoisted(() => ({ readRuntimeFileContent: vi.fn(), toastError: vi.fn() }))
const storeRef = vi.hoisted((): { current: ReturnType<typeof createEditorStore> | null } => ({
  current: null
}))

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: mocks.toastError }) }))
vi.mock('@/lib/connection-context', () => ({ getConnectionIdForFile: () => undefined }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => storeRef.current?.getState() } }))
vi.mock('@/lib/file-owner-runtime-target', () => ({
  getRuntimeTargetForFileOwner: () => ({ kind: 'local' })
}))
vi.mock('@/runtime/runtime-file-read-client', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readRuntimeFileContent: mocks.readRuntimeFileContent
}))

function deferred<T = void>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('guarded editor saves under races', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    __clearSelfWriteRegistryForTests()
    mocks.toastError.mockReset()
  })

  it('guards an unstaged diff tab, which writes the working-tree file', async () => {
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'agent rewrite' })
    const store = createEditorStore()
    store.getState().openDiff('wt-1', GUARDED_PATH, 'file.ts', 'typescript', false)
    const diff = store.getState().openFiles[0]
    expect(diff?.diffSource).toBe('unstaged')
    store.getState().setLastKnownDiskSignature(diff.id, getDiskBaselineSignature('original'))
    store.getState().setEditorDraft(diff.id, 'diff edit')
    store.getState().markFileDirty(diff.id, true)

    const cleanup = attachEditorAutosaveController(store)
    try {
      await vi.advanceTimersByTimeAsync(1500)
      expect(disk.writeFile).toHaveBeenCalledTimes(1)
      expect(disk.files.get(GUARDED_PATH)).toBe('agent rewrite')
      expect(store.getState().openFiles[0]?.externalMutation).toBe('changed')
    } finally {
      cleanup()
    }
  })

  it('rebaselines to its own write even when a quiesce supersedes the save mid-write', async () => {
    const gate = deferred()
    const disk = stubGuardedDisk({ [GUARDED_PATH]: 'original' }, () => gate.promise)
    const store = createEditorStore()
    openGuardedFile(store, { baseline: 'original', draft: 'first' })

    const cleanup = attachEditorAutosaveController(store)
    try {
      const save = requestEditorFileSave({ fileId: GUARDED_PATH })
      await vi.advanceTimersByTimeAsync(0)
      const quiesce = requestEditorSaveQuiesce({ fileId: GUARDED_PATH })
      gate.resolve()
      await save
      await quiesce
      expect(store.getState().openFiles[0]?.lastKnownDiskSignature).toBe(
        getWrittenContentDiskSignature('first')
      )

      store.getState().setEditorDraft(GUARDED_PATH, 'second')
      await requestEditorFileSave({ fileId: GUARDED_PATH })
      expect(disk.files.get(GUARDED_PATH)).toBe('second')
    } finally {
      cleanup()
    }
  })

  it("does not let Keep's older disk read restamp over a write that finished after it", async () => {
    const gate = deferred()
    stubGuardedDisk({ [GUARDED_PATH]: 'agent rewrite' }, () => gate.promise)
    const store = createEditorStore()
    storeRef.current = store
    openGuardedFile(store, { baseline: 'original', draft: 'mine' })
    store.getState().setExternalMutation(GUARDED_PATH, 'changed')
    const read = deferred<{ content: string; isBinary: boolean }>()
    mocks.readRuntimeFileContent.mockReturnValue(read.promise)

    const cleanup = attachEditorAutosaveController(store)
    try {
      // An Overwrite is already writing when the user clicks Keep.
      const save = requestEditorFileSave({ fileId: GUARDED_PATH, overwrite: true })
      await vi.advanceTimersByTimeAsync(0)
      keepTabEditsOverExternalChange(store.getState().openFiles[0])
      gate.resolve()
      await save
      read.resolve({ content: 'agent rewrite', isBinary: false })
      await vi.advanceTimersByTimeAsync(0)

      expect(store.getState().openFiles[0]?.lastKnownDiskSignature).toBe(
        getWrittenContentDiskSignature('mine')
      )
    } finally {
      cleanup()
    }
  })

  it('reports a refused explicit save with the stale-file message', async () => {
    stubGuardedDisk({ [GUARDED_PATH]: 'agent rewrite' })
    const store = createEditorStore()
    openGuardedFile(store, { baseline: 'original', draft: 'mine' })

    const cleanup = attachEditorAutosaveController(store)
    try {
      expect(await attemptEditorFileSave({ fileId: GUARDED_PATH })).toBe(false)
      expect(mocks.toastError).toHaveBeenCalledWith(expect.stringMatching(/changed on disk/))
    } finally {
      cleanup()
    }
  })

  it('answers a refused save-and-close at once and keeps the tab open', async () => {
    stubGuardedDisk({ [GUARDED_PATH]: 'agent rewrite' })
    const store = createEditorStore()
    openGuardedFile(store, { baseline: 'original', draft: 'mine' })

    const cleanup = attachEditorAutosaveController(store)
    try {
      const reason = await new Promise((resolve) => {
        const detail: EditorSaveAndCloseDetail = { fileId: GUARDED_PATH, onNotClosed: resolve }
        window.dispatchEvent(new CustomEvent(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, { detail }))
      })
      expect(reason).toBe('blocked-stale')
      expect(store.getState().openFiles).toHaveLength(1)
      expect(store.getState().openFiles[0]?.externalMutation).toBe('changed')
    } finally {
      cleanup()
    }
  })
})
