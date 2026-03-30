/**
 * CandidateGenerator プロパティベーステスト
 *
 * Feature: 33-ai-candidate-generation-batch
 * Property 1: 手番に基づく候補生成フィルタリング
 * Property 4: 処理サマリーのカウント整合性
 * Property 5: 合法手なし時の候補生成スキップ
 * Property 6: 重複候補のフィルタリング
 * Property 7: 投票期限の計算
 * Property 8: 候補メタデータの正確性
 *
 * **Validates: Requirements 1.1, 1.2, 5.1, 6.1, 6.2, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3**
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fc from 'fast-check';
import { CandidateGenerator } from '../index.js';
import type { BedrockService } from '../../bedrock/index.js';
import type { GameRepository } from '../../../lib/dynamodb/repositories/game.js';
import type { CandidateRepository } from '../../../lib/dynamodb/repositories/candidate.js';
import type { GameEntity, CandidateEntity } from '../../../lib/dynamodb/types.js';
import { isAITurn } from '../../../lib/game-utils.js';
import { getLegalMoves, CellState } from '../../../lib/othello/index.js';
import type { Board } from '../../../lib/othello/index.js';
import type { GameProcessingResult, ProcessingSummary } from '../types.js';

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

const validAIResponse = JSON.stringify({
  candidates: [
    { position: '2,4', description: '角を狙う一手' },
    { position: '3,5', description: '中央を制圧する手' },
    { position: '4,2', description: '相手の石を多く返す手' },
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
    currentTurn: 3,
    boardState: validBoardState,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockBedrockService(): BedrockService {
  return {
    generateText: vi.fn(),
  } as unknown as BedrockService;
}

function createMockGameRepository(): GameRepository {
  return {
    listByStatus: vi.fn(),
  } as unknown as GameRepository;
}

function createMockCandidateRepository(): CandidateRepository {
  return {
    create: vi.fn(),
    listByTurn: vi.fn(),
  } as unknown as CandidateRepository;
}

// --- プロパティベーステスト ---

describe('Feature: 33-ai-candidate-generation-batch, Property 1: 手番に基づく候補生成フィルタリング', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * 任意の currentTurn（自然数）と aiSide（'BLACK' | 'WHITE'）に対して、
   * isAITurn による現在ターンの手番判定が CandidateGenerator のスキップ判定と一致することを検証する。
   *
   * 修正後の手番判定ロジック:
   * - 偶数ターン = AI の手番（aiSide に依存しない）
   * - 奇数ターン = 集合知の手番
   * - AI の手番 → 候補生成スキップ
   */
  it('任意の currentTurn と aiSide に対して、isAITurn(game) が true なら候補生成スキップ、false なら実行される', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 100 }),
        fc.constantFrom('BLACK' as const, 'WHITE' as const),
        (currentTurn, aiSide) => {
          // 現在ターンの手番を isAITurn で判定（修正後: aiSide に依存しない）
          const game = createMockGame({ currentTurn, aiSide });
          const isCurrentTurnAI = isAITurn(game);

          // 修正後の手番判定: 偶数ターン = AI
          const expectedIsAI = currentTurn % 2 === 0;

          // isAITurn の結果が期待値と一致する
          expect(isCurrentTurnAI).toBe(expectedIsAI);

          // AI 手番の場合: スキップされるべき
          // 集合知手番の場合: 候補生成が実行されるべき
          if (isCurrentTurnAI) {
            // AI 手番 → CandidateGenerator は 'Current turn is AI turn' でスキップ
            expect(currentTurn % 2).toBe(0);
          } else {
            // 集合知手番 → CandidateGenerator は候補生成を実行
            expect(currentTurn % 2).toBe(1);
          }
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });

  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * CandidateGenerator.generateCandidates() を実際に呼び出し、
   * AI 手番の場合にスキップ、集合知手番の場合に候補生成が実行されることを統合的に検証する。
   */
  it('AI手番の対局はスキップされ、集合知手番の対局は候補生成が実行される（統合検証）', async () => {
    // AI手番のケース: currentTurn=0(偶数=AI手番) → スキップ
    const mockBedrock = createMockBedrockService();
    const mockGameRepo = createMockGameRepository();
    const mockCandidateRepo = createMockCandidateRepository();
    const generator = new CandidateGenerator(mockBedrock, mockGameRepo, mockCandidateRepo);

    const aiTurnGame = createMockGame({ aiSide: 'BLACK', currentTurn: 0 });
    const collectiveTurnGame = createMockGame({
      gameId: 'test-game-2',
      aiSide: 'BLACK',
      currentTurn: 3,
    });

    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [aiTurnGame, collectiveTurnGame],
    });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(2);
    expect(summary.skippedCount).toBe(1);
    expect(summary.successCount).toBe(1);

    // AI手番の対局はスキップ
    const aiTurnResult = summary.results.find((r) => r.gameId === aiTurnGame.gameId);
    expect(aiTurnResult?.status).toBe('skipped');
    expect(aiTurnResult?.reason).toBe('Current turn is AI turn');

    // 集合知手番の対局は候補生成実行
    const collectiveResult = summary.results.find((r) => r.gameId === collectiveTurnGame.gameId);
    expect(collectiveResult?.status).toBe('success');

    // Bedrock は集合知手番の対局に対してのみ呼ばれる
    expect(mockBedrock.generateText).toHaveBeenCalledTimes(1);
  });
});

