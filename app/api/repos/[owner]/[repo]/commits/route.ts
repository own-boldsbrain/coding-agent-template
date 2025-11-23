import { getOctokit } from '@/lib/github/client'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(_request: NextRequest, context: { params: Promise<{ owner: string; repo: string }> }) {
  try {
    const { owner, repo } = await context.params

    const octokit = await getOctokit()

    if (!octokit.auth) {
      return NextResponse.json({ error: 'GitHub authentication required' }, { status: 401 })
    }

    // Fetch commits from the repository
    const { data: commits } = await octokit.rest.repos.listCommits({
      owner,
      repo,
      per_page: 30,
    })

    return NextResponse.json({ commits })
  } catch (error) {
    console.error('Error fetching commits:', error)
    return NextResponse.json({ error: 'Failed to fetch commits' }, { status: 500 })
  }
}
