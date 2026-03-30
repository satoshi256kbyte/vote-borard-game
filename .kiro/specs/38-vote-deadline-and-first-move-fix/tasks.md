# 実装計画

- [x] 1. バグ条件の探索テスト（修正前にバグを再現）
  - **Property 1: Bug Condition** - 投票締切・初手判定・候補ターン番号バグ
  - **CRITICAL**: このテストは未修正コードで FAIL する — 失敗がバグの存在を証明する
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: このテストは期待される正しい動作をエンコードしている — 修正後に PASS することで修正を検証する
  - **GOAL**: バグの存在を示すカウンターサンプルを発見する
  - **Scoped PBT Approach**: 以下の具体的なバグ条件にスコープしたプロパティベーステストを作成
  - C1: `calculateVotingDeadline()` が当日の23:59:59 JSTを返すことをアサート（未修正コードでは翌日になるため FAIL）
    - 任意の日時 `now` に対して、返値が `now` と同じ日付（JST）の 23:59:59.999 であることを検証
  - C2: `isAITurn({ aiSide: 'WHITE', currentTurn: 0 })` が `true` を返すことをアサート（未修正コードでは `false` のため FAIL）
    - 任意の `aiSide` に対して、`isAITurn({ aiSide, currentTurn: 0 })` が `true` であることを検証
    - より一般的に、偶数ターンは常にAI側であることを検証
  - C3: `CandidateGenerator.processGame()` が `currentTurn` に対して候補を保存することをアサート（未修正コードでは `currentTurn + 1` のため FAIL）
  - C2+C3複合: `aiSide='WHITE'` のゲームで候補生成がスキップされないことをアサート（未修正コードではスキップされるため FAIL）
  - テストファイル: `packages/api/src/services/candidate-generator/candidate-generator.bugfix.property.test.ts` および `packages/api/src/lib/game-utils.bugfix.property.test.ts`
  - 未修正コードでテストを実行し、FAIL を確認
  - **EXPECTED OUTCOME**: テストが FAIL する（バグの存在を証明）
  - カウンターサンプルを記録して根本原因を理解する
  - テストの作成・実行・失敗の記録が完了したらタスク完了とする
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

- [~] 2. 保全プロパティテスト（修正前に既存動作を記録）
  - **Property 2: Preservation** - aiSide='BLACK' の動作・投票集計・AI手実行の保全
  - **IMPORTANT**: 観察ファーストの方法論に従う
  - 観察: 未修正コードで `isAITurn({ aiSide: 'BLACK', currentTurn: n })` の結果を確認（偶数=true, 奇数=false）
  - 観察: 未修正コードで `determineWinner()` の結果を確認（石数比較ロジックは変更なし）
  - 観察: 未修正コードで候補の `position`、`description`、`createdBy` 等の属性保存を確認
  - プロパティベーステスト: `aiSide='BLACK'` のランダムなターン番号で `isAITurn()` が `currentTurn % 2 === 0` と一致することを検証
  - プロパティベーステスト: AIの手番のゲームに対して VoteTallyService がスキップすることを検証
  - プロパティベーステスト: 集合知の手番のゲームに対して AIMoveExecutor がスキップすることを検証
  - テストファイル: `packages/api/src/lib/game-utils.bugfix.property.test.ts`（保全テスト追加）
  - 未修正コードでテストを実行し、PASS を確認
  - **EXPECTED OUTCOME**: テストが PASS する（保全すべき既存動作のベースラインを確認）
  - テストの作成・実行・PASS の確認が完了したらタスク完了とする
  - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7_