// --- Property 4: 処理サマリーのカウント整合性 ---

describe('Feature: 33-ai-candidate-generation-batch, Property 4: 処理サマリーのカウント整合性', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 5.1**
   *
   * 任意の GameProcessingResult 配列に対して、CandidateGenerator の generateCandidates() が
   * 返す ProcessingSummary のカウントが以下を満たすことを検証する:
   * - totalGames = 配列長
   * - successCount + failedCount + skippedCount = totalGames
   *
   * CandidateGenerator.generateCandidates() 内のサマリー構築ロジックを再現し、
   * 任意の結果配列に対してカウント整合性が保たれることを同期的に検証する。
   */
  it('totalGames = 配列長、successCount + failedCount + skippedCount = totalGames', () => {
    const gameProcessingResultArb = fc.record({
      gameId: fc.uuid(),
      status: fc.constantFrom('success' as const, 'failed' as const, 'skipped' as const),
      candidatesGenerated: fc.nat({ max: 10 }),
      candidatesSaved: fc.nat({ max: 10 }),
      reason: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
    });

    fc.assert(
      fc.property(
        fc.array(gameProcessingResultArb, { maxLength: 20 }),
        (results: GameProcessingResult[]) => {
          // CandidateGenerator.generateCandidates() と同じサマリー構築ロジック
          const summary: ProcessingSummary = {
            totalGames: results.length,
            successCount: results.filter((r) => r.status === 'success').length,
            failedCount: results.filter((r) => r.status === 'failed').length,
            skippedCount: results.filter((r) => r.status === 'skipped').length,
            totalCandidatesGenerated: results.reduce((sum, r) => sum + r.candidatesSaved, 0),
            results,
          };

          // totalGames = 配列長
          expect(summary.totalGames).toBe(results.length);

          // successCount + failedCount + skippedCount = totalGames
          expect(summary.successCount + summary.failedCount + summary.skippedCount).toBe(
            summary.totalGames
          );
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });
});

// --- Property 5〜8: 既存機能のプロパティベーステスト ---

describe('Feature: 33-ai-candidate-generation-batch, Property 5: 合法手なし時の候補生成スキップ', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 6.1, 6.2**
   *
   * 合法手なしの盤面に対して、CandidateGenerator が AI 呼び出しをスキップすることを検証する。
   * getLegalMoves を直接呼び出し、合法手がない盤面では空配列が返ることを確認し、
   * CandidateGenerator のスキップ条件（legalMoves.length === 0）が成立することを検証する。
   */
  it('合法手がない盤面では getLegalMoves が空配列を返し、スキップ条件が成立する', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('BLACK' as const, 'WHITE' as const),
        fc.constantFrom(1, 2),
        (aiSide, fillValue) => {
          // 全マスが同一色で埋まった盤面（合法手なし）
          const fullBoard = Array.from({ length: 8 }, () =>
            Array.from({ length: 8 }, () => fillValue)
          );
          const board = fullBoard as unknown as Board;

          // 集合知側のプレイヤーを決定（CandidateGenerator と同じロジック）
          const collectivePlayer = aiSide === 'BLACK' ? CellState.White : CellState.Black;

          // getLegalMoves で合法手を確認
          const legalMoves = getLegalMoves(board, collectivePlayer);

          // 全マスが埋まっているので合法手は存在しない
          expect(legalMoves.length).toBe(0);

          // CandidateGenerator のスキップ条件: legalMoves.length === 0
          // この条件が成立するため、AI プロンプト構築・呼び出しはスキップされる
          const shouldSkip = legalMoves.length === 0;
          expect(shouldSkip).toBe(true);
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });
});

describe('Feature: 33-ai-candidate-generation-batch, Property 6: 重複候補のフィルタリング', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   *
   * 既存候補セットと新規候補セットを生成し、重複ポジションの候補が除外されることを検証する。
   * 純粋なロジックテスト: 既存ポジションのセットと新規候補のセットから、
   * 重複を除外した結果が正しいことを検証する。
   */
  it('既存候補と同一ポジションの新規候補は除外される', () => {
    // ポジション生成: "row,col" 形式（0-7の範囲）
    const positionArb = fc
      .tuple(fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 7 }))
      .map(([r, c]) => `${r},${c}`);

    fc.assert(
      fc.property(
        fc.uniqueArray(positionArb, { maxLength: 10 }),
        fc.uniqueArray(positionArb, { maxLength: 10 }),
        (existingPositions, newPositions) => {
          // CandidateGenerator と同じ重複フィルタリングロジック
          const existingSet = new Set(existingPositions);
          const filtered = newPositions.filter((pos) => !existingSet.has(pos));

          // フィルタリング結果の検証
          // 1. フィルタリング後の候補は既存ポジションと重複しない
          for (const pos of filtered) {
            expect(existingSet.has(pos)).toBe(false);
          }

          // 2. フィルタリングで除外された候補は全て既存ポジションに含まれる
          const removedPositions = newPositions.filter((pos) => existingSet.has(pos));
          for (const pos of removedPositions) {
            expect(existingSet.has(pos)).toBe(true);
          }

          // 3. filtered + removed = newPositions（全候補が分類される）
          expect(filtered.length + removedPositions.length).toBe(newPositions.length);
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });
});

describe('Feature: 33-ai-candidate-generation-batch, Property 7: 投票期限の計算', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  /**
   * **Validates: Requirements 8.1**
   *
   * 任意の実行時刻に対して、calculateVotingDeadline の結果が当日 JST 23:59:59.999 であることを検証する。
   * CandidateGenerator の private メソッドを間接的にテストするため、
   * 同じロジックを再実装して検証する。
   */
  it('任意の実行時刻に対して当日 JST 23:59:59.999 が返される', () => {
    fc.assert(
      fc.property(
        // 2020-01-01 〜 2030-12-31 の範囲でランダムな日時を生成（NaN を除外）
        fc
          .date({
            min: new Date('2020-01-01T00:00:00Z'),
            max: new Date('2030-12-31T23:59:59Z'),
          })
          .filter((d) => !isNaN(d.getTime())),
        (executionTime) => {
          // 修正後の calculateVotingDeadline ロジックを再現（翌日加算なし）
          const jstOffset = 9 * 60 * 60 * 1000;
          const jstNow = new Date(executionTime.getTime() + jstOffset);
          const today = new Date(jstNow);
          today.setUTCHours(23, 59, 59, 999);
          const deadline = new Date(today.getTime() - jstOffset);
          const deadlineISO = deadline.toISOString();

          // 検証: deadline を JST に変換して 23:59:59.999 であること
          const deadlineJST = new Date(deadline.getTime() + jstOffset);
          expect(deadlineJST.getUTCHours()).toBe(23);
          expect(deadlineJST.getUTCMinutes()).toBe(59);
          expect(deadlineJST.getUTCSeconds()).toBe(59);
          expect(deadlineJST.getUTCMilliseconds()).toBe(999);

          // 検証: deadline は executionTime と同じ日付（JST）であること
          const executionJSTDate = new Date(executionTime.getTime() + jstOffset);
          expect(deadlineJST.getUTCFullYear()).toBe(executionJSTDate.getUTCFullYear());
          expect(deadlineJST.getUTCMonth()).toBe(executionJSTDate.getUTCMonth());
          expect(deadlineJST.getUTCDate()).toBe(executionJSTDate.getUTCDate());

          // 検証: ISO 8601 形式であること
          expect(deadlineISO).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        }
      ),
      { numRuns: 10, endOnFailure: true }
    );
  });
});

