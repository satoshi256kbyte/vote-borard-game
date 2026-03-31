/**
 * Test game fixture for E2E tests
 * Provides automatic test game creation and cleanup
 */

import { test as base } from '@playwright/test';
import { createTestGame, cleanupTestGame, type TestGame } from '../helpers/test-data';

/**
 * Test game fixtures
 *
 * Provides:
 * - game: Test game with active status
 *
 * Automatically handles:
 * - Test game creation before test
 * - Test game cleanup after test
 */
export const testGame = base.extend<{
  game: TestGame;
}>({
  /**
   * Test game fixture
   *
   * Creates a test game with active status and provides it to the test.
   * Automatically cleans up the test game after the test completes.
   *
   * Usage:
   * ```typescript
   * testGame('should display game', async ({ game, page }) => {
   *   await page.goto(`/games/${game.gameId}`);
   *   // Game is already created in DynamoDB
   * });
   * ```
   */
  game: async ({ page: _page }, use) => {
    let game: TestGame | null = null;

    try {
      // Create test game
      game = await createTestGame();
      console.log(`[TestGame] Created test game: ${game.gameId}`);

      // Provide test game to test
      await use(game);
    } finally {
      // Cleanup test game
      if (game) {
        try {
          await cleanupTestGame(game);
          console.log(`[TestGame] Cleaned up test game: ${game.gameId}`);
        } catch (error) {
          console.error(`[TestGame] Cleanup failed: ${error}`);
          // テスト結果に影響させない
        }
      }
    }
  },
});
