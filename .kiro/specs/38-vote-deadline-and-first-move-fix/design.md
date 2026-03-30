# 投票締切日付・初手・候補ターン番号バグ修正 設計ドキュメント

## Overview

本ドキュメントは、投票対局アプリケーションにおける3つの関連バグの修正設計を定義する。

1. `calculateVotingDeadline()` が翌日の23:59:59 JSTを返しているが、当日の23:59:59 JSTを返すべき
2. `aiSide='WHITE'` の場合、turn 0 が黒=集合知の手番になり初手がAIにならない
3. CandidateGenerator が `currentTurn + 1` に候補を保存するが、フロントエンドは `currentTurn` で取得するためミスマッチが発生

これらは相互に関連しており、特にバグ2がバグ3の根本原因の一つである。修正は各関数の局所的な変更で対応可能であり、既存のバッチ処理フロー（投票集計 → AI手実行 → 候補生成 → 解説生成 → 状態更新）の順序は変更しない。

## Glossary

- **Bug_Condition (C)**: 3つのバグ条件の論理和。C1: 投票締切が翌日になる、C2: aiSide='WHITE' で初手が集合知になる、C3: 候補のターン番号がフロントエンドの取得ターンと不一致
- **Property (P)**: 各バグ条件に対する正しい動作。P1: 当日23:59:59 JST、P2: 初手は常にAI、P3: 候補ターン番号がフロントエンドと一致
- **Preservation**: 既存のマウスクリック、投票集計、AI手実行、ゲーム終了判定等の動作が変更されないこと
- **`calculateVotingDeadline()`**: `packages/api/src/services/candidate-generator/index.ts` 内の関数。候補の投票締切日時を計算する
- **`isAITurn(game)`**: `packages/api/src/lib/game-utils.ts` 内の関数。現在のターンがAI側の手番かを判定する
- **`createGame(params)`**: `packages/api/src/services/game.ts` 内の関数。新規ゲームを作成する
- **`CandidateGenerator.processGame()`**: `packages/api/src/services/candidate-generator/index.ts` 内のメソッド。対局ごとに候補を生成する

## Bug Details

### Bug Condition

3つのバグは以下の条件で発生する:

**C1: 投票締切の日付ずれ**
`calculateVotingDeadline()` が `nextDay.setDate(nextDay.getDate() + 1)` で翌日に加算してから23:59:59を設定している。結果として、候補生成当日ではなく翌日の23:59:59 JSTが締切になる。

**C2: 初手がAI側でない**
`isAITurn()` は `currentTurn % 2 === 0` → BLACK と判定する。`aiSide='WHITE'` の場合、turn 0 は BLACK=集合知の手番となり、AIが先手にならない。ゲーム作成時に `aiSide` の値に応じた調整がされていない。

**C3: 候補ターン番号のミスマッチ**
`CandidateGenerator.processGame()` は `nextTurn = game.currentTurn + 1` に対して候補を保存する。一方、フロントエンド (`page.tsx`) は `getCandidates(gameId, game.currentTurn)` で現在のターンの候補を取得する。さらに、C2により `aiSide='WHITE'` の場合は turn 0 が集合知の手番なのに、CandidateGenerator は「次のターン(turn 1)がAIの手番」と判定してスキップする。

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { functionName: string, game: GameEntity, now?: Date }
  OUTPUT: boolean

  // C1: 投票締切の日付ずれ
  IF input.functionName == 'calculateVotingDeadline'
    deadline := calculateVotingDeadline(input.now)
    expectedDeadline := sameDay2359JST(input.now)
    RETURN deadline != expectedDeadline

  // C2: 初手がAI側でない
  IF input.functionName == 'createGame'
    RETURN input.game.aiSide == 'WHITE'
           AND input.game.currentTurn == 0
           AND isAITurn(input.game) == false

  // C3: 候補ターン番号のミスマッチ
  IF input.functionName == 'processGame'
    candidateTurn := input.game.currentTurn + 1
    frontendQueryTurn := input.game.currentTurn
    RETURN candidateTurn != frontendQueryTurn

  RETURN false
