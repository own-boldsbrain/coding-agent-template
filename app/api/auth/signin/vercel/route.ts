export async function POST(): Promise<Response> {
  return Response.json(
    { error: 'Vercel authentication has been removed. Please use GitHub to sign in.' },
    { status: 410 },
  )
}
