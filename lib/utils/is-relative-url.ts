export function isRelativeUrl(url: string): boolean {
  try {
    new URL(url)
    return false
  } catch (_error) {
    return true
  }
}
