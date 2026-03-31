# 要件定義書

## はじめに

E2Eテスト（Playwright）で作成される対局データのクリーンアップ機能を改善する。現状、spec 36 で実装した `globalTeardown` によるクリーンアップ機構が存在するが、テストプロセスの異常終了やCI環境でのタイムアウト等により `globalTeardown` が実行されないケースがあり、E2Eテスト用対局データ（`E2E` タグ付き）がDynamoDBに蓄積している。

本specでは、テスト開始前（`globalSetup`）にも前回残留したE2Eデータを削除する「事前クリーンアップ」を導入し、テスト成功・失敗・異常終了のいずれの場合でもE2Eデータが確実に削除される仕組みを構築する。また、個別テストのフィクスチャレベルでのクリーンアップも強化し、多層防御によるデータ残留ゼロを目指す。

## 用語集

- **Game_Entity**: DynamoDBに保存される対局データ（PK: `GAME#<gameId>`, SK: `GAME#<gameId>`）
- **Candidate_Entity**: 対局の手候補データ（PK: `GAME#<gameId>#TURN#<turnNumber>`, SK: `CANDIDATE#<candidateId>`）
- **E2Eタグ**: Game_Entityの `tags` フィールドに含まれる文字列 `"E2E"`。テストデータの識別に使用する
- **GSI3**: DynamoDBのGlobal Secondary Index。パーティションキー `GSI3PK` = `TAG#E2E` でE2Eタグ付きGame_Entityを検索可能
- **事前クリーンアップ**: Playwrightの `globalSetup` 内でテスト開始前に実行されるE2Eデータ削除処理
- **事後クリーンアップ**: Playwrightの `globalTeardown` 内でテスト終了後に実行されるE2Eデータ削除処理
- **フィクスチャクリーンアップ**: 個別テストのフィクスチャ（`test-game.ts`）内で実行されるテストデータ削除処理
- **Playwright_Global_Setup**: Playwrightの全テスト開始前に1回実行されるグローバル前処理関数（`e2e/global-setup.ts`）
- **Playwright_Global_Teardown**: Playwrightの全テスト完了後に1回実行されるグローバル後処理関数（`e2e/global-teardown.ts`）
- **Test_Game_Fixture**: Playwrightのテストフィクスチャとしてテスト対局を提供するモジュール（`e2e/fixtures/test-game.ts`）
- **cleanupE2EData**: GSI3を使用してE2Eタグ付きGame_Entityとその関連データを一括削除する共通関数（`e2e/global-teardown.ts` に定義済み）

## 要件

### 要件 1: テスト開始前の事前クリーンアップ

**ユーザーストーリー:** 開発者として、E2Eテスト開始前に前回残留したテストデータを削除したい。それにより、前回のテスト異常終了で残ったゴミデータがテスト結果に影響しないようにする。

#### 受け入れ基準

1. WHEN Playwright_Global_Setup が実行される場合、THE Playwright_Global_Setup SHALL サービス可用性チェックの後に `cleanupE2EData` 関数を呼び出し、GSI3を使用して `TAG#E2E` タグを持つ全てのGame_Entityとその関連Candidate_Entityを削除する
2. WHEN 事前クリーンアップで削除対象のGame_Entityが0件の場合、THE Playwright_Global_Setup SHALL 「残留E2Eデータなし」のログを出力し、正常に処理を継続する
3. WHEN 事前クリーンアップで削除対象のGame_Entityが1件以上の場合、THE Playwright_Global_Setup SHALL 削除したGame_Entityの件数とCandidate_Entityの件数をログに出力する
4. IF 事前クリーンアップの実行中にエラーが発生した場合、THEN THE Playwright_Global_Setup SHALL エラーをログに記録し、テスト実行を継続する（事前クリーンアップの失敗でテスト全体を中断しない）

### 要件 2: 事後クリーンアップの堅牢性向上

**ユーザーストーリー:** 開発者として、テスト終了後のクリーンアップが確実に実行されることを保証したい。それにより、テスト失敗時でもデータが残留しないようにする。

#### 受け入れ基準

