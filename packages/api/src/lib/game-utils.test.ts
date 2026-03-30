import { describe, it, expect } from 'vitest';
import { isAITurn, determineWinner } from './game-utils.js';
import type { GameEntity } from './dynamodb/types.js';
import { CellState } from './othello/index.js';
import type { Board } from './othello/index.js';

/** テスト用の部分的な GameEntity を作成するヘルパー */
function createGameEntity(
  overrides: Partial<Pick<GameEntity, 'currentTurn' | 'aiSide'>>
): GameEntity {
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
    aiSide: 'BLACK',
    currentTurn: 0,
    boardState: '[]',
    ...overrides,
  };
}

/** 指定した石数の盤面を作成するヘルパー */
function createBoard(blackCount: number, whiteCount: number): Board {
  const board: CellState[][] = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => CellState.Empty)
  );
  let placed = 0;
  for (let row = 0; row < 8 && placed < blackCount; row++) {
    for (let col = 0; col < 8 && placed < blackCount; col++) {
      board[row][col] = CellState.Black;
      placed++;
    }
  }
  placed = 0;
  for (let row = 7; row >= 0 && placed < whiteCount; row--) {
    for (let col = 7; col >= 0 && placed < whiteCount; col--) {
      if (board[row][col] === CellState.Empty) {
        board[row][col] = CellState.White;
        placed++;
      }
    }
  }
  return board;
}

describe('isAITurn', () => {
  it('偶数ターン(0) + aiSide=BLACK → AI の手番', () => {
    const game = createGameEntity({ currentTurn: 0, aiSide: 'BLACK' });
    expect(isAITurn(game)).toBe(true);
  });

  it('奇数ターン(1) + aiSide=WHITE → 集合知の手番', () => {
    const game = createGameEntity({ currentTurn: 1, aiSide: 'WHITE' });
    expect(isAITurn(game)).toBe(false);
  });

  it('偶数ターン(0) + aiSide=WHITE → AI の手番', () => {
    const game = createGameEntity({ currentTurn: 0, aiSide: 'WHITE' });
    expect(isAITurn(game)).toBe(true);
  });

  it('奇数ターン(1) + aiSide=BLACK → 集合知の手番', () => {
    const game = createGameEntity({ currentTurn: 1, aiSide: 'BLACK' });
    expect(isAITurn(game)).toBe(false);
  });

  it('偶数ターン(2) + aiSide=BLACK → AI の手番', () => {
    const game = createGameEntity({ currentTurn: 2, aiSide: 'BLACK' });
    expect(isAITurn(game)).toBe(true);
  });

  it('奇数ターン(3) + aiSide=WHITE → 集合知の手番', () => {
    const game = createGameEntity({ currentTurn: 3, aiSide: 'WHITE' });
    expect(isAITurn(game)).toBe(false);
  });
});

describe('determineWinner', () => {
  it('AI(BLACK) の石数が多い → AI 勝ち', () => {
    const board = createBoard(10, 5);
    expect(determineWinner(board, 'BLACK')).toBe('AI');
  });

  it('集合知(WHITE) の石数が多い → COLLECTIVE 勝ち (aiSide=BLACK)', () => {
    const board = createBoard(5, 10);
    expect(determineWinner(board, 'BLACK')).toBe('COLLECTIVE');
  });

  it('石数が同じ → DRAW', () => {
    const board = createBoard(8, 8);
    expect(determineWinner(board, 'BLACK')).toBe('DRAW');
  });

  it('AI(WHITE) の石数が多い → AI 勝ち', () => {
    const board = createBoard(3, 12);
    expect(determineWinner(board, 'WHITE')).toBe('AI');
  });

  it('集合知(BLACK) の石数が多い → COLLECTIVE 勝ち (aiSide=WHITE)', () => {
    const board = createBoard(12, 3);
    expect(determineWinner(board, 'WHITE')).toBe('COLLECTIVE');
  });

  it('石数が同じ → DRAW (aiSide=WHITE)', () => {
    const board = createBoard(10, 10);
    expect(determineWinner(board, 'WHITE')).toBe('DRAW');
  });
});
