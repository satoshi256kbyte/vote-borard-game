/**
 * Bug Condition Exploration Property Test for CI Environment Game Creation
 *
 * **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
 *
 * This test explores the bug condition where game creation fails in CI environment.
 * The test encodes the EXPECTED behavior - when the bug exists, this test will FAIL.
 * When the bug is fixed, this test will PASS.
 *
 * Bug Condition:
 * - Environment: CI (GitHub Actions)
 * - Action: Submit game creation form
 * - Expected: API returns successful response and redirects to /games/{gameId}
 * - Actual (unfixed): API fails/errors, no redirect, stays on /games/new
 *
 * CRITICAL: This test is EXPECTED TO FAIL on UNFIXED code.
 * Failure confirms the bug exists. DO NOT fix the test or code when it fails.
 */

import { test, expect } from '../fixtures';
import { TIMEOUTS } from '../helpers/wait-utils';
import * as fc from 'fast-check';

test.describe('Bug Condition Exploration: CI Environment Game Creation', () => {
  test('Property 1: Game creation succeeds and redirects in CI environment', async ({
    authenticatedPage,
  }) => {
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

    // Property-based test with scoped input space for deterministic bug
    // We test both AI color choices to ensure the bug is not color-specific
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('BLACK', 'WHITE'), async (aiSide) => {
        console.log(`[Property Test] Testing game creation with AI side: ${aiSide}`);

        // Listen for console messages from the page
        const consoleMessages: string[] = [];
        authenticatedPage.on('console', (msg) => {
          const message = `[Browser Console] ${msg.type()}: ${msg.text()}`;
          console.log(message);
          consoleMessages.push(message);
        });

        // Listen for page errors
        const pageErrors: string[] = [];
        authenticatedPage.on('pageerror', (error) => {
          const errorMsg = `[Browser Error] ${error.message}`;
          console.error(errorMsg);
          pageErrors.push(errorMsg);
        });

        // Track API responses
        let apiResponse: {
          method: string;
          url: string;
          status: number;
          statusText: string;
          body?: unknown;
        } | null = null;

        authenticatedPage.on('response', async (response) => {
          if (response.url().includes('/api/games') && response.request().method() === 'POST') {
            apiResponse = {
              method: response.request().method(),
              url: response.url(),
              status: response.status(),
              statusText: response.statusText(),
            };

            try {
              apiResponse.body = await response.json();
              console.log('[Property Test] API Response:', JSON.stringify(apiResponse, null, 2));
            } catch {
              console.log('[Property Test] Could not parse API response body');
            }
          }
        });

        // Navigate to game creation page
        await authenticatedPage.goto('/games/new');
        await authenticatedPage.waitForLoadState('networkidle');

        // Select AI side if not BLACK (default)
        if (aiSide === 'WHITE') {
          const whiteRadio = authenticatedPage.locator('input[type="radio"][value="WHITE"]');
          await whiteRadio.click();
        }

        // Submit form
        const createButton = authenticatedPage.locator('button[type="submit"]');
        await createButton.click();

        // Property 1: API should return successful response (2xx status)
        // Wait for API response with timeout
        await authenticatedPage.waitForTimeout(5000); // Give API time to respond

        console.log('[Property Test] API Response captured:', apiResponse);

        // ASSERTION 1: API call should succeed (Requirement 2.1, 2.4)
        expect(apiResponse, 'API response should be captured').not.toBeNull();
        expect(
          apiResponse!.status,
          `API should return 2xx status, got ${apiResponse!.status} ${apiResponse!.statusText}`
        ).toBeGreaterThanOrEqual(200);
        expect(
          apiResponse!.status,
          `API should return 2xx status, got ${apiResponse!.status} ${apiResponse!.statusText}`
        ).toBeLessThan(300);

        // ASSERTION 2: Response should contain gameId (Requirement 2.2)
        expect(apiResponse!.body, 'API response body should exist').toBeDefined();
        expect(
          (apiResponse!.body as { gameId?: string }).gameId,
          'API response should contain gameId'
        ).toBeDefined();
        expect(
          (apiResponse!.body as { gameId?: string }).gameId,
          'gameId should be a valid UUID'
        ).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

        const gameId = (apiResponse!.body as { gameId: string }).gameId;

        // Property 2: Should redirect to game detail page (Requirement 2.1, 2.3)
        try {
          await authenticatedPage.waitForURL(`**/games/${gameId}`, { timeout: TIMEOUTS.LONG });
          console.log('[Property Test] Successfully redirected to game detail page');
        } catch {
          const currentUrl = authenticatedPage.url();
          console.error('[Property Test] Redirect failed. Current URL:', currentUrl);
          console.error('[Property Test] Expected URL pattern:', `**/games/${gameId}`);
          console.error('[Property Test] Console messages:', consoleMessages);
          console.error('[Property Test] Page errors:', pageErrors);

          // Log page content for debugging
          const pageContent = await authenticatedPage.content();
          console.error(
            '[Property Test] Page content (first 1000 chars):',
            pageContent.substring(0, 1000)
          );

          throw new Error(
            `Failed to redirect to game detail page. Current URL: ${currentUrl}, Expected: /games/${gameId}`
          );
        }

        // Property 3: Game detail page should load successfully (Requirement 2.3)
        await authenticatedPage.waitForLoadState('networkidle');

        // Wait for game detail page content to appear
        const heading = authenticatedPage.locator('h1');
        await expect(heading).toBeVisible({ timeout: TIMEOUTS.MEDIUM });
        await expect(heading).toContainText('オセロ対局', { timeout: TIMEOUTS.MEDIUM });

        // Verify board is displayed
        const board = authenticatedPage.locator('role=grid[name="オセロの盤面"]');
        await expect(board).toBeVisible({ timeout: TIMEOUTS.MEDIUM });

        console.log('[Property Test] ✓ All assertions passed for AI side:', aiSide);
      }),
      {
        numRuns: 2, // Test both BLACK and WHITE
        endOnFailure: true,
      }
    );
  });
});
