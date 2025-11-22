export async function GET(): Promise<Response> {
  return new Response('Vercel authentication has been removed.', {
    status: 410,
  })
}
