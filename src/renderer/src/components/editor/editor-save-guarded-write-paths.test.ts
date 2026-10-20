import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const EDITOR_DIR = __dirname
const WRITE_CALL = /\b(?:writeRuntimeFile|fs\.writeFile)\s*\(/

// Every editor surface that writes a file: tabs of any mode (edit, rich, notebook, CSV, unstaged
// diff) through the save queue, and combined-diff sections.
const GUARDED_WRITERS = [
  'combined-diff/review-controls/use-combined-diff-section-actions.ts',
  'editor-save-queue.ts'
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return sourceFiles(path)
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$|fixture/.test(name) ? [path] : []
  })
}

function writeCallArguments(source: string): string[] {
  return source
    .split('writeRuntimeFile(')
    .slice(1)
    .map((rest) => {
      let depth = 1
      for (let i = 0; i < rest.length; i += 1) {
        depth += rest[i] === '(' ? 1 : rest[i] === ')' ? -1 : 0
        if (depth === 0) {
          return rest.slice(0, i)
        }
      }
      return rest
    })
}

describe('editor save paths', () => {
  it('write files only from the known guarded writers', () => {
    const writers = sourceFiles(EDITOR_DIR)
      .filter((path) => WRITE_CALL.test(readFileSync(path, 'utf8')))
      .map((path) => relative(EDITOR_DIR, path).split('\\').join('/'))
    expect(writers.sort()).toEqual(GUARDED_WRITERS)
  })

  it.each(GUARDED_WRITERS)(
    '%s sends a precondition and the named older-host fallback',
    (writer) => {
      const calls = writeCallArguments(readFileSync(join(EDITOR_DIR, writer), 'utf8'))
      expect(calls).toHaveLength(1)
      expect(calls[0]).toContain('diskPrecondition')
      expect(calls[0]).toContain('EDITOR_SAVE_OLDER_HOST_FALLBACK')
    }
  )

  it('grants overwrite consent only from the conflict banner', () => {
    const grants = sourceFiles(join(EDITOR_DIR, '..', '..'))
      .filter((path) => /overwrite: true|\? 'overwrite'/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(EDITOR_DIR, path).split('\\').join('/'))
    expect(grants.sort()).toEqual(['ExternalFileChangeBanner.tsx', 'editor-autosave-controller.ts'])
  })

  it('drops the queue guard only for the explicit Overwrite, whatever the tab mode', () => {
    const source = readFileSync(join(EDITOR_DIR, 'editor-save-disk-precondition.ts'), 'utf8')
    const body = source.slice(source.indexOf('export function editorSaveDiskPrecondition'))
    const fn = body.slice(0, body.indexOf('\n}\n'))
    expect(fn.match(/return null/g)).toHaveLength(1)
    expect(fn).not.toContain('mode')
  })
})
