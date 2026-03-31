/**
 * Unit tests for global setup
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import globalSetup from './global-setup';
import * as helpers from './helpers';

// Mock the helpers module
vi.mock('./helpers', () => ({
  isCognitoAvailable: vi.fn(),
  formatCognitoUnavailableWarning: vi.fn(() => 'Cognito unavailable warning'),
}));

// Mock the e2e-cleanup module
vi.mock('./helpers/e2e-cleanup', () => ({
  cleanupE2EData: vi.fn(),
}));

import { cleanupE2EData } from './helpers/e2e-cleanup';

// Mock fetch
global.fetch = vi.fn();

describe('globalSetup', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('BASE_URL validation', () => {
    it('should throw error if BASE_URL is not set', async () => {
      delete process.env.BASE_URL;

      await expect(globalSetup()).rejects.toThrow('BASE_URL environment variable is required');
    });

    it('should throw error with helpful message if BASE_URL is not set', async () => {
      delete process.env.BASE_URL;

      await expect(globalSetup()).rejects.toThrow(
        'Please set BASE_URL to your test environment URL'
      );
    });
  });

  describe('Frontend availability check', () => {
    beforeEach(() => {
      process.env.BASE_URL = 'http://localhost:3000';
      vi.mocked(helpers.isCognitoAvailable).mockResolvedValue(true);
    });

    it('should check frontend availability', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await globalSetup();

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3000',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should succeed when frontend returns 200', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await expect(globalSetup()).resolves.toBeUndefined();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Frontend is accessible'));
    });

    it('should throw error when frontend returns non-200 status', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);

      await expect(globalSetup()).rejects.toThrow(
        'Frontend returned status 500: Internal Server Error'
      );
    });

    it('should throw error when frontend is not reachable', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Connection refused'));

      await expect(globalSetup()).rejects.toThrow(
        'Frontend not accessible at http://localhost:3000: Connection refused'
      );
    });

    it('should timeout after 30 seconds', async () => {
      vi.mocked(fetch).mockImplementation(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('AbortError')), 100);
          })
      );

      // Mock AbortError
      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';
      vi.mocked(fetch).mockRejectedValue(abortError);

      await expect(globalSetup()).rejects.toThrow(
        'Frontend availability check timed out after 30 seconds'
      );
    });
  });

  describe('API availability check', () => {
    beforeEach(() => {
      process.env.BASE_URL = 'http://localhost:3000';
      vi.mocked(helpers.isCognitoAvailable).mockResolvedValue(true);
    });

    it('should check API availability when NEXT_PUBLIC_API_URL is set', async () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await globalSetup();

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:3001',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      );
    });

    it('should skip API check when NEXT_PUBLIC_API_URL is not set', async () => {
      delete process.env.NEXT_PUBLIC_API_URL;

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await globalSetup();

      // Should only call fetch once for frontend
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('NEXT_PUBLIC_API_URL not set')
      );
    });

    it('should succeed when API is reachable', async () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);

      await expect(globalSetup()).resolves.toBeUndefined();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('API is accessible'));
    });

    it('should throw error when API is not reachable', async () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        } as Response)
        .mockRejectedValueOnce(new Error('Connection refused'));

      await expect(globalSetup()).rejects.toThrow(
        'API not accessible at http://localhost:3001: Connection refused'
      );
    });

    it('should timeout after 30 seconds for API check', async () => {
      process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001';

      const abortError = new Error('AbortError');
      abortError.name = 'AbortError';

      vi.mocked(fetch)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
        } as Response)
        .mockRejectedValueOnce(abortError);

      await expect(globalSetup()).rejects.toThrow(
        'API availability check timed out after 30 seconds'
      );
    });
  });

  describe('Cognito availability check', () => {
    beforeEach(() => {
      process.env.BASE_URL = 'http://localhost:3000';
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);
    });

    it('should check Cognito availability', async () => {
      vi.mocked(helpers.isCognitoAvailable).mockResolvedValue(true);

      await globalSetup();

      expect(helpers.isCognitoAvailable).toHaveBeenCalled();
    });

    it('should log success when Cognito is available', async () => {
      vi.mocked(helpers.isCognitoAvailable).mockResolvedValue(true);

      await globalSetup();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Cognito service is available')
      );
    });

    it('should log warning when Cognito is unavailable', async () => {
      vi.mocked(helpers.isCognitoAvailable).mockResolvedValue(false);

      await globalSetup();

      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Cognito unavailable warning')
      );
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Some tests may be skipped')
      );
    });

    it('should not fail when Cognito is unavailable', async () => {
      vi.mocked(helpers.isCognitoAvailable).mockResolvedValue(false);

      await expect(globalSetup()).resolves.toBeUndefined();
    });
  });

  describe('Error handling', () => {
    beforeEach(() => {
      process.env.BASE_URL = 'http://localhost:3000';
    });

    it('should log error message on failure', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      await expect(globalSetup()).rejects.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Service availability check failed')
      );
    });

    it('should rethrow error after logging', async () => {
      const error = new Error('Network error');
      vi.mocked(fetch).mockRejectedValue(error);

      await expect(globalSetup()).rejects.toThrow('Network error');
    });

    it('should handle unknown errors', async () => {
      vi.mocked(fetch).mockRejectedValue('Unknown error');

      await expect(globalSetup()).rejects.toBeDefined();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Service availability check failed')
      );
    });
  });

  describe('Success message', () => {
    beforeEach(() => {
      process.env.BASE_URL = 'http://localhost:3000';
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);
      vi.mocked(helpers.isCognitoAvailable).mockResolvedValue(true);
    });

    it('should log success message when all checks pass', async () => {
      await globalSetup();

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Test environment is ready')
      );
    });
  });

  describe('Pre-cleanup of residual E2E data', () => {
    beforeEach(() => {
      process.env.BASE_URL = 'http://localhost:3000';
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
      } as Response);
      vi.mocked(helpers.isCognitoAvailable).mockResolvedValue(true);
    });

    it('should log "残留E2Eデータなし" when gamesDeleted is 0', async () => {
      process.env.DYNAMODB_TABLE_NAME = 'test-table';
      vi.mocked(cleanupE2EData).mockResolvedValue({
        gamesDeleted: 0,
        candidatesDeleted: 0,
        errors: [],
      });

      await globalSetup();

      expect(cleanupE2EData).toHaveBeenCalledWith('test-table');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('残留E2Eデータなし'));
    });

    it('should log deletion counts when gamesDeleted > 0', async () => {
      process.env.DYNAMODB_TABLE_NAME = 'test-table';
      vi.mocked(cleanupE2EData).mockResolvedValue({
        gamesDeleted: 2,
        candidatesDeleted: 5,
        errors: [],
      });

      await globalSetup();

      expect(cleanupE2EData).toHaveBeenCalledWith('test-table');
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('deleted 2 games, 5 candidates')
      );
    });

    it('should not throw when cleanupE2EData throws an error', async () => {
      process.env.DYNAMODB_TABLE_NAME = 'test-table';
      vi.mocked(cleanupE2EData).mockRejectedValue(new Error('DynamoDB connection failed'));

      await expect(globalSetup()).resolves.toBeUndefined();

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Pre-cleanup failed'));
    });

    it('should skip cleanup when DYNAMODB_TABLE_NAME is not set', async () => {
      delete process.env.DYNAMODB_TABLE_NAME;

      await globalSetup();

      expect(cleanupE2EData).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('DYNAMODB_TABLE_NAME not set, skipping pre-cleanup')
      );
    });
  });
});
