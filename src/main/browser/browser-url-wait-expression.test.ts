import { describe, expect, it } from 'vitest'
import { browserUrlWaitExpression } from './browser-url-wait-expression'

function matches(pattern: string, href: string): boolean {
  return Function('location', `return ${browserUrlWaitExpression(pattern)}`)({ href })
}

describe('documented browser URL wildcards', () => {
  it('matches wildcard navigation waits and rejects different paths', () => {
    expect(matches('**/next', 'https://example.test/next')).toBe(true)
    expect(matches('**/next', 'https://example.test/next-wrong')).toBe(false)
    expect(matches('https://example.test/*/done?ok=1', 'https://example.test/a/done?ok=1')).toBe(
      true
    )
    expect(matches('https://example.test/*/done?ok=1', 'https://exampleXtest/a/done?ok=1')).toBe(
      false
    )
  })
  it('treats regex syntax and JavaScript text literally', () => {
    expect(matches('**/a[0](b)+', 'https://example.test/a[0](b)+')).toBe(true)
    expect(matches('**/a[0](b)+', 'https://example.test/a0b')).toBe(false)
    expect(matches('**/";throw Error("injected");//', 'https://example.test/next')).toBe(false)
  })
})
