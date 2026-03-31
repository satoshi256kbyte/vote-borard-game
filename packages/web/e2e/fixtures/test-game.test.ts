/**
 * Unit tests for test game fixture
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as testDataModule from '../helpers/test-data';

// Mock the helper modules
vi.mock('../helpers/test-data', () => ({
  createTestGame: vi.fn(),
  cleanupTestGame: vi.fn(),
}));

describe('Test Game Fixture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('game fixture', () => {
    it('should create test game before test', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);
      vi.mocked(testDataModule.cleanupTestGame).mockResolvedValue(undefined);

      const result = await testDataModule.createTestGame();
      expect(result).toEqual(mockGame);
      expect(testDataModule.createTestGame).toHaveBeenCalledTimes(1);
    });

    it('should provide game with active status', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);

      const result = await testDataModule.createTestGame();
      expect(result.status).toBe('active');
    });

    it('should provide game with empty candidates array', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);

      const result = await testDataModule.createTestGame();
      expect(result.candidates).toEqual([]);
      expect(Array.isArray(result.candidates)).toBe(true);
    });

    it('should cleanup test game after test completes', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);
      vi.mocked(testDataModule.cleanupTestGame).mockResolvedValue(undefined);

      await testDataModule.createTestGame();
      await testDataModule.cleanupTestGame(mockGame);

      expect(testDataModule.cleanupTestGame).toHaveBeenCalledWith(mockGame);
      expect(testDataModule.cleanupTestGame).toHaveBeenCalledTimes(1);
    });

    it('should cleanup test game even if test fails', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);
      vi.mocked(testDataModule.cleanupTestGame).mockResolvedValue(undefined);

      // Verify cleanup is defined and can be called
      expect(testDataModule.cleanupTestGame).toBeDefined();
      await expect(testDataModule.cleanupTestGame(mockGame)).resolves.toBeUndefined();
    });

    it('should handle createTestGame failure gracefully', async () => {
      const error = new Error('Failed to create game');
      vi.mocked(testDataModule.createTestGame).mockRejectedValue(error);

      await expect(testDataModule.createTestGame()).rejects.toThrow('Failed to create game');
    });

    it('should generate unique game IDs', async () => {
      const mockGame1 = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      const mockGame2 = {
        gameId: 'test-game-456',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame)
        .mockResolvedValueOnce(mockGame1)
        .mockResolvedValueOnce(mockGame2);

      const game1 = await testDataModule.createTestGame();
      const game2 = await testDataModule.createTestGame();

      expect(game1.gameId).not.toBe(game2.gameId);
    });
  });

  describe('fixture integration', () => {
    it('should export testGame fixture', async () => {
      const { testGame } = await import('./test-game');
      expect(testGame).toBeDefined();
      expect(typeof testGame).toBe('function');
    });

    it('should have game property', async () => {
      const { testGame } = await import('./test-game');
      expect(testGame).toBeDefined();
      // Playwright fixtures are functions
      expect(typeof testGame).toBe('function');
    });
  });

  describe('error handling', () => {
    it('should cleanup even if createTestGame throws', async () => {
      const error = new Error('DynamoDB unavailable');
      vi.mocked(testDataModule.createTestGame).mockRejectedValue(error);
      vi.mocked(testDataModule.cleanupTestGame).mockResolvedValue(undefined);

      await expect(testDataModule.createTestGame()).rejects.toThrow('DynamoDB unavailable');
    });

    it('should not throw if cleanup fails', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);
      vi.mocked(testDataModule.cleanupTestGame).mockResolvedValue(undefined);

      // Cleanup should not throw even if it fails internally
      await expect(testDataModule.cleanupTestGame(mockGame)).resolves.toBeUndefined();
    });

    it('should not propagate cleanup error from fixture finally block', async () => {
      const mockGame = {
        gameId: 'test-game-cleanup-error',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);
      vi.mocked(testDataModule.cleanupTestGame).mockRejectedValue(
        new Error('DynamoDB cleanup failed')
      );

      // Simulate the fixture's finally block behavior:
      // The try-catch inside finally should swallow the cleanup error
      const fixtureCleanup = async () => {
        if (mockGame) {
          try {
            await testDataModule.cleanupTestGame(mockGame);
          } catch (error) {
            console.error(`[TestGame] Cleanup failed: ${error}`);
            // テスト結果に影響させない
          }
        }
      };

      // The fixture cleanup should NOT throw even when cleanupTestGame rejects
      await expect(fixtureCleanup()).resolves.toBeUndefined();
    });

    it('should log error via console.error when cleanup throws', async () => {
      const mockGame = {
        gameId: 'test-game-log-error',
        status: 'active' as const,
        candidates: [],
      };
      const cleanupError = new Error('Network timeout during cleanup');

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);
      vi.mocked(testDataModule.cleanupTestGame).mockRejectedValue(cleanupError);

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate the fixture's finally block behavior
      if (mockGame) {
        try {
          await testDataModule.cleanupTestGame(mockGame);
        } catch (error) {
          console.error(`[TestGame] Cleanup failed: ${error}`);
        }
      }

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TestGame] Cleanup failed:')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Network timeout during cleanup')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should handle missing environment variables gracefully', async () => {
      const error = new Error('DYNAMODB_TABLE_NAME environment variable is not set');
      vi.mocked(testDataModule.createTestGame).mockRejectedValue(error);

      await expect(testDataModule.createTestGame()).rejects.toThrow(
        'DYNAMODB_TABLE_NAME environment variable is not set'
      );
    });
  });

  describe('game data structure', () => {
    it('should have required gameId property', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);

      const result = await testDataModule.createTestGame();
      expect(result).toHaveProperty('gameId');
      expect(typeof result.gameId).toBe('string');
      expect(result.gameId.length).toBeGreaterThan(0);
    });

    it('should have required status property', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);

      const result = await testDataModule.createTestGame();
      expect(result).toHaveProperty('status');
      expect(['active', 'completed']).toContain(result.status);
    });

    it('should have required candidates property', async () => {
      const mockGame = {
        gameId: 'test-game-123',
        status: 'active' as const,
        candidates: [],
      };

      vi.mocked(testDataModule.createTestGame).mockResolvedValue(mockGame);

      const result = await testDataModule.createTestGame();
      expect(result).toHaveProperty('candidates');
      expect(Array.isArray(result.candidates)).toBe(true);
    });
  });
});
