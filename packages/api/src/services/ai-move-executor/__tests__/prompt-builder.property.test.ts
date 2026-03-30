/**
 * PromptBuilder プロパティベーステスト
 *
 * Feature: ai-move-execution
 * Property 1: 手番判定の正確性 (Validates: Requirements 1.2, 1.5)
 * Property 2: プロンプトに必要情報が含まれる (Validates: Requirements 3.1-3.7)
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatBoard, buildAIMovePrompt, isAITurn } from '../prompt-builder.js';
import type { Board, Position } from '../../../lib/othello/index.js';
import type { GameEntity } from '../../../lib/dynamodb/types.js';

const boardArb = fc.array(fc.array(fc.constantFrom(0, 1, 2), { minLength: 8, maxLength: 8 }), {
  minLength: 8,
  maxLength: 8,
}) as fc.Arbitrary<Board>;

const positionArb: fc.Arbitrary<Position> = fc.record({
  row: fc.integer({ min: 0, max: 7 }),
  col: fc.integer({ min: 0, max: 7 }),
});

const aiSideArb = fc.constantFrom('BLACK' as const, 'WHITE' as const);

function createMockGame(currentTurn: number, aiSide: 'BLACK' | 'WHITE'): GameEntity {
  return {
    PK: 'GAME#g',
    SK: 'GAME#g',
    entityType: 'GAME',
    GSI1PK: 'GAME#STATUS#ACTIVE',
    GSI1SK: '2024-01-01T00:00:00.000Z',
    gameId: 'g',
    gameType: 'OTHELLO',
    status: 'ACTIVE',
    aiSide,
    currentTurn,
    boardState: '{}',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

// Feature: ai-move-execution, Property 1: 手番判定の正確性
describe('Feature: ai-move-execution, Property 1: 手番判定の正確性', () => {
  it('偶数ターンは常にAIの手番、奇数ターンは常に集合知の手番（aiSideに依存しない）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), aiSideArb, (currentTurn, aiSide) => {
        const game = createMockGame(currentTurn, aiSide);
        const result = isAITurn(game);
        const expected = currentTurn % 2 === 0;
        expect(result).toBe(expected);
      }),
      { numRuns: 20, endOnFailure: true }
    );
  });
});

// Feature: ai-move-execution, Property 2: プロンプトに必要情報が含まれる
describe('Feature: ai-move-execution, Property 2: プロンプトに必要情報が含まれる', () => {
  it('プロンプトにグリッド表現、全合法手、AI側の色、1手選択指示、200文字制限、JSON要求が含まれる', () => {
    fc.assert(
      fc.property(
        boardArb,
        fc.array(positionArb, { minLength: 1, maxLength: 10 }),
        aiSideArb,
        (board, legalMoves, aiSide) => {
          const prompt = buildAIMovePrompt(board, legalMoves, aiSide);

          // グリッド表現の全行が含まれる
          const gridLines = formatBoard(board).split('\n');
          expect(gridLines).toHaveLength(9);
          for (const line of gridLines) {
            expect(prompt).toContain(line);
          }

          // 全合法手が含まれる
          for (const move of legalMoves) {
            expect(prompt).toContain(`${move.row},${move.col}`);
          }

          // AI側の色が含まれる
          expect(prompt).toContain(aiSide);

          // 1手選択指示
          expect(prompt).toContain('1つ');

          // 200文字制限
          expect(prompt).toContain('200');

          // JSON要求
          expect(prompt).toContain('JSON');
        }
      ),
      { numRuns: 15, endOnFailure: true }
    );
  });
});
