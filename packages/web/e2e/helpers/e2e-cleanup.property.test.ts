/**
 * Property-based tests for e2e-cleanup shared module
 *
 * Feature: 39-e2e-test-data-cleanup
 * Property 1: cleanupE2EDataの完全削除
 * Property 2: 個別エラー時の継続削除
 *
 * Validates: Requirements 2.2, 4.2, 4.3, 4.4, 4.5
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';

// Mock aws-client-factory before importing e2e-cleanup
const mockSend = vi.fn();
vi.mock('./aws-client-factory', () => ({
  getDynamoDocClient: () => ({ send: mockSend }),
}));

import { cleanupE2EData } from './e2e-cleanup';

const TABLE_NAME = 'test-table';

/**
 * Generator for E2E game data with associated candidates.
 * Each game has a unique gameId and 0-3 candidates.
 */
const gameWithCandidatesArb = fc.record({
  gameId: fc.uuid(),
  candidateCount: fc.nat({ max: 3 }),
});

type GameWithCandidates = { gameId: string; candidateCount: number };

/**
 * Set up mockSend to simulate DynamoDB responses for a list of games.
 * Each game has findE2EGames → findGameCandidates → batchDeleteItems → deleteItem calls.
 */
function setupMocksForGames(games: GameWithCandidates[]): void {
  // 1. findE2EGames: return all games in a single query response
  mockSend.mockResolvedValueOnce({
    Items: games.map((g) => ({
      PK: `GAME#${g.gameId}`,
      SK: `GAME#${g.gameId}`,
      gameId: g.gameId,
    })),
    LastEvaluatedKey: undefined,
  });

  // 2. For each game: findGameCandidates + batchDeleteItems + deleteItem
  for (const game of games) {
    if (game.candidateCount > 0) {
      // findGameCandidates: turn 0 has candidates
      mockSend.mockResolvedValueOnce({
        Items: Array.from({ length: game.candidateCount }, (_, i) => ({
          PK: `GAME#${game.gameId}#TURN#0`,
          SK: `CANDIDATE#c${i}`,
        })),
      });
      // findGameCandidates: turn 1 empty (stops iteration)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // batchDeleteItems for candidates
      mockSend.mockResolvedValueOnce({});
    } else {
      // findGameCandidates: turn 0 empty
      mockSend.mockResolvedValueOnce({ Items: [] });
    }
    // deleteItem for game entity
    mockSend.mockResolvedValueOnce({});
  }
}

describe('e2e-cleanup property-based tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Feature: 39-e2e-test-data-cleanup, Property 1: cleanupE2EDataの完全削除
   *
   * For any DynamoDB table with N E2E-tagged Game_Entities (N >= 0),
   * each with M related Candidate_Entities, after running cleanupE2EData:
   * - gamesDeleted equals N
   * - candidatesDeleted equals total candidates across all games
   * - errors is empty
   *
   * **Validates: Requirements 4.2, 4.3, 4.4**
   */
  it('Property 1: 任意のE2Eタグ付きゲーム群に対して全件削除し正確なカウントを返す', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(gameWithCandidatesArb, { minLength: 0, maxLength: 5 }),
        async (games) => {
          vi.clearAllMocks();
          mockSend.mockReset();

          setupMocksForGames(games);

          const result = await cleanupE2EData(TABLE_NAME);

          // gamesDeleted equals N
          expect(result.gamesDeleted).toBe(games.length);

          // candidatesDeleted equals total candidates across all games
          const totalCandidates = games.reduce((sum, g) => sum + g.candidateCount, 0);
          expect(result.candidatesDeleted).toBe(totalCandidates);

          // errors is empty
          expect(result.errors).toEqual([]);
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });

  /**
   * Feature: 39-e2e-test-data-cleanup, Property 2: 個別エラー時の継続削除
   *
   * For any list of E2E-tagged Game_Entities, when deletion fails
   * at an arbitrary position, cleanupE2EData:
   * - Continues deleting remaining games
   * - Records errors in the errors array
   * - Returns accurate counts for successfully deleted items
   *
   * **Validates: Requirements 2.2, 4.5**
   */
  it('Property 2: 任意の位置でエラーが発生しても残りのゲーム削除を継続する', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(gameWithCandidatesArb, { minLength: 2, maxLength: 5 }),
        fc.nat(),
        async (games, errorSeed) => {
          vi.clearAllMocks();
          mockSend.mockReset();

          const errorIndex = errorSeed % games.length;

          // 1. findE2EGames: return all games
          mockSend.mockResolvedValueOnce({
            Items: games.map((g) => ({
              PK: `GAME#${g.gameId}`,
              SK: `GAME#${g.gameId}`,
              gameId: g.gameId,
            })),
            LastEvaluatedKey: undefined,
          });

          // 2. For each game: set up mocks, with error at errorIndex
          let expectedCandidatesDeleted = 0;
          for (let i = 0; i < games.length; i++) {
            const game = games[i];

            if (i === errorIndex) {
              // findGameCandidates throws error for this game
              mockSend.mockRejectedValueOnce(new Error(`Simulated error for game ${game.gameId}`));
              // deleteItem for game entity still succeeds
              // (candidate error doesn't prevent game deletion)
              mockSend.mockResolvedValueOnce({});
            } else {
              if (game.candidateCount > 0) {
                mockSend.mockResolvedValueOnce({
                  Items: Array.from({ length: game.candidateCount }, (_, j) => ({
                    PK: `GAME#${game.gameId}#TURN#0`,
                    SK: `CANDIDATE#c${j}`,
                  })),
                });
                mockSend.mockResolvedValueOnce({ Items: [] });
                mockSend.mockResolvedValueOnce({});
                expectedCandidatesDeleted += game.candidateCount;
              } else {
                mockSend.mockResolvedValueOnce({ Items: [] });
              }
              mockSend.mockResolvedValueOnce({});
            }
          }

          const result = await cleanupE2EData(TABLE_NAME);

          // All games are deleted (candidate error doesn't prevent game deletion)
          expect(result.gamesDeleted).toBe(games.length);

          // Candidates deleted excludes the errored game's candidates
          expect(result.candidatesDeleted).toBe(expectedCandidatesDeleted);

          // Exactly one error recorded
          expect(result.errors).toHaveLength(1);
          expect(result.errors[0]).toContain('Failed to delete candidates');
          expect(result.errors[0]).toContain(games[errorIndex].gameId);
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });
});
