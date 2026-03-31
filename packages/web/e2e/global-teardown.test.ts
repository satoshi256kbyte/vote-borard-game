/**
 * Unit tests for global-teardown (Playwright global teardown)
 *
 * Note: These tests are excluded from vitest (e2e/** is excluded).
 * They serve as documentation and can be run manually.
 *
 * global-teardown.ts は共通モジュール e2e-cleanup.ts の cleanupE2EData を
 * 呼び出すオーケストレーション層。個別関数のテストは e2e-cleanup.test.ts に移動済み。
 *
 * Requirements:
 * - 2.1: テストの成否にかかわらず cleanupE2EData を呼び出す
 * - 2.3: 削除件数とエラー件数をログに出力
 * - 2.4: クリーンアップ全体が例外で失敗してもテスト結果に影響しない
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock shared modules before importing global-teardown
const mockCleanupE2EData = vi.fn();
vi.mock('./helpers/e2e-cleanup', () => ({
  cleanupE2EData: mockCleanupE2EData,
}));

const mockWithCredentialRefresh = vi.fn((fn: () => Promise<unknown>) => fn());
vi.mock('./helpers/aws-client-factory', () => ({
  withCredentialRefresh: mockWithCredentialRefresh,
}));

import globalTeardown from './global-teardown';

const TABLE_NAME = 'test-table';

describe('globalTeardown', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCleanupE2EData.mockReset();
    mockWithCredentialRefresh.mockReset();
    mockWithCredentialRefresh.mockImplementation((fn: () => Promise<unknown>) => fn());
    process.env = { ...originalEnv };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should skip when DYNAMODB_TABLE_NAME is not set', async () => {
    delete process.env.DYNAMODB_TABLE_NAME;

    await globalTeardown();

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('DYNAMODB_TABLE_NAME is not set')
    );
    expect(mockCleanupE2EData).not.toHaveBeenCalled();
  });

  it('should run cleanup when DYNAMODB_TABLE_NAME is set', async () => {
    process.env.DYNAMODB_TABLE_NAME = TABLE_NAME;
    mockCleanupE2EData.mockResolvedValueOnce({
      gamesDeleted: 2,
      candidatesDeleted: 5,
      errors: [],
    });

    await globalTeardown();

    expect(mockWithCredentialRefresh).toHaveBeenCalledTimes(1);
    expect(mockCleanupE2EData).toHaveBeenCalledWith(TABLE_NAME);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('E2E Cleanup complete'));
  });

  it('should log error count when cleanup has errors', async () => {
    process.env.DYNAMODB_TABLE_NAME = TABLE_NAME;
    mockCleanupE2EData.mockResolvedValueOnce({
      gamesDeleted: 1,
      candidatesDeleted: 0,
      errors: ['Failed to delete candidates for game g1: Error'],
    });

    await globalTeardown();

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('1 errors occurred'));
  });

  it('should not throw on cleanup failure (Req 2.4)', async () => {
    process.env.DYNAMODB_TABLE_NAME = TABLE_NAME;
    mockCleanupE2EData.mockRejectedValueOnce(new Error('DynamoDB error'));

    await expect(globalTeardown()).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('Cleanup failed'),
      expect.any(Error)
    );
  });
});
