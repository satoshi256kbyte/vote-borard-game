# タスク: E2Eテストデータクリーンアップ

## タスク一覧

- [x] 1 既存のゴミ対局データの一括削除
  - [x] 1.1 DynamoDBのGSI3で `TAG#E2E` を検索し、現在残留しているE2Eテスト用ゴミ対局データを全件特定する
  - [x] 1.2 特定した全てのE2Eタグ付きGame_Entityとその関連Candidate_Entityを一括削除する（スクリプトまたはCLI経由）
  - [x] 1.3 削除完了後、GSI3で `TAG#E2E` を再検索し、残留データが0件であることを確認する
- [x] 2 cleanupE2EData関数の共通モジュール化
  - [x] 2.1 `packages/web/e2e/helpers/e2e-cleanup.ts` を新規作成し、`global-teardown.ts` から `cleanupE2EData`、`findE2EGames`、`findGameCandidates`、`batchDeleteItems` を移動する
  - [x] 2.2 `packages/web/e2e/helpers/e2e-cleanup.test.ts` を新規作成し、共通モジュールのユニットテストを実装する（0件ケース、正常削除、エラー継続）
  - [x] 2.3 `packages/web/e2e/helpers/e2e-cleanup.property.test.ts` を新規作成し、Property 1（完全削除）とProperty 2（エラー時継続）のプロパティベーステストを実装する
- [x] 3 globalSetupへの事前クリーンアップ追加
  - [x] 3.1 `packages/web/e2e/global-setup.ts` にサービス可用性チェック後の事前クリーンアップ処理を追加する（`cleanupE2EData` を呼び出し、エラー時はログ記録のみで続行）
  - [x] 3.2 `packages/web/e2e/global-setup.test.ts` に事前クリーンアップのテストケースを追加する（正常系、0件、エラー時の続行）
- [x] 4 globalTeardownの堅牢性向上
  - [x] 4.1 `packages/web/e2e/global-teardown.ts` を共通モジュール `e2e-cleanup.ts` からインポートするようリファクタリングする
  - [x] 4.2 `packages/web/e2e/global-teardown.test.ts` を共通モジュール使用に合わせて更新する
- [x] 5 フィクスチャレベルのクリーンアップ強化
  - [x] 5.1 `packages/web/e2e/fixtures/test-game.ts` の `finally` ブロック内にtry-catchを追加し、クリーンアップエラーがテスト結果に影響しないようにする
  - [x] 5.2 `packages/web/e2e/fixtures/test-game.test.ts` にクリーンアップエラー時のテストケースを追加する
- [x] 6 E2Eテストデータへのタグ付与確認・修正
  - [x] 6.1 `packages/web/e2e/helpers/test-data.ts` の `createTestGame` が `tags: ["E2E"]` と `GSI3PK: "TAG#E2E"` を設定していることを確認し、不足があれば修正する
  - [x] 6.2 E2Eテストでゲーム作成API経由で対局を作成している箇所を検索し、`tags: ["E2E"]` が指定されていることを確認・修正する
- [x] 7 GitHub Actionsワークフローの確認・修正
  - [x] 7.1 `.github/workflows/cd-development.yml` のE2Eテストジョブに `DYNAMODB_TABLE_NAME` 環境変数が設定されていることを確認する
  - [x] 7.2 `.github/workflows/e2e-game.yml` のE2Eテストジョブに `DYNAMODB_TABLE_NAME` 環境変数が設定されていることを確認する
  - [x] 7.3 Playwrightの `globalSetup` と `globalTeardown` 設定が `playwright.config.ts` に正しく設定されていることを確認する
