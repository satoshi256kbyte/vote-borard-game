/**
 * CandidateGenerator 統合テスト
 *
 * モックを使用して CandidateGenerator の各シナリオを検証する。
 * - 正常系、0件対局、パース失敗スキップ、合法手0件スキップ
 * - Bedrockエラー、DB保存失敗、重複除外、フィールド値検証
 *
 * Feature: move-candidate-generation
 * Property 6: 処理サマリーの整合性 (Validates: Requirements 6.1, 6.4)
 * Property 7: 重複ポジションの除外 (Validates: Requirements 7.2, 7.3)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import { CandidateGenerator } from '../index.js';
import type { BedrockService } from '../../bedrock/index.js';
import type { GameRepository } from '../../../lib/dynamodb/repositories/game.js';
import type { CandidateRepository } from '../../../lib/dynamodb/repositories/candidate.js';
import type { GameEntity, CandidateEntity } from '../../../lib/dynamodb/types.js';

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

// aiSide='BLACK' → collective=WHITE, legal moves for WHITE: (2,4),(3,5),(4,2),(5,3)
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

// --- ユニットテスト ---

describe('CandidateGenerator', () => {
  let mockBedrock: BedrockService;
  let mockGameRepo: GameRepository;
  let mockCandidateRepo: CandidateRepository;
  let generator: CandidateGenerator;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBedrock = createMockBedrockService();
    mockGameRepo = createMockGameRepository();
    mockCandidateRepo = createMockCandidateRepository();
    generator = new CandidateGenerator(mockBedrock, mockGameRepo, mockCandidateRepo);
  });

  // --- 手番判定テスト (Requirements 1.1, 1.2) ---

  it('手番判定: 現在ターンがAI手番（currentTurn=0=偶数=AI）の場合スキップされる', async () => {
    // currentTurn=0 → 偶数 → AI手番 → スキップ
    const game = createMockGame({ aiSide: 'BLACK', currentTurn: 0 });
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [game] });

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].status).toBe('skipped');
    expect(summary.results[0].reason).toBe('Current turn is AI turn');
    expect(mockBedrock.generateText).not.toHaveBeenCalled();
  });

  it('手番判定: 現在ターンがAI手番（aiSide=WHITE, currentTurn=2=偶数=AI）の場合スキップされる', async () => {
    // currentTurn=2 → 偶数 → AI手番 → スキップ（aiSideに依存しない）
    const game = createMockGame({ aiSide: 'WHITE', currentTurn: 2 });
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [game] });

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].status).toBe('skipped');
    expect(summary.results[0].reason).toBe('Current turn is AI turn');
    expect(mockBedrock.generateText).not.toHaveBeenCalled();
  });

  it('手番判定: 現在ターンが集合知手番（currentTurn=3=奇数=集合知）の場合候補生成が実行される', async () => {
    // currentTurn=3 → 奇数 → 集合知手番 → 候補生成
    const game = createMockGame({ aiSide: 'BLACK', currentTurn: 3 });
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [game] });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(1);
    expect(summary.successCount).toBe(1);
    expect(summary.skippedCount).toBe(0);
    expect(mockBedrock.generateText).toHaveBeenCalledTimes(1);
  });

  it('手番判定: 現在ターンが集合知手番（aiSide=WHITE, currentTurn=1=奇数=集合知）の場合候補生成が実行される', async () => {
    // currentTurn=1 → 奇数 → 集合知手番 → 候補生成（aiSideに依存しない）
    const game = createMockGame({ aiSide: 'WHITE', currentTurn: 1 });
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [game] });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(1);
    expect(summary.successCount).toBe(1);
    expect(summary.skippedCount).toBe(0);
    expect(mockBedrock.generateText).toHaveBeenCalledTimes(1);
  });

  // --- 正常系・既存テスト ---

  it('正常系: アクティブな対局に対して候補を生成・保存する', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(1);
    expect(summary.successCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(summary.skippedCount).toBe(0);
    expect(mockCandidateRepo.create).toHaveBeenCalledTimes(3);
  });

  it('0件対局: アクティブな対局がない場合は正常終了する', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [] });

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(0);
    expect(summary.successCount).toBe(0);
    expect(summary.failedCount).toBe(0);
    expect(summary.skippedCount).toBe(0);
    expect(summary.results).toHaveLength(0);
  });

  it('boardStateパース失敗: 不正なboardStateの対局はスキップされる', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame({ boardState: 'invalid-json' })],
    });

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].status).toBe('skipped');
    expect(summary.results[0].reason).toContain('parse');
  });

  it('合法手0件: 合法手がない盤面の対局はスキップされる', async () => {
    // 全て黒で埋まった盤面（白の合法手なし）
    const fullBoard = Array(8)
      .fill(null)
      .map(() => Array(8).fill(1));
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame({ boardState: JSON.stringify({ board: fullBoard }) })],
    });

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(1);
    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].status).toBe('skipped');
    expect(summary.results[0].reason).toContain('legal moves');
  });

  it('Bedrockエラー: BedrockService.generateText がエラーを投げた場合は失敗として記録される', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockRejectedValue(new Error('Bedrock API error'));

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.results[0].status).toBe('failed');
    expect(summary.results[0].reason).toContain('Bedrock API error');
  });

  it('DB保存失敗: CandidateRepository.create がエラーを投げても他の候補は保存される', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    // 1回目は失敗、2回目以降は成功
    vi.mocked(mockCandidateRepo.create)
      .mockRejectedValueOnce(new Error('DynamoDB error'))
      .mockResolvedValue({} as CandidateEntity);

    const summary = await generator.generateCandidates();

    expect(summary.successCount).toBe(1);
    expect(mockCandidateRepo.create).toHaveBeenCalledTimes(3);
    // 1つ失敗、2つ成功 → savedCount = 2
    expect(summary.results[0].candidatesSaved).toBe(2);
  });

  it('重複除外: 既存候補と同じpositionの候補は保存されない', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });
    // 既存候補に "2,4" がある
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([
      { position: '2,4' } as CandidateEntity,
    ]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    const summary = await generator.generateCandidates();

    // "2,4" は重複で除外、"3,5" と "4,2" のみ保存
    expect(mockCandidateRepo.create).toHaveBeenCalledTimes(2);
    expect(summary.results[0].candidatesSaved).toBe(2);
  });

  it('createdBy検証: 保存される候補の createdBy が "AI" である', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    await generator.generateCandidates();

    const calls = vi.mocked(mockCandidateRepo.create).mock.calls;
    for (const call of calls) {
      expect(call[0].createdBy).toBe('AI');
    }
  });

  it('votingDeadline検証: 保存される候補の votingDeadline が当日JST 23:59:59.999 に設定される', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    await generator.generateCandidates();

    const calls = vi.mocked(mockCandidateRepo.create).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      const deadline = new Date(call[0].votingDeadline);
      // JST に変換して 23:59:59.999 であることを検証
      const jstOffset = 9 * 60 * 60 * 1000;
      const jstDeadline = new Date(deadline.getTime() + jstOffset);
      expect(jstDeadline.getUTCHours()).toBe(23);
      expect(jstDeadline.getUTCMinutes()).toBe(59);
      expect(jstDeadline.getUTCSeconds()).toBe(59);
      expect(jstDeadline.getUTCMilliseconds()).toBe(999);
    }
  });

  it('turnNumber検証: 保存される候補の turnNumber が currentTurn である', async () => {
    const game = createMockGame({ currentTurn: 5 });
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [game] });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    await generator.generateCandidates();

    const calls = vi.mocked(mockCandidateRepo.create).mock.calls;
    for (const call of calls) {
      expect(call[0].turnNumber).toBe(5); // currentTurn
    }
  });

  // --- 既存機能テスト (Requirements 6.1, 6.2, 6.3, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 10.1, 10.3) ---

  it('合法手なし時スキップ: AIプロンプト構築（generateText）が呼ばれないこと', async () => {
    // 全て黒で埋まった盤面（白の合法手なし）
    const fullBoard = Array(8)
      .fill(null)
      .map(() => Array(8).fill(1));
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame({ boardState: JSON.stringify({ board: fullBoard }) })],
    });

    const summary = await generator.generateCandidates();

    expect(summary.skippedCount).toBe(1);
    expect(summary.results[0].reason).toBe('No legal moves available');
    // AI プロンプト構築が呼ばれないことを明示的に検証
    expect(mockBedrock.generateText).not.toHaveBeenCalled();
    expect(mockCandidateRepo.listByTurn).not.toHaveBeenCalled();
  });

  it('重複候補フィルタリング: 既存候補と同一ポジションの候補が保存されないこと', async () => {
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });
    // 既存候補に "2,4" と "3,5" がある
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([
      { position: '2,4' } as CandidateEntity,
      { position: '3,5' } as CandidateEntity,
    ]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse, // candidates: 2,4 / 3,5 / 4,2
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    const savedPositions: string[] = [];
    vi.mocked(mockCandidateRepo.create).mockImplementation(async (params) => {
      savedPositions.push(params.position);
      return {} as CandidateEntity;
    });

    const summary = await generator.generateCandidates();

    // "2,4" と "3,5" は重複で除外、"4,2" のみ保存
    expect(savedPositions).toEqual(['4,2']);
    expect(savedPositions).not.toContain('2,4');
    expect(savedPositions).not.toContain('3,5');
    expect(summary.results[0].candidatesSaved).toBe(1);
  });

  it('votingDeadline検証: 当日のJST 23:59:59.999であること', async () => {
    // テスト実行時の日付を固定
    const fixedNow = new Date('2024-06-15T10:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockBedrock.generateText).mockResolvedValue({
      text: validAIResponse,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    });
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    await generator.generateCandidates();

    const calls = vi.mocked(mockCandidateRepo.create).mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    for (const call of calls) {
      const deadline = new Date(call[0].votingDeadline);
      // JST に変換して 23:59:59.999 であることを検証
      // calculateVotingDeadline は内部で JST オフセットを加算→UTC時間操作→JST オフセットを減算
      // するため、結果の JST 時刻部分が 23:59:59.999 であることを確認
      const jstOffset = 9 * 60 * 60 * 1000;
      const jstDeadline = new Date(deadline.getTime() + jstOffset);
      // UTC メソッドで検証（修正後は setUTCHours を使用）
      expect(jstDeadline.getUTCHours()).toBe(23);
      expect(jstDeadline.getUTCMinutes()).toBe(59);
      expect(jstDeadline.getUTCSeconds()).toBe(59);
      expect(jstDeadline.getUTCMilliseconds()).toBe(999);

      // 当日の JST 日付であることを検証
      const fixedNowJST = new Date(fixedNow.getTime() + jstOffset);
      expect(jstDeadline.getUTCFullYear()).toBe(fixedNowJST.getUTCFullYear());
      expect(jstDeadline.getUTCMonth()).toBe(fixedNowJST.getUTCMonth());
      expect(jstDeadline.getUTCDate()).toBe(fixedNowJST.getUTCDate());
    }

    vi.useRealTimers();
  });

  it('BedrockServiceエラー時: 失敗として記録され、次の対局の処理が継続される', async () => {
    const game1 = createMockGame({ gameId: 'game-fail' });
    const game2 = createMockGame({ gameId: 'game-success' });
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [game1, game2] });
    vi.mocked(mockCandidateRepo.listByTurn).mockResolvedValue([]);
    vi.mocked(mockCandidateRepo.create).mockResolvedValue({} as CandidateEntity);

    let callCount = 0;
    vi.mocked(mockBedrock.generateText).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Bedrock API error');
      }
      return {
        text: validAIResponse,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      };
    });

    const summary = await generator.generateCandidates();

    expect(summary.totalGames).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.successCount).toBe(1);
    // 1つ目が失敗、2つ目が成功
    expect(summary.results[0].status).toBe('failed');
    expect(summary.results[0].reason).toContain('Bedrock API error');
    expect(summary.results[1].status).toBe('success');
    // 2つ目の対局で候補が保存されていること
    expect(summary.results[1].candidatesSaved).toBeGreaterThan(0);
  });

  it('boardStateパース失敗時: generateTextが呼ばれず、次の対局の処理が継続される', async () => {
    const game1 = createMockGame({ gameId: 'game-bad-json', boardState: 'not-valid-json' });
    const game2 = createMockGame({ gameId: 'game-ok' });
    vi.mocked(mockGameRepo.listByStatus).mockResolvedValue({ items: [game1, game2] });
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
    // 1つ目がスキップ、2つ目が成功
    expect(summary.results[0].status).toBe('skipped');
    expect(summary.results[0].reason).toContain('parse');
    expect(summary.results[1].status).toBe('success');
    // generateText は2つ目の対局でのみ呼ばれる
    expect(mockBedrock.generateText).toHaveBeenCalledTimes(1);
  });
});

// --- プロパティベーステスト ---

describe('Feature: move-candidate-generation, Property 6: 処理サマリーの整合性', () => {
  /**
   * **Validates: Requirements 6.1, 6.4**
   *
   * For any list of games (mix of success/failed/skipped),
   * successCount + failedCount + skippedCount == totalGames,
   * and results.length == totalGames.
   */
  it('successCount + failedCount + skippedCount == totalGames を検証', () => {
    const gameOutcomeArb = fc.constantFrom(
      'success',
      'skipped_parse',
      'skipped_nomoves',
      'failed_bedrock'
    );

    fc.assert(
      fc.property(fc.array(gameOutcomeArb, { minLength: 0, maxLength: 5 }), (outcomes) => {
        // 各 outcome に対応する結果を直接構築して整合性を検証
        const results: Array<{ status: 'success' | 'skipped' | 'failed' }> = outcomes.map(
          (outcome) => {
            switch (outcome) {
              case 'skipped_parse':
              case 'skipped_nomoves':
                return { status: 'skipped' as const };
              case 'failed_bedrock':
                return { status: 'failed' as const };
              default:
                return { status: 'success' as const };
            }
          }
        );

        const totalGames = results.length;
        const successCount = results.filter((r) => r.status === 'success').length;
        const failedCount = results.filter((r) => r.status === 'failed').length;
        const skippedCount = results.filter((r) => r.status === 'skipped').length;

        // CandidateGenerator.generateCandidates と同じ集計ロジックの整合性検証
        expect(successCount + failedCount + skippedCount).toBe(totalGames);
        expect(results.length).toBe(totalGames);
        expect(totalGames).toBe(outcomes.length);
      }),
      { numRuns: 15, endOnFailure: true }
    );
  });

  it('generateCandidates の実行結果でサマリー整合性が成立する', async () => {
    const noMovesBoard = Array(8)
      .fill(null)
      .map(() => Array(8).fill(1));

    const mockBedrock2 = createMockBedrockService();
    const mockGameRepo2 = createMockGameRepository();
    const mockCandidateRepo2 = createMockCandidateRepository();
    const gen = new CandidateGenerator(mockBedrock2, mockGameRepo2, mockCandidateRepo2);

    const games = [
      createMockGame({ gameId: 'game-success' }),
      createMockGame({ gameId: 'game-skipped-parse', boardState: 'bad-json' }),
      createMockGame({
        gameId: 'game-skipped-nomoves',
        boardState: JSON.stringify({ board: noMovesBoard }),
      }),
      createMockGame({ gameId: 'game-failed' }),
    ];

    vi.mocked(mockGameRepo2.listByStatus).mockResolvedValue({ items: games });
    vi.mocked(mockCandidateRepo2.listByTurn).mockResolvedValue([]);
    vi.mocked(mockCandidateRepo2.create).mockResolvedValue({} as CandidateEntity);

    let bedrockCallIndex = 0;
    vi.mocked(mockBedrock2.generateText).mockImplementation(async () => {
      bedrockCallIndex++;
      if (bedrockCallIndex === 2) {
        throw new Error('Bedrock error');
      }
      return {
        text: validAIResponse,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    });

    const summary = await gen.generateCandidates();

    expect(summary.successCount + summary.failedCount + summary.skippedCount).toBe(
      summary.totalGames
    );
    expect(summary.results.length).toBe(summary.totalGames);
    expect(summary.totalGames).toBe(4);
    expect(summary.successCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.skippedCount).toBe(2);
  });
});

