import 'server-only'

import { decrypt } from '@/lib/crypto'
import { db } from '@/lib/db/client'
import { accounts, users } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

/**
 * Get the OAuth access token for a user from the database
 * Returns the decrypted token or null if not found
 *
 * For GitHub: Checks accounts table first (connected account), then users table (primary account)
 * For Vercel: Gets from users table (primary account only)
 */
export async function getOAuthToken(
  userId: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null } | null> {
  try {
    // Check if user has GitHub as a connected account
    const account = await db
      .select({
        accessToken: accounts.accessToken,
        refreshToken: accounts.refreshToken,
        expiresAt: accounts.expiresAt,
      })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.provider, 'github')))
      .limit(1)

    if (account[0]?.accessToken) {
      return {
        accessToken: decrypt(account[0].accessToken),
        refreshToken: account[0].refreshToken ? decrypt(account[0].refreshToken) : null,
        expiresAt: account[0].expiresAt,
      }
    }

    // Fall back to checking if user signed in with GitHub (primary account)
    const user = await db
      .select({
        accessToken: users.accessToken,
        refreshToken: users.refreshToken,
      })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.provider, 'github')))
      .limit(1)

    if (user[0]?.accessToken) {
      return {
        accessToken: decrypt(user[0].accessToken),
        refreshToken: user[0].refreshToken ? decrypt(user[0].refreshToken) : null,
        expiresAt: null, // Users table doesn't have expiresAt
      }
    }

    return null
  } catch (error) {
    console.error('Error fetching OAuth token:', error)
    return null
  }
}
