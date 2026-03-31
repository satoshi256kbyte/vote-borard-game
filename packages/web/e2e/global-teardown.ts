/**
 * Playwright global teardown
 * E2Eテスト終了時にE2Eタグ付きテストデータをDynamoDBから一括削除する
 *
 * Requirements:
 * - 4.1: GSI3を使用してTAG#E2Eタグを持つ全てのGame_Entityを検索
 * - 4.2: 該当するGame_Entityとその関連データ（Candidate_Entity）を削除
 * - 4.3: エラー発生時はログに記録し、残りのデータの削除を継続
 * - 4.4: テストの成否にかかわらず実行される
 * - 4.5: 削除したGame_Entityの件数をログに出力
 */

import { cleanupE2EData } from './helpers/e2e-cleanup';
import { withCredentialRefresh } from './helpers/aws-client-factory';

/**
 * Playwright global teardown
 */
export default async function globalTeardown(): Promise<void> {
  console.log('\n🧹 E2E Test Data Cleanup...\n');

  const tableName = process.env.DYNAMODB_TABLE_NAME;
  if (!tableName) {
    console.warn('[E2E Cleanup] DYNAMODB_TABLE_NAME is not set. Skipping cleanup.');
    return;
  }

  try {
    const result = await withCredentialRefresh(async () => {
      return await cleanupE2EData(tableName);
    });

    console.log(
      `\n✅ E2E Cleanup complete: ${result.gamesDeleted} games, ` +
        `${result.candidatesDeleted} candidates deleted`
    );

    if (result.errors.length > 0) {
      console.warn(`⚠️  ${result.errors.length} errors occurred during cleanup:`);
      for (const error of result.errors) {
        console.warn(`   - ${error}`);
      }
    }
  } catch (error) {
    // クリーンアップのエラーはテスト結果に影響させない
    console.error('[E2E Cleanup] Cleanup failed:', error);
    console.error('[E2E Cleanup] Test results are not affected by cleanup failures');
  }
}
