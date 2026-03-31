/**
 * E2E tests for game creation flow - Task 3
 * Tests the complete flow of creating a new game
 *
 * Requirements: 4.1-4.14
 *
 * NOTE: Most tests are temporarily disabled to speed up debugging.
 * Only the failing test is enabled to get detailed logs quickly.
 */

import { test, expect } from '../fixtures';
import { TIMEOUTS } from '../helpers/wait-utils';
import type { Page } from '@playwright/test';

/**
 * Helper function to wait for game detail page to load after creation
 * Includes retry logic and debugging for eventual consistency issues
 */
async function waitForGameDetailPage(page: Page): Promise<void> {
  // Get the game ID from URL for debugging
  const url = page.url();
  console.log('[Test] Redirected to:', url);

  // Wait for game detail page to load
  await page.waitForLoadState('networkidle');

  // Wait for the game data to be loaded (retry logic)
  // The game might not be immediately available after creation due to DynamoDB eventual consistency
  try {
    await page.waitForFunction(
      () => {
        const heading = document.querySelector('h1');
        const hasHeading =
          heading && heading.textContent && heading.textContent.includes('オセロ対局');

        // Log current state for debugging
        if (!hasHeading) {
          console.log('[Test] Waiting for heading, current h1:', heading?.textContent);
        }

        return hasHeading;
      },
      { timeout: 30000, polling: 1000 } // Poll every second for up to 30 seconds
    );

    console.log('[Test] Game detail page loaded successfully');
  } catch (error) {
    // Log page content for debugging
    const pageContent = await page.content();
    console.error('[Test] Page content when heading not found:', pageContent.substring(0, 1000));

    // Log console messages from the page
    console.error('[Test] Page URL:', page.url());

    throw error;
  }
}

test.describe('Game Creation Flow - Success Behavior (Task 3.4)', () => {
  test('should display newly created game on detail page', async ({ authenticatedPage }) => {
    // Listen for console messages from the page
    authenticatedPage.on('console', (msg) => {
      console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`);
    });

    // Listen for page errors
    authenticatedPage.on('pageerror', (error) => {
      console.error('[Browser Error]', error);
    });

    // Listen for API responses to debug
    authenticatedPage.on('response', async (response) => {
      if (response.url().includes('/api/games')) {
        console.log('[Test] API response:', {
          method: response.request().method(),
          url: response.url(),
          status: response.status(),
          statusText: response.statusText(),
        });

        if (response.request().method() === 'POST') {
          try {
            const body = await response.json();
            console.log('[Test] POST Response body:', JSON.stringify(body, null, 2));
          } catch {
            console.log('[Test] Could not parse POST response body');
          }
        }
      }
    });

    // Intercept POST /api/games to inject tags: ["E2E"] for cleanup
    await authenticatedPage.route('**/api/games', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        const postData = request.postDataJSON();
        postData.tags = ['E2E'];
        await route.continue({ postData: JSON.stringify(postData) });
      } else {
        await route.continue();
      }
    });

    // Navigate to game creation page
    await authenticatedPage.goto('/games/new');

    // Wait for page to load
    await authenticatedPage.waitForLoadState('networkidle');

    // Submit form
    const createButton = authenticatedPage.locator('button[type="submit"]');
    await createButton.click();

    // Wait for redirect to game detail page
    await authenticatedPage.waitForURL('**/games/**', { timeout: TIMEOUTS.LONG });

    // Wait for game detail page to load with retry logic
    await waitForGameDetailPage(authenticatedPage);

    // Verify game detail page is displayed (Requirement 4.12)
    const heading = authenticatedPage.locator('h1');
    await expect(heading).toBeVisible({ timeout: TIMEOUTS.MEDIUM });
    await expect(heading).toContainText('オセロ対局', { timeout: TIMEOUTS.MEDIUM });

    // Verify board is displayed
    const board = authenticatedPage.locator('role=grid[name="オセロの盤面"]');
    await expect(board).toBeVisible({ timeout: TIMEOUTS.MEDIUM });
  });
});
