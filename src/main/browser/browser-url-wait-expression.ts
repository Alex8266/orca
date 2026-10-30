export function browserUrlWaitExpression(pattern: string): string {
  const source = pattern
    .split(/\*+/)
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
    .join('.*')
  return `new RegExp(${JSON.stringify(`^${source}$`)}).test(location.href)`
}
