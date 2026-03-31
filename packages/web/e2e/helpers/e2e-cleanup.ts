/**
 * E2Eテストデータクリーンアップ共通モジュール
 *
 * globalSetup・globalTeardown・フィクスチャから共通利用される
 * クリーンアップロジックを提供する。
 *
 * Requirements:
 * - 4.1: GSI3を使用してTAG#E2Eタグを持つ全てのGame_Entityを検索
 * - 4.2: 該当するGame_Entityとその関連データ（Candidate_Entity）を削除
 * - 4.3: エラー発生時はログに記録し、残りのデータの削除を継続
 * - 4.4: テストの成否にかかわらず実行される
 * - 4.5: 削除したGame_Entityの件数をログに出力
 */

import { QueryCommand, DeleteCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { getDynamoDocClient } from './aws-client-factory';

export interface CleanupResult {
  gamesDeleted: number;
  candidatesDeleted: number;
  errors: string[];
}

interface E2EGameItem {
  PK: string;
  SK: string;
  gameId: string;
}

interface CandidateItem {
  PK: string;
  SK: string;
}

/**
 * GSI3でE2Eタグ付きゲームを全件検索する
 */
export async function findE2EGames(tableName: string): Promise<E2EGameItem[]> {
  const games: E2EGameItem[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const docClient = getDynamoDocClient();
    const command = new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :gsi3pk',
      ExpressionAttributeValues: {
        ':gsi3pk': 'TAG#E2E',
      },
      ExclusiveStartKey: lastEvaluatedKey,
    });

    const result = await docClient.send(command);

    if (result.Items) {
      for (const item of result.Items) {
        games.push({
          PK: item.PK as string,
          SK: item.SK as string,
          gameId: item.gameId as string,
        });
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  return games;
}

/**
 * ゲームに関連するCandidate_Entityを検索する
 * PK が GAME#<gameId>#TURN# で始まるアイテムを検索
 */
export async function findGameCandidates(
  tableName: string,
  gameId: string
): Promise<CandidateItem[]> {
  const candidates: CandidateItem[] = [];

  // ターン番号は0から始まるが、最大ターン数は不明なので
  // 複数ターンを検索する（最大60ターン = オセロの最大手数）
  for (let turn = 0; turn < 60; turn++) {
    const docClient = getDynamoDocClient();
    const command = new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}#TURN#${turn}`,
      },
    });

    const result = await docClient.send(command);

    if (result.Items && result.Items.length > 0) {
      for (const item of result.Items) {
        candidates.push({
          PK: item.PK as string,
          SK: item.SK as string,
        });
      }
    } else {
      // このターンにデータがなければ、以降のターンもないと判断
      break;
    }
  }

  return candidates;
}

/**
 * アイテムをバッチ削除する（25件ずつ）
 */
export async function batchDeleteItems(
  tableName: string,
  items: Array<{ PK: string; SK: string }>
): Promise<number> {
  if (items.length === 0) return 0;

  let deletedCount = 0;
  const BATCH_SIZE = 25; // DynamoDB BatchWriteItem の上限

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const docClient = getDynamoDocClient();

    const command = new BatchWriteCommand({
      RequestItems: {
        [tableName]: batch.map((item) => ({
          DeleteRequest: {
            Key: { PK: item.PK, SK: item.SK },
          },
        })),
      },
    });

    await docClient.send(command);
    deletedCount += batch.length;
  }

  return deletedCount;
}

/**
 * 単一アイテムを削除する
 */
async function deleteItem(tableName: string, pk: string, sk: string): Promise<void> {
  const docClient = getDynamoDocClient();
  const command = new DeleteCommand({
    TableName: tableName,
    Key: { PK: pk, SK: sk },
  });
  await docClient.send(command);
}

/**
 * E2Eテストデータのクリーンアップを実行する
 */
export async function cleanupE2EData(tableName: string): Promise<CleanupResult> {
  const errors: string[] = [];
  let gamesDeleted = 0;
  let candidatesDeleted = 0;

  // 1. GSI3でE2Eタグ付きゲームを検索
  const games = await findE2EGames(tableName);
  console.log(`[E2E Cleanup] Found ${games.length} E2E-tagged games`);

  // 2. 各ゲームの関連データを削除
  for (const game of games) {
    try {
      // 関連Candidate_Entityを検索・削除
      try {
        const candidates = await findGameCandidates(tableName, game.gameId);
        if (candidates.length > 0) {
          const deleted = await batchDeleteItems(tableName, candidates);
          candidatesDeleted += deleted;
          console.log(`[E2E Cleanup] Deleted ${deleted} candidates for game ${game.gameId}`);
        }
      } catch (error) {
        const msg = `Failed to delete candidates for game ${game.gameId}: ${error}`;
        console.error(`[E2E Cleanup] ${msg}`);
        errors.push(msg);
        // 関連データ削除失敗でもゲーム本体の削除を試行
      }

      // ゲーム本体を削除
      await deleteItem(tableName, game.PK, game.SK);
      gamesDeleted++;
    } catch (error) {
      const msg = `Failed to delete game ${game.gameId}: ${error}`;
      console.error(`[E2E Cleanup] ${msg}`);
      errors.push(msg);
      // エラーが発生しても残りのゲームの削除を継続
    }
  }

  return { gamesDeleted, candidatesDeleted, errors };
}
