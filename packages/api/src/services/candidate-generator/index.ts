/**
 * CandidateGenerator - 次の一手候補生成サービス
 *
 * アクティブな対局に対してAI（Bedrock Nova Pro）を使い、
 * 次のターンの候補手を自動生成するサービスクラス。
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6,
 *              6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 8.1, 8.2, 8.3, 8.4
 */

import type { BedrockService } from '../bedrock/index.js';
import type { GameRepository } from '../../lib/dynamodb/repositories/game.js';
import type { CandidateRepository } from '../../lib/dynamodb/repositories/candidate.js';
import type { GameEntity } from '../../lib/dynamodb/types.js';
import { getLegalMoves, CellState } from '../../lib/othello/index.js';
import type { Board, Position } from '../../lib/othello/index.js';
import { isAITurn } from '../../lib/game-utils.js';
import { buildPrompt, getSystemPrompt } from './prompt-builder.js';
import { parseAIResponse } from './response-parser.js';
import type { GameProcessingResult, ProcessingSummary, ParsedCandidate } from './types.js';

interface BoardStateJSON {
  board: number[][];
}

export class CandidateGenerator {
  constructor(
    private bedrockService: BedrockService,
    private gameRepository: GameRepository,
    private candidateRepository: CandidateRepository
  ) {}

  async generateCandidates(): Promise<ProcessingSummary> {
    console.log(
      JSON.stringify({ type: 'CANDIDATE_GENERATION_START', timestamp: new Date().toISOString() })
    );
    const { items: activeGames } = await this.gameRepository.listByStatus('ACTIVE');
    const results: GameProcessingResult[] = [];
    for (const game of activeGames) {
      const result = await this.processGame(game);
      results.push(result);
    }
    const summary: ProcessingSummary = {
      totalGames: activeGames.length,
      successCount: results.filter((r) => r.status === 'success').length,
      failedCount: results.filter((r) => r.status === 'failed').length,
      skippedCount: results.filter((r) => r.status === 'skipped').length,
      totalCandidatesGenerated: results.reduce((sum, r) => sum + r.candidatesSaved, 0),
      results,
    };
    console.log(
      JSON.stringify({
        type: 'CANDIDATE_GENERATION_COMPLETE',
        totalGames: summary.totalGames,
        successCount: summary.successCount,
        failedCount: summary.failedCount,
        skippedCount: summary.skippedCount,
        totalCandidatesGenerated: summary.totalCandidatesGenerated,
      })
    );
    return summary;
  }

