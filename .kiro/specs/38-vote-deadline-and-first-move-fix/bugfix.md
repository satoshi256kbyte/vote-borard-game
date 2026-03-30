# バグ修正要件ドキュメント

## Introduction

本ドキュメントは、投票対局アプリケーションにおける3つの関連バグを修正するための要件を定義する。

1. **投票締切の日付ずれ**: `calculateVotingDeadline()` が翌日の23:59:59 JSTを設定しているが、候補生成当日の23:59:59 JSTにすべき
2. **初手がAI側でない**: `aiSide='WHITE'` の場合、turn 0 が黒=集合知の手番となり、集合知が先手になってしまう。初手は常にAI側であるべき
3. **次の一手候補が表示されない**: CandidateGenerator は `currentTurn + 1`（次のターン）に対して候補を生成するが、フロントエンドは `getCandidates(gameId, game.currentTurn)` で現在のターンの候補を取得しており、ターン番号のミスマッチが発生している。また、初手がAI側でない場合に候補生成がスキップされる問題も関連する

これらのバグは相互に関連しており、特にバグ2（初手の問題）がバグ3（候補非表示）の根本原因の一つとなっている。

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN CandidateGenerator が候補を生成する THEN `calculateVotingDeadline()` が現在日時の翌日の23:59:59 JST を投票締切として設定する（1日余分に加算される）

1.2 WHEN `aiSide='WHITE'` でゲームが作成される THEN turn 0 は黒の手番であり、黒=集合知側となるため、集合知が先手になる（AIが先手にならない）

1.3 WHEN CandidateGenerator が候補を生成する THEN 候補は `currentTurn + 1`（次のターン）に対して保存される

1.4 WHEN フロントエンドが候補を取得する THEN `getCandidates(gameId, game.currentTurn)` で現在のターン番号の候補を取得するが、候補は `currentTurn + 1` に対して生成されているため、候補が見つからない

1.5 WHEN `aiSide='WHITE'` でゲームが作成され、turn 0 が集合知の手番になる THEN CandidateGenerator は「次のターン（turn 1）がAIの手番」と判定してスキップし、turn 0 の集合知の手番に対する候補が生成されない

### Expected Behavior (Correct)

2.1 WHEN CandidateGenerator が候補を生成する THEN `calculateVotingDeadline()` は候補生成当日の23:59:59 JST を投票締切として設定する SHALL

2.2 WHEN ゲームが作成される THEN 初手は常にAI側である SHALL（`aiSide` の値に関わらず、turn 0 がAIの手番となるようにする）

2.3 WHEN CandidateGenerator が候補を生成する THEN 候補は現在のターン（`currentTurn`）に対して保存される SHALL（フロントエンドの取得ロジックと一致させる）

2.4 WHEN フロントエンドが候補を取得する THEN `getCandidates(gameId, game.currentTurn)` で取得したターン番号に対応する候補が正しく返される SHALL

2.5 WHEN 現在のターンが集合知の手番である THEN CandidateGenerator はそのターンに対する候補を生成する SHALL

### Unchanged Behavior (Regression Prevention)

3.1 WHEN 候補が正常に生成される THEN 候補の position、description、createdBy 等の属性は従来通り正しく保存される SHALL CONTINUE TO

3.2 WHEN AIの手番である THEN AIMoveExecutor は従来通り正しくAIの手を実行する SHALL CONTINUE TO

3.3 WHEN 投票集計が実行される THEN VoteTallyService は従来通り正しく投票を集計し、最多得票の候補を採用する SHALL CONTINUE TO

3.4 WHEN ゲームが終了条件を満たす THEN 従来通り正しくゲームが終了状態に更新される SHALL CONTINUE TO

3.5 WHEN `aiSide='BLACK'` でゲームが作成される THEN 従来通り turn 0 が黒=AIの手番として正しく動作する SHALL CONTINUE TO

3.6 WHEN バッチ処理が実行される THEN 投票集計 → AI手実行 → 候補生成 → 解説生成 → 状態更新の実行順序は従来通り維持される SHALL CONTINUE TO

3.7 WHEN 候補に対して投票が行われる THEN 投票の記録と集計は従来通り正しく動作する SHALL CONTINUE TO
