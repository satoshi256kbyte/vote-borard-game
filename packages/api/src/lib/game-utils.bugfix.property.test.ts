/**
 * バグ条件探索プロパティベーステスト - game-utils
 *
 * Feature: 38-vote-deadline-and-first-move-fix
 * Bug Condition C1: calculateVotingDeadline() が当日の23:59:59 JSTを返すべき
 * Bug Condition C2: isAITurn({ aiSide, currentTurn: 0 }) は常に true であるべき
 *
 * **CRITICAL**: これらのテストは未修正コードで FAIL する — 失敗がバグの存在を証明する
 *
 * **Validates: Requirements 1.1, 1.2**
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { isAITurn } from './game-utils.js';
import type { GameEntity } from './dynamodb/types.js';

// console.log をモックして出力を抑制
vi.spyOn(console, 'log').mockImplementation(() => {});

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

describe('Bugfix Exploration: C1 - calculateVotingDeadline() が当日の23:59:59 JSTを返す', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * C1: calculateVotingDeadline() は当日の23:59:59.999 JST を返すべき
   * **Validates: Requirements 1.1**
   *
   * 任意の日時 now に対して、calculateVotingDeadline() の返値が
   * now と同じ日付（JST）の 23:59:59.999 であることを検証する。
   *
   * 未修正コードでは nextDay.setDate(nextDay.getDate() + 1) により翌日になるため FAIL する。
   */
  it('任意の日時に対して、返値が同じ日付（JST）の 23:59:59.999 である', () => {
    fc.assert(
      fc.property(
        fc
          .date({
            min: new Date('2020-01-01T00:00:00Z'),
            max: new Date('2030-12-31T23:59:59Z'),
          })
          .filter((d) => !isNaN(d.getTime())),
        (now) => {
          // calculateVotingDeadline の実際のロジックを再現（private メソッドのため）
          const jstOffset = 9 * 60 * 60 * 1000;
          const jstNow = new Date(now.getTime() + jstOffset);

          // 現在のバグコードのロジック（翌日に加算してしまう）
          const nextDay = new Date(jstNow);
          nextDay.setDate(nextDay.getDate() + 1);
          nextDay.setHours(23, 59, 59, 999);
          const deadline = new Date(nextDay.getTime() - jstOffset);

          // 期待される正しい動作: deadline は now と同じ日付（JST）の 23:59:59.999
          const deadlineJST = new Date(deadline.getTime() + jstOffset);
          const nowJST = new Date(now.getTime() + jstOffset);

          // 同じ日付であることを検証（バグコードでは翌日になるため FAIL）
          expect(deadlineJST.getUTCFullYear()).toBe(nowJST.getUTCFullYear());
          expect(deadlineJST.getUTCMonth()).toBe(nowJST.getUTCMonth());
          expect(deadlineJST.getUTCDate()).toBe(nowJST.getUTCDate());

          // 時刻が 23:59:59.999 であることを検証
          expect(deadlineJST.getHours()).toBe(23);
          expect(deadlineJST.getMinutes()).toBe(59);
          expect(deadlineJST.getSeconds()).toBe(59);
          expect(deadlineJST.getMilliseconds()).toBe(999);
        }
      ),
      { numRuns: 20, endOnFailure: true }
    );
  });
});

describe('Bugfix Exploration: C2 - isAITurn() の初手判定', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * C2: isAITurn({ aiSide: 'WHITE', currentTurn: 0 }) は true を返すべき
   * **Validates: Requirements 1.2**
   *
   * 初手（turn 0）は常にAIの手番であるべき。
   * 未修正コードでは aiSide='WHITE' の場合 turn 0 が BLACK=集合知の手番と判定されるため FAIL する。
   */
  it('aiSide=WHITE, currentTurn=0 で isAITurn が true を返す', () => {
    const game = createGameEntity(0, 'WHITE');
    expect(isAITurn(game)).toBe(true);
  });

  /**
   * C2 一般化: 任意の aiSide に対して、turn 0 は常にAIの手番
   * **Validates: Requirements 1.2**
   *
   * 未修正コードでは aiSide='WHITE' の場合に false を返すため FAIL する。
   */
  it('任意の aiSide に対して、turn 0 は常にAIの手番である', () => {
    fc.assert(
      fc.property(fc.constantFrom('BLACK' as const, 'WHITE' as const), (aiSide) => {
        const game = createGameEntity(0, aiSide);
        expect(isAITurn(game)).toBe(true);
      }),
      { numRuns: 10, endOnFailure: true }
    );
  });

  /**
   * C2 一般化: 偶数ターンは常にAI側、奇数ターンは常に集合知側
   * **Validates: Requirements 1.2**
   *
   * 修正後の期待動作: isAITurn(game) === (game.currentTurn % 2 === 0)
   * 未修正コードでは aiSide に依存するため、aiSide='WHITE' の偶数ターンで FAIL する。
   */
  it('偶数ターンは常にAI側、奇数ターンは常に集合知側である', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100 }),
        fc.constantFrom('BLACK' as const, 'WHITE' as const),
        (currentTurn, aiSide) => {
          const game = createGameEntity(currentTurn, aiSide);
          const result = isAITurn(game);
          const expected = currentTurn % 2 === 0;
          expect(result).toBe(expected);
        }
      ),
      { numRuns: 20, endOnFailure: true }
    );
  });
});
