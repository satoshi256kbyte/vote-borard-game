/**
 * Property-based tests for game-utils
 *
 * fast-check を使用して isAITurn と determineWinner の正当性プロパティを検証する。
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isAITurn, determineWinner } from './game-utils.js';
import type { GameEntity } from './dynamodb/types.js';
import { CellState, countDiscs } from './othello/index.js';
import type { Board } from './othello/index.js';

/** テスト用の部分的な GameEntity を作成するヘルパー */
function createGameEntity(currentTurn: number, aiSide: 'BLACK' | 'WHITE'): GameEntity {
  return {
    PK: 'GAME#test',
    SK: 'GAME#test',
    entityType: 'GAME',
    createdAt: '2024-01-01T00:00:00Z',
    GSI1PK: 'GAME#STATUS#ACTIVE',
    GSI1SK: '2024-01-01T00:00:00Z',
    gameId: 'test-game',
    gameType: 'OTHELLO',
    status: 'ACTIVE',
    aiSide,
    currentTurn,
    boardState: '[]',
  };
}

/** 8x8 盤面の Arbitrary */
const boardArbitrary: fc.Arbitrary<Board> = fc.array(
  fc.array(fc.constantFrom(CellState.Empty, CellState.Black, CellState.White), {
    minLength: 8,
    maxLength: 8,
  }),
  { minLength: 8, maxLength: 8 }
);

describe('game-utils Property Tests', () => {
  // Feature: 32-vote-tally-batch, Property 4: AI ターン判定
  /**
   * Property 4: AI ターン判定
   * **Validates: Requirements 2.2, 3.5**
   *
   * 任意の currentTurn（非負整数）と aiSide に対して:
   * - 偶数ターン → isAITurn は true（AIの手番）
   * - 奇数ターン → isAITurn は false（集合知の手番）
   * - aiSide の値は結果に影響しない
   */
  it('Property 4: AI ターン判定 - 任意の currentTurn と aiSide に対して正しく判定する', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 1000 }),
        fc.constantFrom('BLACK' as const, 'WHITE' as const),
        (currentTurn, aiSide) => {
          const game = createGameEntity(currentTurn, aiSide);
          const result = isAITurn(game);

          expect(result).toBe(currentTurn % 2 === 0);
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });

  // Feature: 32-vote-tally-batch, Property 2: 勝者決定の正確性
  /**
   * Property 2: 勝者決定の正確性
   * **Validates: Requirements 4.2**
   *
   * 任意の 8x8 盤面と aiSide に対して:
   * - AI 側の石数 > 集合知側の石数 → 'AI'
   * - 集合知側の石数 > AI 側の石数 → 'COLLECTIVE'
   * - 両者の石数が等しい → 'DRAW'
   */
  it('Property 2: 勝者決定の正確性 - 任意の盤面と aiSide に対して石数の大小関係と返り値が整合する', () => {
    fc.assert(
      fc.property(
        boardArbitrary,
        fc.constantFrom('BLACK' as const, 'WHITE' as const),
        (board, aiSide) => {
          const result = determineWinner(board, aiSide);

          const aiColor = aiSide === 'BLACK' ? CellState.Black : CellState.White;
          const collectiveColor = aiSide === 'BLACK' ? CellState.White : CellState.Black;
          const aiCount = countDiscs(board, aiColor);
          const collectiveCount = countDiscs(board, collectiveColor);

          if (aiCount > collectiveCount) {
            expect(result).toBe('AI');
          } else if (collectiveCount > aiCount) {
            expect(result).toBe('COLLECTIVE');
          } else {
            expect(result).toBe('DRAW');
          }
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });
});