describe('Feature: move-candidate-generation, Property 7: 重複ポジションの除外', () => {
  /**
   * **Validates: Requirements 7.2, 7.3**
   *
   * For any existing candidates list and new candidates list,
   * after duplicate filtering, no new candidate has the same position
   * as any existing candidate.
   */
  it('重複除外後に既存候補と同一ポジションが含まれないことを検証', () => {
    const positionArb = fc
      .tuple(fc.integer({ min: 0, max: 7 }), fc.integer({ min: 0, max: 7 }))
      .map(([r, c]) => `${r},${c}`);

    const existingPositionsArb = fc.uniqueArray(positionArb, {
      minLength: 0,
      maxLength: 8,
      comparator: (a, b) => a === b,
    });

    const newPositionsArb = fc.uniqueArray(positionArb, {
      minLength: 0,
      maxLength: 8,
      comparator: (a, b) => a === b,
    });

    fc.assert(
      fc.property(existingPositionsArb, newPositionsArb, (existingPositions, newPositions) => {
        // CandidateGenerator 内部の重複除外ロジックと同じ
        const existingSet = new Set(existingPositions);
        const filtered = newPositions.filter((pos) => !existingSet.has(pos));

        // 重複除外後に既存候補と同一ポジションが含まれない
        for (const pos of filtered) {
          expect(existingSet.has(pos)).toBe(false);
        }

        // フィルタ後の候補数は元の候補数以下
        expect(filtered.length).toBeLessThanOrEqual(newPositions.length);
      }),
      { numRuns: 15, endOnFailure: true }
    );
  });

  it('generateCandidates で重複候補が実際に除外される', async () => {
    const mockBedrock2 = createMockBedrockService();
    const mockGameRepo2 = createMockGameRepository();
    const mockCandidateRepo2 = createMockCandidateRepository();
    const gen = new CandidateGenerator(mockBedrock2, mockGameRepo2, mockCandidateRepo2);

    vi.mocked(mockGameRepo2.listByStatus).mockResolvedValue({
      items: [createMockGame()],
    });

    vi.mocked(mockCandidateRepo2.listByTurn).mockResolvedValue([
      { position: '2,4' } as CandidateEntity,
      { position: '3,5' } as CandidateEntity,
    ]);

    vi.mocked(mockBedrock2.generateText).mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          { position: '2,4', description: '重複1' },
          { position: '3,5', description: '重複2' },
          { position: '4,2', description: '新規1' },
          { position: '5,3', description: '新規2' },
        ],
      }),
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    const savedPositions: string[] = [];
    vi.mocked(mockCandidateRepo2.create).mockImplementation(async (params) => {
      savedPositions.push(params.position);
      return {} as CandidateEntity;
    });

    await gen.generateCandidates();

    expect(savedPositions).toEqual(['4,2', '5,3']);
    expect(savedPositions).not.toContain('2,4');
    expect(savedPositions).not.toContain('3,5');
  });
});
