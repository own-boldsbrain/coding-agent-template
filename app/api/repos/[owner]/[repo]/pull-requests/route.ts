import { getOctokit } from '@/lib/github/client'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(_request: NextRequest, context: { params: Promise<{ owner: string; repo: string }> }) {
  try {
    const { owner, repo } = await context.params

    const octokit = await getOctokit()

    if (!octokit.auth) {
      return NextResponse.json({ error: 'GitHub authentication required' }, { status: 401 })
    }

    // Fetch open pull requests from the repository
    const { data: pullRequests } = await octokit.rest.pulls.list({
      owner,
      repo,
      state: 'open',
      per_page: 30,
      sort: 'updated',
      direction: 'desc',
    })

    return NextResponse.json({ pullRequests })
  } catch (error) {
    console.error('Error fetching pull requests:', error)
    return NextResponse.json({ error: 'Failed to fetch pull requests' }, { status: 500 })
  }
}
