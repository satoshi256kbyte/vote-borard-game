/**
 * Unit tests for e2e-cleanup shared module
 *
 * Note: These tests are excluded from vitest (e2e/** is excluded).
 * They serve as documentation and can be run manually.
 *
 * Requirements:
 * - 4.1: GSI3を使用してTAG#E2Eタグを持つ全てのGame_Entityを検索
 * - 4.2: 該当するGame_Entityとその関連データ（Candidate_Entity）を削除
 * - 4.3: エラー発生時はログに記録し、残りのデータの削除を継続
 * - 4.5: 削除したGame_Entityの件数をログに出力
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock aws-client-factory before importing e2e-cleanup
const mockSend = vi.fn();
vi.mock('./aws-client-factory', () => ({
  getDynamoDocClient: () => ({ send: mockSend }),
}));

import { findE2EGames, findGameCandidates, batchDeleteItems, cleanupE2EData } from './e2e-cleanup';

const TABLE_NAME = 'test-table';

describe('e2e-cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSend.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findE2EGames', () => {
    it('should query GSI3 with TAG#E2E', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'GAME#g1', SK: 'GAME#g1', gameId: 'g1' }],
        LastEvaluatedKey: undefined,
      });

      const games = await findE2EGames(TABLE_NAME);

      expect(games).toEqual([{ PK: 'GAME#g1', SK: 'GAME#g1', gameId: 'g1' }]);
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toMatchObject({
        TableName: TABLE_NAME,
        IndexName: 'GSI3',
        KeyConditionExpression: 'GSI3PK = :gsi3pk',
        ExpressionAttributeValues: { ':gsi3pk': 'TAG#E2E' },
      });
    });

    it('should handle pagination', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [{ PK: 'GAME#g1', SK: 'GAME#g1', gameId: 'g1' }],
          LastEvaluatedKey: { PK: 'GAME#g1' },
        })
        .mockResolvedValueOnce({
          Items: [{ PK: 'GAME#g2', SK: 'GAME#g2', gameId: 'g2' }],
          LastEvaluatedKey: undefined,
        });

      const games = await findE2EGames(TABLE_NAME);

      expect(games).toHaveLength(2);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no E2E games exist', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      const games = await findE2EGames(TABLE_NAME);
      expect(games).toEqual([]);
    });
  });

  describe('findGameCandidates', () => {
    it('should search candidates by game PK pattern', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [
            { PK: 'GAME#g1#TURN#0', SK: 'CANDIDATE#c1' },
            { PK: 'GAME#g1#TURN#0', SK: 'CANDIDATE#c2' },
          ],
        })
        .mockResolvedValueOnce({ Items: [] });

      const candidates = await findGameCandidates(TABLE_NAME, 'g1');

      expect(candidates).toHaveLength(2);
      expect(candidates[0]).toEqual({
        PK: 'GAME#g1#TURN#0',
        SK: 'CANDIDATE#c1',
      });
    });

    it('should stop searching when a turn has no data', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [{ PK: 'GAME#g1#TURN#0', SK: 'CANDIDATE#c1' }],
        })
        .mockResolvedValueOnce({ Items: [] });

      await findGameCandidates(TABLE_NAME, 'g1');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return empty array when no candidates exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const candidates = await findGameCandidates(TABLE_NAME, 'g1');
      expect(candidates).toEqual([]);
    });
  });

  describe('batchDeleteItems', () => {
    it('should delete items in batches of 25', async () => {
      const items = Array.from({ length: 30 }, (_, i) => ({
        PK: `PK#${i}`,
        SK: `SK#${i}`,
      }));
      mockSend.mockResolvedValue({});

      const count = await batchDeleteItems(TABLE_NAME, items);

      expect(count).toBe(30);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('should return 0 for empty items', async () => {
      const count = await batchDeleteItems(TABLE_NAME, []);
      expect(count).toBe(0);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('cleanupE2EData', () => {
    it('should return zeros when no E2E games exist (0件ケース)', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      const result = await cleanupE2EData(TABLE_NAME);

      expect(result).toEqual({
        gamesDeleted: 0,
        candidatesDeleted: 0,
        errors: [],
      });
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 0 E2E-tagged games'));
    });

    it('should cleanup games and candidates correctly (正常削除)', async () => {
      // findE2EGames: return 2 games
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'GAME#g1', SK: 'GAME#g1', gameId: 'g1' },
          { PK: 'GAME#g2', SK: 'GAME#g2', gameId: 'g2' },
        ],
        LastEvaluatedKey: undefined,
      });
      // findGameCandidates for g1: turn 0 has 2 candidates, turn 1 empty
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'GAME#g1#TURN#0', SK: 'CANDIDATE#c1' },
          { PK: 'GAME#g1#TURN#0', SK: 'CANDIDATE#c2' },
        ],
      });
      mockSend.mockResolvedValueOnce({ Items: [] }); // turn 1 empty
      // batchDeleteItems for g1 candidates
      mockSend.mockResolvedValueOnce({});
      // deleteItem for g1
      mockSend.mockResolvedValueOnce({});
      // findGameCandidates for g2: no candidates
      mockSend.mockResolvedValueOnce({ Items: [] });
      // deleteItem for g2
      mockSend.mockResolvedValueOnce({});

      const result = await cleanupE2EData(TABLE_NAME);

      expect(result.gamesDeleted).toBe(2);
      expect(result.candidatesDeleted).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('should continue when candidate deletion fails (エラー継続)', async () => {
      // findE2EGames: return 2 games
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'GAME#g1', SK: 'GAME#g1', gameId: 'g1' },
          { PK: 'GAME#g2', SK: 'GAME#g2', gameId: 'g2' },
        ],
        LastEvaluatedKey: undefined,
      });
      // findGameCandidates for g1: fails
      mockSend.mockRejectedValueOnce(new Error('Query failed'));
      // deleteItem for g1: succeeds despite candidate failure
      mockSend.mockResolvedValueOnce({});
      // findGameCandidates for g2: no candidates
      mockSend.mockResolvedValueOnce({ Items: [] });
      // deleteItem for g2: succeeds
      mockSend.mockResolvedValueOnce({});

      const result = await cleanupE2EData(TABLE_NAME);

      expect(result.gamesDeleted).toBe(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to delete candidates');
      expect(result.errors[0]).toContain('g1');
    });

    it('should continue when game deletion fails (エラー継続)', async () => {
      // findE2EGames: return 2 games
      mockSend.mockResolvedValueOnce({
        Items: [
          { PK: 'GAME#g1', SK: 'GAME#g1', gameId: 'g1' },
          { PK: 'GAME#g2', SK: 'GAME#g2', gameId: 'g2' },
        ],
        LastEvaluatedKey: undefined,
      });
      // findGameCandidates for g1: no candidates
      mockSend.mockResolvedValueOnce({ Items: [] });
      // deleteItem for g1: fails
      mockSend.mockRejectedValueOnce(new Error('Delete failed'));
      // findGameCandidates for g2: no candidates
      mockSend.mockResolvedValueOnce({ Items: [] });
      // deleteItem for g2: succeeds
      mockSend.mockResolvedValueOnce({});

      const result = await cleanupE2EData(TABLE_NAME);

      expect(result.gamesDeleted).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Failed to delete game g1');
    });

    it('should log deletion counts (Req 4.5)', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [{ PK: 'GAME#g1', SK: 'GAME#g1', gameId: 'g1' }],
        LastEvaluatedKey: undefined,
      });
      mockSend.mockResolvedValueOnce({ Items: [] }); // no candidates
      mockSend.mockResolvedValueOnce({}); // delete game

      await cleanupE2EData(TABLE_NAME);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Found 1 E2E-tagged games'));
    });
  });
});