  private async processGame(game: GameEntity): Promise<GameProcessingResult> {
    console.log(JSON.stringify({ type: 'CANDIDATE_GENERATION_GAME_START', gameId: game.gameId }));
    try {
      // 現在のターンが AI 側の手番かチェック
      if (isAITurn(game)) {
        const reason = 'Current turn is AI turn';
        console.log(
          JSON.stringify({ type: 'CANDIDATE_GENERATION_GAME_SKIPPED', gameId: game.gameId, reason })
        );
        return {
          gameId: game.gameId,
          status: 'skipped',
          candidatesGenerated: 0,
          candidatesSaved: 0,
          reason,
        };
      }
      // boardState をパース
      let boardState: BoardStateJSON;
      try {
        boardState = JSON.parse(game.boardState) as BoardStateJSON;
      } catch {
        const reason = 'Failed to parse boardState';
        console.log(
          JSON.stringify({ type: 'CANDIDATE_GENERATION_GAME_SKIPPED', gameId: game.gameId, reason })
        );
        return {
          gameId: game.gameId,
          status: 'skipped',
          candidatesGenerated: 0,
          candidatesSaved: 0,
          reason,
        };
      }
      const board: Board = boardState.board as unknown as Board;
      const collectivePlayer = game.aiSide === 'BLACK' ? CellState.White : CellState.Black;
      const legalMoves: readonly Position[] = getLegalMoves(board, collectivePlayer);
      if (legalMoves.length === 0) {
        const reason = 'No legal moves available';
        console.log(
          JSON.stringify({ type: 'CANDIDATE_GENERATION_GAME_SKIPPED', gameId: game.gameId, reason })
        );
        return {
          gameId: game.gameId,
          status: 'skipped',
          candidatesGenerated: 0,
          candidatesSaved: 0,
          reason,
        };
      }
      // 既存候補を取得して重複チェック用に準備
      const currentTurn = game.currentTurn;
      const existingCandidates = await this.candidateRepository.listByTurn(
        game.gameId,
        currentTurn
      );
      const existingPositions = new Set(existingCandidates.map((c) => c.position));
      // プロンプト構築 & AI呼び出し
      const currentPlayer =
        collectivePlayer === CellState.Black ? ('BLACK' as const) : ('WHITE' as const);
      const prompt = buildPrompt(board, legalMoves, currentPlayer);
      const systemPrompt = getSystemPrompt();
      const aiResponse = await this.bedrockService.generateText({
        prompt,
        systemPrompt,
        maxTokens: 2000,
      });
      // トークン使用量をログ
      console.log(
        JSON.stringify({
          type: 'CANDIDATE_GENERATION_TOKEN_USAGE',
          gameId: game.gameId,
          inputTokens: aiResponse.usage.inputTokens,
          outputTokens: aiResponse.usage.outputTokens,
          totalTokens: aiResponse.usage.totalTokens,
        })
      );
      // AIレスポンスをパース・バリデーション
      const parseResult = parseAIResponse(aiResponse.text, legalMoves);
      for (const error of parseResult.errors) {
        console.log(
          JSON.stringify({ type: 'CANDIDATE_GENERATION_PARSE_ERROR', gameId: game.gameId, error })
        );
      }
      // 重複候補を除外
      const newCandidates = parseResult.candidates.filter(
        (c) => !existingPositions.has(c.position)
      );
      const duplicateCount = parseResult.candidates.length - newCandidates.length;
      if (duplicateCount > 0) {
        console.log(
          JSON.stringify({
            type: 'CANDIDATE_GENERATION_DUPLICATES_FILTERED',
            gameId: game.gameId,
            duplicateCount,
          })
        );
      }
      // 候補を保存
      const votingDeadline = this.calculateVotingDeadline();
      let savedCount = 0;
      for (const candidate of newCandidates) {
        try {
          await this.saveCandidate(game.gameId, currentTurn, candidate, votingDeadline);
          savedCount++;
        } catch (error) {
          console.log(
            JSON.stringify({
              type: 'CANDIDATE_GENERATION_SAVE_ERROR',
              gameId: game.gameId,
              position: candidate.position,
              error: error instanceof Error ? error.message : 'Unknown error',
            })
          );
        }
      }
      console.log(
        JSON.stringify({
          type: 'CANDIDATE_GENERATION_GAME_COMPLETE',
          gameId: game.gameId,
          candidatesGenerated: parseResult.candidates.length,
          candidatesSaved: savedCount,
        })
      );
      return {
        gameId: game.gameId,
        status: 'success',
        candidatesGenerated: parseResult.candidates.length,
        candidatesSaved: savedCount,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      console.log(
        JSON.stringify({ type: 'CANDIDATE_GENERATION_GAME_FAILED', gameId: game.gameId, reason })
      );
      return {
        gameId: game.gameId,
        status: 'failed',
        candidatesGenerated: 0,
        candidatesSaved: 0,
        reason,
      };
    }
  }

  private async saveCandidate(
    gameId: string,
    turnNumber: number,
    candidate: ParsedCandidate,
    votingDeadline: string
  ): Promise<void> {
    const candidateId = crypto.randomUUID();
    await this.candidateRepository.create({
      candidateId,
      gameId,
      turnNumber,
      position: candidate.position,
      description: candidate.description,
      createdBy: 'AI',
      votingDeadline,
    });
  }

  private calculateVotingDeadline(): string {
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);
    const today = new Date(jstNow);
    today.setUTCHours(23, 59, 59, 999);
    const deadline = new Date(today.getTime() - jstOffset);
    return deadline.toISOString();
  }
}