END FUNCTION
```

### Examples

- **C1**: 2024-07-15 10:00 JST にバッチ実行 → 締切が 2024-07-16T23:59:59.999 JST になる（期待値: 2024-07-15T23:59:59.999 JST）
- **C2**: `aiSide='WHITE'` でゲーム作成 → turn 0 は BLACK の手番 → 集合知が先手になる（期待値: AIが先手）
- **C3**: `currentTurn=2` のゲームに対して候補が `turnNumber=3` で保存される → フロントエンドは `turnNumber=2` で取得 → 候補が見つからない
- **C2+C3の複合**: `aiSide='WHITE'` でゲーム作成 → turn 0 が集合知の手番 → CandidateGenerator は「次のターン(turn 1)がAIの手番」と判定しスキップ → 候補が一切生成されない

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- `aiSide='BLACK'` のゲームでは、従来通り turn 0 が黒=AIの手番として正しく動作する
- VoteTallyService の投票集計ロジック（候補取得、投票締切、最多得票候補の特定、盤面更新）は変更しない
- AIMoveExecutor のAI手実行ロジック（手番判定、Bedrock呼び出し、盤面更新）は変更しない
- バッチ処理の実行順序（投票集計 → AI手実行 → 候補生成 → 解説生成 → 状態更新）は維持する
- ゲーム終了判定（`shouldEndGame`、`determineWinner`）は変更しない
- 候補の `position`、`description`、`createdBy` 等の属性保存は変更しない
- 投票の記録と集計は変更しない

**Scope:**
以下の入力・操作はこの修正の影響を受けない:

- マウスクリックによるUI操作
- 投票の投稿・取得
- ゲーム一覧の取得
- ゲーム詳細の取得（盤面表示）
- 解説の生成・取得

## Hypothesized Root Cause

### C1: 投票締切の日付ずれ

`calculateVotingDeadline()` のコード:

```typescript
nextDay.setDate(nextDay.getDate() + 1); // ← ここで翌日に加算
nextDay.setHours(23, 59, 59, 999);
```

`+ 1` が不要。当日の23:59:59 JSTにするには、加算せずに `setHours(23, 59, 59, 999)` のみでよい。

### C2: 初手がAI側でない

`isAITurn()` は `currentTurn % 2 === 0 → BLACK` というハードコードされたマッピングを使用。オセロでは黒が先手だが、このアプリでは「AIが常に先手」という要件がある。`aiSide='WHITE'` の場合、turn 0 が BLACK=集合知になってしまう。

根本原因は2つのアプローチで修正可能:

1. **`isAITurn()` を修正**: turn 0 を常にAI側とするロジックに変更（`currentTurn % 2 === 0` → AI側）
2. **`createGame()` で `aiSide` を強制**: `aiSide` を常に `'BLACK'` に強制し、turn 0 = BLACK = AI を保証

アプローチ1が適切。`isAITurn()` の判定を「偶数ターン = AI側」に変更すれば、`aiSide` の値に関わらず turn 0 が常にAIの手番になる。

### C3: 候補ターン番号のミスマッチ

`CandidateGenerator.processGame()` のコード:

```typescript
const nextTurn = game.currentTurn + 1;
const existingCandidates = await this.candidateRepository.listByTurn(game.gameId, nextTurn);
// ...
await this.saveCandidate(game.gameId, nextTurn, candidate, votingDeadline);
```

候補を `currentTurn + 1`（次のターン）に保存しているが、フロントエンドは `game.currentTurn` で取得する。候補は「現在のターン」に対して保存すべき。

また、CandidateGenerator は「次のターンがAIの手番か」をチェックしてスキップ判定しているが、これは「現在のターンがAIの手番か」をチェックすべき。

## Correctness Properties

Property 1: Bug Condition - 投票締切が当日の23:59:59 JSTである

_For any_ 日時 `now` に対して、修正後の `calculateVotingDeadline()` は `now` と同じ日付の23:59:59.999 JST をISO文字列で返す SHALL。

**Validates: Requirements 2.1**

Property 2: Bug Condition - 初手は常にAIの手番である

_For any_ `aiSide` の値（'BLACK' または 'WHITE'）に対して、修正後の `isAITurn({ aiSide, currentTurn: 0 })` は `true` を返す SHALL。より一般的に、偶数ターンは常にAI側、奇数ターンは常に集合知側である。

**Validates: Requirements 2.2**

Property 3: Bug Condition - 候補のターン番号がフロントエンドの取得ターンと一致する

_For any_ アクティブなゲームに対して、修正後の `CandidateGenerator.processGame()` は `game.currentTurn` に対して候補を保存する SHALL。フロントエンドの `getCandidates(gameId, game.currentTurn)` で取得可能である。

**Validates: Requirements 2.3, 2.4, 2.5**

Property 4: Preservation - aiSide='BLACK' の動作が変わらない

_For any_ `aiSide='BLACK'` のゲームに対して、修正後の `isAITurn()` は修正前と同じ結果を返す SHALL。turn 0 = BLACK = AI の関係は維持される。

**Validates: Requirements 3.5**

Property 5: Preservation - 投票集計・AI手実行・ゲーム終了の動作が変わらない

_For any_ 既存の投票集計、AI手実行、ゲーム終了判定のフローに対して、修正後のコードは修正前と同じ結果を生成する SHALL（`isAITurn()` の判定変更による手番判定の整合性を含む）。

**Validates: Requirements 3.2, 3.3, 3.4, 3.6, 3.7**

## Fix Implementation

### Changes Required

仮説した根本原因が正しいと仮定して、以下の変更を行う:

**File**: `packages/api/src/lib/game-utils.ts`

**Function**: `isAITurn(game)`

**Specific Changes**:

1. **手番判定ロジックの変更**: `currentTurn % 2 === 0` → AI側（`aiSide`）ではなく、偶数ターンを常にAI側とする
   - 変更前: `const currentColor = game.currentTurn % 2 === 0 ? 'BLACK' : 'WHITE'; return currentColor === game.aiSide;`
   - 変更後: `return game.currentTurn % 2 === 0;`
   - これにより、turn 0 は常にAIの手番となる

---

**File**: `packages/api/src/services/candidate-generator/index.ts`

**Function**: `calculateVotingDeadline()`

**Specific Changes**: 2. **日付加算の削除**: `nextDay.setDate(nextDay.getDate() + 1)` の行を削除

- 変更前: 翌日の23:59:59 JST
- 変更後: 当日の23:59:59 JST

3. **変数名の修正**: `nextDay` → `today` に変更（意味の明確化）

---

**File**: `packages/api/src/services/candidate-generator/index.ts`

**Function**: `processGame(game)`

**Specific Changes**: 4. **候補ターン番号の修正**: `nextTurn = game.currentTurn + 1` → `game.currentTurn` に変更

- 候補を現在のターンに対して保存する

5. **スキップ判定の修正**: `isAITurn({ ...game, currentTurn: game.currentTurn + 1 })` → `isAITurn(game)` に変更
   - 「現在のターンがAIの手番か」をチェックし、AIの手番ならスキップ（候補は集合知の手番にのみ生成）

---

**File**: `packages/web/src/app/games/[gameId]/page.tsx`

**Specific Changes**: 6. **フロントエンドの変更は不要**: 候補のターン番号を `currentTurn` に統一することで、既存の `getCandidates(gameId, game.currentTurn)` がそのまま正しく動作する

---

**File**: `packages/api/src/services/game.ts`

**Function**: `createGame(params)`

**Specific Changes**: 7. **`aiSide` の強制は不要**: `isAITurn()` の修正により、`aiSide` の値に関わらず turn 0 が常にAIの手番になるため、`createGame()` での `aiSide` 強制は不要

## Testing Strategy

### Validation Approach

テスト戦略は2フェーズで構成する: まず未修正コードでバグを再現するカウンターサンプルを発見し、次に修正後のコードで正しい動作と既存動作の保全を検証する。

### Exploratory Bug Condition Checking

**Goal**: 修正実装前に、未修正コードでバグを再現するカウンターサンプルを発見する。根本原因の仮説を確認または否定する。否定された場合は再仮説が必要。

**Test Plan**: 各バグ条件に対してユニットテストを作成し、未修正コードで実行して失敗を観察する。

**Test Cases**:

1. **C1: 投票締切テスト**: `calculateVotingDeadline()` を呼び出し、返値が当日の23:59:59 JSTであることをアサート（未修正コードでは翌日になるため失敗）
2. **C2: 初手判定テスト**: `isAITurn({ aiSide: 'WHITE', currentTurn: 0 })` が `true` を返すことをアサート（未修正コードでは `false` になるため失敗）
3. **C3: 候補ターン番号テスト**: `processGame()` が `currentTurn` に対して候補を保存することをアサート（未修正コードでは `currentTurn + 1` に保存するため失敗）
4. **C2+C3複合テスト**: `aiSide='WHITE'` のゲームで候補生成がスキップされないことをアサート（未修正コードではスキップされるため失敗）

**Expected Counterexamples**:

- `calculateVotingDeadline()` が翌日の日付を含むISO文字列を返す
- `isAITurn({ aiSide: 'WHITE', currentTurn: 0 })` が `false` を返す
- 候補が `turnNumber = currentTurn + 1` で保存される
- `aiSide='WHITE'` のゲームで候補生成がスキップされる

### Fix Checking

**Goal**: バグ条件が成立するすべての入力に対して、修正後の関数が期待される動作を生成することを検証する。

**Pseudocode:**

```
FOR ALL now WHERE isBugCondition_C1(now) DO
  deadline := calculateVotingDeadline_fixed(now)
  ASSERT deadline は now と同じ日付の 23:59:59.999 JST
