export function redirectToSignIn(): void {
  if (!globalThis.location) {
    return
  }

  const { location } = globalThis
  const signInUrl = new URL('/api/auth/signin/github', location.origin)
  const nextPath = `${location.pathname}${location.search}` || '/'

  signInUrl.searchParams.set('next', nextPath)
  location.assign(signInUrl.toString())
}
