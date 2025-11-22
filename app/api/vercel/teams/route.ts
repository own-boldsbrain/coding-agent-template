export async function GET(): Promise<Response> {
  return Response.json({ error: 'Vercel teams endpoint has been removed.' }, { status: 410 })
}