END FOR

FOR ALL game WHERE isBugCondition_C2(game) DO
  result := isAITurn_fixed(game)
  ASSERT result == (game.currentTurn % 2 == 0)
END FOR

FOR ALL game WHERE isBugCondition_C3(game) DO
  candidates := processGame_fixed(game)
  ASSERT candidates の turnNumber == game.currentTurn
END FOR
```

### Preservation Checking

**Goal**: バグ条件が成立しないすべての入力に対して、修正後の関数が修正前と同じ結果を生成することを検証する。

**Pseudocode:**

```
FOR ALL game WHERE game.aiSide == 'BLACK' DO
  ASSERT isAITurn_original(game) == isAITurn_fixed(game)
END FOR

FOR ALL game WHERE isAITurn_fixed(game) == true DO
  ASSERT processGame_fixed(game).status == 'skipped'
END FOR
```

**Testing Approach**: プロパティベーステスト（fast-check）を推奨する。理由:

- 多様な日時・ゲーム状態を自動生成し、網羅的にテストできる
- 手動テストでは見逃しやすいエッジケース（日付境界、タイムゾーン境界）を検出できる
- `aiSide='BLACK'` の保全を強力に保証できる

**Test Plan**: まず未修正コードで既存動作を観察し、その動作をプロパティベーステストで捕捉する。

**Test Cases**:

1. **aiSide='BLACK' 保全テスト**: ランダムなターン番号で `isAITurn({ aiSide: 'BLACK', currentTurn: n })` の結果が修正前後で一致することを検証
2. **投票集計の保全テスト**: AIの手番のゲームに対して VoteTallyService がスキップすることを検証
3. **AI手実行の保全テスト**: 集合知の手番のゲームに対して AIMoveExecutor がスキップすることを検証
4. **候補属性の保全テスト**: 生成された候補の `position`、`description`、`createdBy` 等が正しく保存されることを検証

### Unit Tests

- `calculateVotingDeadline()` が各種日時で当日の23:59:59 JSTを返すことをテスト
- `calculateVotingDeadline()` の日付境界テスト（23:00 JST、0:00 JST、0:01 JST）
- `isAITurn()` が `aiSide='BLACK'` と `aiSide='WHITE'` の両方で正しく動作することをテスト
- `isAITurn()` の偶数/奇数ターンでの動作テスト
- `processGame()` が `currentTurn` に対して候補を保存することをテスト
- `processGame()` がAIの手番でスキップすることをテスト

### Property-Based Tests

- ランダムな日時で `calculateVotingDeadline()` が常に当日の23:59:59 JSTを返すことを検証
- ランダムな `aiSide` とターン番号で `isAITurn()` が `currentTurn % 2 === 0` と一致することを検証
- `aiSide='BLACK'` のランダムなターン番号で修正前後の `isAITurn()` の結果が一致することを検証
- ランダムなゲーム状態で候補のターン番号が `currentTurn` と一致することを検証

### Integration Tests

- バッチ処理の全フロー（投票集計 → AI手実行 → 候補生成）が `aiSide='WHITE'` のゲームで正しく動作することをテスト
- `aiSide='WHITE'` のゲーム作成後、候補生成 → 投票 → 集計 → AI手実行の一連のフローが正しく動作することをテスト
- フロントエンドが `getCandidates(gameId, game.currentTurn)` で候補を正しく取得できることをテスト