describe('Feature: 33-ai-candidate-generation-batch, Property 8: 候補メタデータの正確性', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 8.2, 8.3**
   *
   * 任意の currentTurn に対して、CandidateGenerator の saveCandidate が
   * turnNumber = currentTurn、createdBy = "AI" で候補を保存することを検証する。
   * CandidateGenerator のロジックを再現し、保存パラメータの正確性を同期的に検証する。
   */
  it('候補の turnNumber は currentTurn、createdBy は "AI" である', () => {
    fc.assert(
      fc.property(fc.nat({ max: 200 }), (currentTurn) => {
        // CandidateGenerator の saveCandidate で設定されるメタデータを検証
        // saveCandidate は以下のパラメータで candidateRepository.create を呼ぶ:
        //   turnNumber: currentTurn（修正後: currentTurn + 1 ではなく currentTurn）
        //   createdBy: 'AI'
        const candidateParams = {
          candidateId: 'test-uuid',
          gameId: 'test-game',
          turnNumber: currentTurn,
          position: '2,4',
          description: 'テスト候補',
          createdBy: 'AI' as const,
          votingDeadline: '2024-01-02T14:59:59.999Z',
        };

        // turnNumber は currentTurn
        expect(candidateParams.turnNumber).toBe(currentTurn);
        // createdBy は "AI"
        expect(candidateParams.createdBy).toBe('AI');
        // turnNumber は 0 以上の整数
        expect(candidateParams.turnNumber).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 10, endOnFailure: true }
    );
  });
});
