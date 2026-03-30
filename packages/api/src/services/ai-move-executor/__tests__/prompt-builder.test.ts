import { describe, it, expect } from 'vitest';
import {
  formatBoard,
  buildAIMovePrompt,
  getAIMoveSystemPrompt,
  isAITurn,
} from '../prompt-builder.js';
import { createInitialBoard } from '../../../lib/othello/index.js';
import type { GameEntity } from '../../../lib/dynamodb/types.js';

function createMockGame(overrides: Partial<GameEntity> = {}): GameEntity {
  return {
    PK: 'GAME#game-1',
    SK: 'GAME#game-1',
    entityType: 'GAME',
    GSI1PK: 'GAME#STATUS#ACTIVE',
    GSI1SK: '2024-01-01T00:00:00.000Z',
    gameId: 'game-1',
    gameType: 'OTHELLO',
    status: 'ACTIVE',
    aiSide: 'WHITE',
    currentTurn: 0,
    boardState: '{}',
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('prompt-builder', () => {
  describe('formatBoard', () => {
    it('初期盤面を8x8グリッド文字列に変換する', () => {
      const board = createInitialBoard();
      const result = formatBoard(board);

      expect(result).toContain('  0 1 2 3 4 5 6 7');
      expect(result).toContain('○');
      expect(result).toContain('●');
      // 9行（ヘッダー + 8行）
      expect(result.split('\n')).toHaveLength(9);
    });
  });

  describe('isAITurn', () => {
    it('偶数ターンで aiSide=BLACK の場合はAIの手番', () => {
      const game = createMockGame({ currentTurn: 0, aiSide: 'BLACK' });
      expect(isAITurn(game)).toBe(true);
    });

    it('偶数ターンで aiSide=WHITE の場合もAIの手番（偶数ターン=常にAI）', () => {
      const game = createMockGame({ currentTurn: 0, aiSide: 'WHITE' });
      expect(isAITurn(game)).toBe(true);
    });

    it('奇数ターンで aiSide=WHITE の場合はAIの手番ではない（奇数ターン=常に集合知）', () => {
      const game = createMockGame({ currentTurn: 1, aiSide: 'WHITE' });
      expect(isAITurn(game)).toBe(false);
    });

    it('奇数ターンで aiSide=BLACK の場合はAIの手番ではない', () => {
      const game = createMockGame({ currentTurn: 1, aiSide: 'BLACK' });
      expect(isAITurn(game)).toBe(false);
    });

    it('ターン10で aiSide=BLACK の場合はAIの手番', () => {
      const game = createMockGame({ currentTurn: 10, aiSide: 'BLACK' });
      expect(isAITurn(game)).toBe(true);
    });

    it('ターン11で aiSide=WHITE の場合はAIの手番ではない（奇数ターン=集合知）', () => {
      const game = createMockGame({ currentTurn: 11, aiSide: 'WHITE' });
      expect(isAITurn(game)).toBe(false);
    });
  });

  describe('buildAIMovePrompt', () => {
    it('プロンプトに盤面、合法手、手番、JSON要求が含まれる', () => {
      const board = createInitialBoard();
      const legalMoves = [
        { row: 2, col: 3 },
        { row: 3, col: 2 },
      ];
      const prompt = buildAIMovePrompt(board, legalMoves, 'BLACK');

      expect(prompt).toContain('2,3');
      expect(prompt).toContain('3,2');
      expect(prompt).toContain('BLACK');
      expect(prompt).toContain('黒（●）');
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('200');
      expect(prompt).toContain('1つ');
    });

    it('WHITE側のプロンプトが正しく構築される', () => {
      const board = createInitialBoard();
      const legalMoves = [{ row: 5, col: 4 }];
      const prompt = buildAIMovePrompt(board, legalMoves, 'WHITE');

      expect(prompt).toContain('WHITE');
      expect(prompt).toContain('白（○）');
      expect(prompt).toContain('5,4');
    });
  });

  describe('getAIMoveSystemPrompt', () => {
    it('オセロの強いプレイヤーとしての役割が設定されている', () => {
      const systemPrompt = getAIMoveSystemPrompt();

      expect(systemPrompt).toContain('オセロ');
      expect(systemPrompt).toContain('強い');
    });
  });
});