1. THE Playwright_Global_Teardown SHALL テストの成否にかかわらず `cleanupE2EData` 関数を呼び出す
2. IF 事後クリーンアップの実行中に個別のGame_Entity削除でエラーが発生した場合、THEN THE Playwright_Global_Teardown SHALL エラーをログに記録し、残りのGame_Entityの削除を継続する
3. WHEN 事後クリーンアップが完了した場合、THE Playwright_Global_Teardown SHALL 削除したGame_Entityの件数とCandidate_Entityの件数、発生したエラーの件数をログに出力する
4. IF 事後クリーンアップ全体が例外で失敗した場合、THEN THE Playwright_Global_Teardown SHALL エラーをログに記録するが、テスト結果のステータスには影響を与えない

### 要件 3: フィクスチャレベルのクリーンアップ強化

**ユーザーストーリー:** 開発者として、個別テストで作成したテストデータがテスト完了時に確実に削除されるようにしたい。それにより、テスト間のデータ干渉を防ぐ。

#### 受け入れ基準

1. WHEN Test_Game_Fixture のテストが完了した場合、THE Test_Game_Fixture SHALL `finally` ブロック内でテスト対局とその関連Candidate_Entityを削除する
2. IF Test_Game_Fixture のクリーンアップ中にエラーが発生した場合、THEN THE Test_Game_Fixture SHALL エラーをログに記録するが、テスト結果のステータスには影響を与えない
3. THE Test_Game_Fixture SHALL テスト対局作成時に `tags: ["E2E"]` と `GSI3PK: "TAG#E2E"` を設定する（事前・事後クリーンアップの対象となるようにする）

### 要件 4: クリーンアップ関数の共通化

**ユーザーストーリー:** 開発者として、クリーンアップロジックを一箇所に集約したい。それにより、事前・事後・フィクスチャの各クリーンアップで同一のロジックを使用し、保守性を高める。

#### 受け入れ基準

1. THE cleanupE2EData 関数 SHALL GSI3を使用して `TAG#E2E` タグを持つ全てのGame_Entityを検索する
2. THE cleanupE2EData 関数 SHALL 検索されたGame_Entityごとに、関連するCandidate_Entity（PK が `GAME#<gameId>#TURN#` で始まるアイテム）を検索し削除する
3. THE cleanupE2EData 関数 SHALL Game_Entity本体を削除する
4. THE cleanupE2EData 関数 SHALL 削除結果（削除したGame_Entity件数、Candidate_Entity件数、エラー一覧）を返却する
5. IF cleanupE2EData 関数の実行中に個別アイテムの削除でエラーが発生した場合、THEN THE cleanupE2EData 関数 SHALL エラーを記録し、残りのアイテムの削除を継続する

### 要件 5: GitHub Actionsワークフローでのクリーンアップ保証

**ユーザーストーリー:** 開発者として、CI/CDパイプラインでE2Eテスト前後のクリーンアップが自動実行されることを保証したい。それにより、CI環境でのデータ残留を防ぐ。

#### 受け入れ基準

1. THE cd-development.yml ワークフロー SHALL Playwrightの `globalSetup` と `globalTeardown` 設定を通じて事前・事後クリーンアップを自動的に実行する
2. THE e2e-game.yml ワークフロー SHALL Playwrightの `globalSetup` と `globalTeardown` 設定を通じて事前・事後クリーンアップを自動的に実行する
3. IF E2Eテストジョブがタイムアウトで強制終了された場合でも、THEN THE 次回のE2Eテスト実行時の事前クリーンアップ SHALL 前回残留したE2Eデータを削除する
4. THE 各ワークフロー SHALL `DYNAMODB_TABLE_NAME` 環境変数をE2Eテストジョブに設定し、クリーンアップ処理がDynamoDBにアクセスできるようにする

### 要件 6: E2Eテストデータの識別

**ユーザーストーリー:** 開発者として、E2Eテストで作成される全てのデータに確実にE2Eタグが付与されることを保証したい。それにより、クリーンアップ対象の漏れを防ぐ。

#### 受け入れ基準

1. WHEN E2Eテストのヘルパー関数（`createTestGame`）がGame_Entityを作成する場合、THE ヘルパー関数 SHALL `tags` フィールドに `"E2E"` を含め、`GSI3PK` を `TAG#E2E` に設定する
2. WHEN E2Eテストがゲーム作成API（POST /api/games）経由で対局を作成する場合、THE E2Eテスト SHALL リクエストボディの `tags` フィールドに `["E2E"]` を指定する
3. THE E2Eテスト SHALL DynamoDB直接書き込みとAPI経由の両方の作成パスで `E2E` タグを付与する
