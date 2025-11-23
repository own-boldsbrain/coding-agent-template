/** @format */

import { test, expect } from '@playwright/test'

test.describe('Home page', () => {
  test('renders the hero heading and prompt input', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Coding Agent Template' })).toBeVisible()
    await expect(page.getByPlaceholder('Describe what you want the AI agent to do...')).toBeVisible()
  })
})