- [ ] 3. 投票締切・初手判定・候補ターン番号バグの修正
  - [~] 3.1 isAITurn() の手番判定ロジックを修正
    - `packages/api/src/lib/game-utils.ts` の `isAITurn()` を修正
    - 変更前: `const currentColor = game.currentTurn % 2 === 0 ? 'BLACK' : 'WHITE'; return currentColor === game.aiSide;`
    - 変更後: `return game.currentTurn % 2 === 0;`（偶数ターン = AI側）
    - これにより turn 0 は常にAIの手番となる
    - _Bug_Condition: isBugCondition(input) where input.aiSide == 'WHITE' AND input.currentTurn == 0 AND isAITurn(input) == false_
    - _Expected_Behavior: isAITurn(game) == (game.currentTurn % 2 === 0) for all aiSide values_
    - _Preservation: aiSide='BLACK' のゲームでは修正前後で isAITurn() の結果が一致_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.5_

  - [~] 3.2 calculateVotingDeadline() の日付加算を削除
    - `packages/api/src/services/candidate-generator/index.ts` の `calculateVotingDeadline()` を修正
    - `nextDay.setDate(nextDay.getDate() + 1)` の行を削除
    - 変数名を `nextDay` → `today` に変更（意味の明確化）
    - _Bug_Condition: calculateVotingDeadline() が翌日の23:59:59 JSTを返す_
    - _Expected_Behavior: 当日の23:59:59.999 JST をISO文字列で返す_
    - _Preservation: 候補の position、description、createdBy 等の属性保存は変更なし_
    - _Requirements: 2.1, 3.1_

  - [~] 3.3 CandidateGenerator の候補ターン番号と スキップ判定を修正
    - `packages/api/src/services/candidate-generator/index.ts` の `processGame()` を修正
    - `nextTurn = game.currentTurn + 1` → `game.currentTurn` に変更（候補を現在のターンに保存）
    - `isAITurn({ ...game, currentTurn: game.currentTurn + 1 })` → `isAITurn(game)` に変更（現在のターンがAIの手番かチェック）
    - _Bug_Condition: 候補が currentTurn + 1 に保存され、フロントエンドの取得ターンと不一致_
    - _Expected_Behavior: 候補が currentTurn に保存され、getCandidates(gameId, game.currentTurn) で取得可能_
    - _Preservation: バッチ処理の実行順序（投票集計 → AI手実行 → 候補生成）は維持_
    - _Requirements: 2.3, 2.4, 2.5, 3.1, 3.6_

  - [~] 3.4 既存の isAITurn ユニットテスト・プロパティテストを修正後のロジックに合わせて更新
    - `packages/api/src/lib/game-utils.test.ts` の isAITurn テストケースを更新
    - `packages/api/src/lib/game-utils.property.test.ts` の Property 4 を更新
    - 修正後: 偶数ターンは常に `true`、奇数ターンは常に `false`（aiSide に依存しない）
    - _Requirements: 2.2, 3.5_

  - [~] 3.5 バグ条件探索テストが PASS することを確認
    - **Property 1: Expected Behavior** - 投票締切・初手判定・候補ターン番号の正しい動作
    - **IMPORTANT**: タスク1で作成した同じテストを再実行する — 新しいテストは書かない
    - タスク1のテストは期待される正しい動作をエンコードしている
    - このテストが PASS すれば、期待される動作が満たされたことを確認できる
    - タスク1の探索テストを実行
    - **EXPECTED OUTCOME**: テストが PASS する（バグが修正されたことを確認）
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [~] 3.6 保全テストが引き続き PASS することを確認
    - **Property 2: Preservation** - aiSide='BLACK' の動作・投票集計・AI手実行の保全
    - **IMPORTANT**: タスク2で作成した同じテストを再実行する — 新しいテストは書かない
    - タスク2の保全テストを実行
    - **EXPECTED OUTCOME**: テストが PASS する（リグレッションなしを確認）
    - すべてのテストが修正後も PASS することを確認（リグレッションなし）
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.7_

- [~] 4. チェックポイント - 全テストの PASS を確認
  - `pnpm test` で全テストを実行し、すべて PASS することを確認
  - 質問がある場合はユーザーに確認する
