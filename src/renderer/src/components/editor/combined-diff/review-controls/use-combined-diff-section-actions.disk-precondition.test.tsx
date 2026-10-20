// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { getDiskBaselineSignature } from '../../../../../../shared/disk-baseline-signature'
import type { DiffSection } from '../../diff-section-types'
import type { OpenFile } from '@/store/slices/editor'
import { useCombinedDiffSectionActions } from './use-combined-diff-section-actions'

const mocks = vi.hoisted(() => ({ writeRuntimeFile: vi.fn() }))

vi.mock('@/runtime/runtime-file-mutation-client', () => ({
  writeRuntimeFile: mocks.writeRuntimeFile
}))
vi.mock('@/lib/editor-file-operation-owner', () => ({
  getEditorFileOperationContext: () => ({ target: { kind: 'local' } })
}))
vi.mock('@/store', () => {
  const state = { worktreesByRepo: {}, openFile: vi.fn(), openBranchDiff: vi.fn() }
  const useAppStore = Object.assign((select: (s: typeof state) => unknown) => select(state), {
    getState: () => state
  })
  return { useAppStore }
})

afterEach(() => {
  cleanup()
  mocks.writeRuntimeFile.mockReset()
})

const file: OpenFile = {
  id: 'combined',
  filePath: '/repo',
  relativePath: '',
  worktreeId: 'wt-1',
  language: 'plaintext',
  isDirty: false,
  mode: 'diff'
}

function section(): DiffSection {
  return {
    key: 'a.ts',
    path: 'a.ts',
    status: 'modified',
    originalContent: 'old',
    modifiedContent: 'section edit',
    collapsed: false,
    loading: false,
    dirty: true,
    diffResult: {
      kind: 'text',
      originalContent: 'old',
      modifiedContent: 'loaded',
      originalIsBinary: false,
      modifiedIsBinary: false
    },
    largeDiffRenderLimit: null
  }
}

it('guards section saves, marks a refusal as a section conflict, and overwrites only on request', async () => {
  const sections = [section()]
  const setSections = vi.fn()
  const { result } = renderHook(() =>
    useCombinedDiffSectionActions({
      activeGroupId: undefined,
      branchCompare: null,
      canOpenWorkspaceFileBrowserForPath: () => false,
      commitCompare: null,
      file,
      isAllMode: false,
      isBranchMode: false,
      isCommitMode: false,
      sections,
      sectionsRef: { current: sections },
      setSectionHeights: vi.fn(),
      setSections
    })
  )

  mocks.writeRuntimeFile.mockResolvedValueOnce({ ok: false, diskConflict: 'changed' })
  await act(() => result.current.handleSectionSaveRef.current(0))
  const guarded = { expectedSignature: getDiskBaselineSignature('loaded'), allowMissing: false }
  expect(mocks.writeRuntimeFile.mock.calls[0]?.[4]).toEqual(guarded)
  const [[markConflict]] = setSections.mock.calls
  expect(markConflict(sections)).toEqual([{ ...sections[0], saveConflict: true }])

  // Saving again stays guarded; only the conflict bar's Overwrite writes plain.
  mocks.writeRuntimeFile.mockResolvedValueOnce({ ok: false, diskConflict: 'changed' })
  await act(() => result.current.handleSectionSaveRef.current(0))
  expect(mocks.writeRuntimeFile.mock.calls[1]?.[4]).toEqual(guarded)

  mocks.writeRuntimeFile.mockResolvedValueOnce({ ok: true })
  await act(() => result.current.handleSectionSaveRef.current(0, 'overwrite'))
  expect(mocks.writeRuntimeFile.mock.calls[2]?.[4]).toBeUndefined()
})

it('treats an empty loaded file as a known version', async () => {
  const empty: DiffSection = {
    ...section(),
    diffResult: {
      kind: 'text',
      originalContent: 'old',
      modifiedContent: '',
      originalIsBinary: false,
      modifiedIsBinary: false
    }
  }
  const sections = [empty]
  const { result } = renderHook(() =>
    useCombinedDiffSectionActions({
      activeGroupId: undefined,
      branchCompare: null,
      canOpenWorkspaceFileBrowserForPath: () => false,
      commitCompare: null,
      file,
      isAllMode: false,
      isBranchMode: false,
      isCommitMode: false,
      sections,
      sectionsRef: { current: sections },
      setSectionHeights: vi.fn(),
      setSections: vi.fn()
    })
  )
  mocks.writeRuntimeFile.mockResolvedValueOnce({ ok: true })
  await act(() => result.current.handleSectionSaveRef.current(0))
  expect(mocks.writeRuntimeFile.mock.calls[0]?.[4]).toEqual({
    expectedSignature: getDiskBaselineSignature(''),
    allowMissing: false
  })
})
