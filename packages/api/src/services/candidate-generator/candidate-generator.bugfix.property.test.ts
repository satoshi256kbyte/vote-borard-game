/**
 * バグ条件探索プロパティベーステスト - CandidateGenerator
 *
 * Feature: 38-vote-deadline-and-first-move-fix
 * Bug Condition C3: processGame() が currentTurn に対して候補を保存すべき
 * Bug Condition C2+C3: aiSide='WHITE' のゲームで候補生成がスキップされないべき
 *
 * **CRITICAL**: これらのテストは未修正コードで FAIL する — 失敗がバグの存在を証明する
 *
 * **Validates: Requirements 1.3, 1.4, 1.5**
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CandidateGenerator } from './index.js';
import type { BedrockService } from '../bedrock/index.js';
import type { GameRepository } from '../../lib/dynamodb/repositories/game.js';
import type { CandidateRepository } from '../../lib/dynamodb/repositories/candidate.js';
import type { GameEntity, CandidateEntity } from '../../lib/dynamodb/types.js';

// console.log をモックして出力を抑制
vi.spyOn(console, 'log').mockImplementation(() => {});

// --- テストヘルパー ---

const initialBoard = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 2, 1, 0, 0, 0],
  [0, 0, 0, 1, 2, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
];
const validBoardState = JSON.stringify({ board: initialBoard });

// aiSide='BLACK' の場合、集合知=White。White の合法手: (2,4), (3,5), (4,2), (5,3)
const whitePlayerAIResponse = JSON.stringify({
  candidates: [
    { position: '2,4', description: '角を狙う一手' },
    { position: '3,5', description: '中央を制圧する手' },
    { position: '4,2', description: '相手の石を多く返す手' },
  ],
});

// aiSide='WHITE' の場合、集合知=Black。Black の合法手: (2,3), (3,2), (4,5), (5,4)
const blackPlayerAIResponse = JSON.stringify({
  candidates: [
    { position: '2,3', description: '角を狙う一手' },
    { position: '3,2', description: '中央を制圧する手' },
    { position: '4,5', description: '相手の石を多く返す手' },
  ],
});

function createMockGame(overrides: Partial<GameEntity> = {}): GameEntity {
  return {
    PK: 'GAME#test-game-1',
    SK: 'GAME#test-game-1',
    entityType: 'GAME',
    GSI1PK: 'GAME#STATUS#ACTIVE',
    GSI1SK: '2024-01-01T00:00:00.000Z',
    gameId: 'test-game-1',
    gameType: 'OTHELLO',
    status: 'ACTIVE',
    aiSide: 'BLACK',
    currentTurn: 2,
    boardState: validBoardState,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockBedrockService(): BedrockService {
  return { generateText: vi.fn() } as unknown as BedrockService;
}

function createMockGameRepository(): GameRepository {
  return { listByStatus: vi.fn() } as unknown as GameRepository;
}

function createMockCandidateRepository(): CandidateRepository {
  return { create: vi.fn(), listByTurn: vi.fn() } as unknown as CandidateRepository;
}

/** モックをセットアップして CandidateGenerator を実行するヘルパー */
async function runGenerator(game: GameEntity, aiResponse: string) {
  const mockBedrock = createMockBedrockService();
  const mockGameRepo = createMockGameRepository();
  const mockCandidateRepo = createMockCandidateRepository();
  const generator = new CandidateGenerator(mockBedrock, mockGameRepo, mockCandidateRepo);

  vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [game] });
  vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
  vi.mocked(mockBedrock.generateText).mockResolvedValue({
    text: aiResponse,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  });
  vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

  const summary = await generator.generateCandidates();
  const createCalls = vi.mocked(mockCandidateRepo.create).mock.calls;
  return { summary, createCalls };
}

// --- C3 テスト ---

describe('Bugfix Exploration: C3 - processGame() が currentTurn に対して候補を保存する', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * C3: 候補は currentTurn に対して保存されるべき
   * **Validates: Requirements 1.3, 1.4**
   *
   * 未修正コードでは currentTurn + 1 に保存するため FAIL する。
   * aiSide='BLACK' + 偶数ターンで未修正コードが候補生成を実行するケースを使用。
   */
  it('候補の turnNumber が game.currentTurn と一致する', async () => {
    const game = createMockGame({ aiSide: 'BLACK', currentTurn: 2 });
    const { createCalls } = await runGenerator(game, whitePlayerAIResponse);

    expect(createCalls.length).toBeGreaterThan(0);
    for (const call of createCalls) {
      // 未修正コードでは turnNumber = 3 (currentTurn + 1) になるため FAIL
      expect(call[0].turnNumber).toBe(game.currentTurn);
    }
  });

  /**
   * C3 プロパティ: 複数の偶数 currentTurn に対して候補が currentTurn に保存される
   * **Validates: Requirements 1.3, 1.4**
   */
  it('複数の偶数 currentTurn に対して候補が currentTurn に保存される', async () => {
    for (const currentTurn of [2, 4, 6, 8]) {
      const game = createMockGame({ aiSide: 'BLACK', currentTurn });
      const { createCalls } = await runGenerator(game, whitePlayerAIResponse);

      expect(createCalls.length).toBeGreaterThan(0);
      for (const call of createCalls) {
        expect(call[0].turnNumber).toBe(currentTurn);
      }
    }
  });
});

// --- C2+C3 テスト ---

describe('Bugfix Exploration: C2+C3 - aiSide=WHITE のゲームで候補生成がスキップされない', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * C2+C3 複合: aiSide='WHITE', currentTurn=1 で候補が正しいターンに保存される
   * **Validates: Requirements 1.5**
   *
   * aiSide='WHITE', currentTurn=1:
   * 未修正コード: isAITurn({ currentTurn: 2 }) → 偶数→BLACK≠WHITE → 実行
   *   → turnNumber=2 で保存（期待は turnNumber=1）
   */
  it('aiSide=WHITE, currentTurn=1 で候補が currentTurn に保存される', async () => {
    const game = createMockGame({ aiSide: 'WHITE', currentTurn: 1 });
    const { summary, createCalls } = await runGenerator(game, blackPlayerAIResponse);

    const result = summary.results.find((r) => r.gameId === game.gameId);
    expect(result?.status).toBe('success');
    expect(createCalls.length).toBeGreaterThan(0);
    for (const call of createCalls) {
      // 未修正コードでは turnNumber = 2 になるため FAIL
      expect(call[0].turnNumber).toBe(1);
    }
  });

  /**
   * C2+C3 複合: aiSide='WHITE', currentTurn=3 で候補が正しいターンに保存される
   * **Validates: Requirements 1.5**
   *
   * aiSide='WHITE', currentTurn=3:
   * 未修正コード: isAITurn({ currentTurn: 4 }) → 偶数→BLACK≠WHITE → 実行
   *   → turnNumber=4 で保存（期待は turnNumber=3）
   */
  it('aiSide=WHITE, currentTurn=3 で候補が currentTurn=3 に保存される', async () => {
    const game = createMockGame({ aiSide: 'WHITE', currentTurn: 3 });
    const { summary, createCalls } = await runGenerator(game, blackPlayerAIResponse);

    const result = summary.results.find((r) => r.gameId === game.gameId);
    expect(result?.status).toBe('success');
    expect(createCalls.length).toBeGreaterThan(0);
    for (const call of createCalls) {
      // 未修正コードでは turnNumber = 4 になるため FAIL
      expect(call[0].turnNumber).toBe(3);
    }
  });
});
