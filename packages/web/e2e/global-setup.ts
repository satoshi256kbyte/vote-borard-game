/**
 * Playwright global setup
 * Runs once before all tests to check service availability
 */

import { isCognitoAvailable, formatCognitoUnavailableWarning } from './helpers';
import { cleanupE2EData } from './helpers/e2e-cleanup';

const TIMEOUT_MS = 30000; // 30 seconds

/**
 * Check if frontend is accessible
 */
async function checkFrontendAvailability(baseURL: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(baseURL, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Frontend returned status ${response.status}: ${response.statusText}`);
    }

    console.log('✅ Frontend is accessible\n');
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(
          `Frontend availability check timed out after ${TIMEOUT_MS / 1000} seconds at ${baseURL}`,
          { cause: error }
        );
      }
      throw new Error(`Frontend not accessible at ${baseURL}: ${error.message}`, { cause: error });
    }
    throw new Error(`Frontend not accessible at ${baseURL}`, { cause: error });
  }
}

/**
 * Check if API is accessible
 */
async function checkAPIAvailability(apiURL: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    // Try to access API health endpoint or root
    const _response = await fetch(apiURL, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Accept any response (even 404) as long as the API is reachable
    console.log('✅ API is accessible\n');
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(
          `API availability check timed out after ${TIMEOUT_MS / 1000} seconds at ${apiURL}`,
          { cause: error }
        );
      }
      throw new Error(`API not accessible at ${apiURL}: ${error.message}`, { cause: error });
    }
    throw new Error(`API not accessible at ${apiURL}`, { cause: error });
  }
}

/**
 * Global setup function
 * Checks if required services are available before running tests
 *
 * Requirements:
 * - 6.1: Test suite shall run against isolated test environment
 * - 6.2: Test runner shall run in headless mode when executed in CI/CD pipeline
 * - 7.2: If Cognito service is unavailable, test runner should skip test with warning
 */
export default async function globalSetup() {
  console.log('\n🔍 Checking service availability...\n');

  // Check BASE_URL environment variable
  const baseURL = process.env.BASE_URL;
  if (!baseURL) {
    throw new Error(
      '❌ BASE_URL environment variable is required for E2E tests.\n' +
        '   Please set BASE_URL to your test environment URL (e.g., http://localhost:3000)'
    );
  }

  console.log(`📍 Base URL: ${baseURL}\n`);

  // Check required AWS environment variables for test data creation
  const requiredEnvVars = [
    'DYNAMODB_TABLE_NAME',
    'USER_POOL_ID',
    'COGNITO_USER_POOL_ID',
    'COGNITO_CLIENT_ID',
    'AWS_REGION',
  ];

  console.log('=== Environment Variables Check ===');
  const missingEnvVars = requiredEnvVars.filter((varName) => {
    const value = process.env[varName];
    const isSet = !!value;
    console.log(`  ${varName}: ${isSet ? `✓ (${value})` : '✗ NOT SET'}`);
    return !isSet;
  });
  console.log('===================================\n');

  if (missingEnvVars.length > 0) {
    console.warn(
      `⚠️  Warning: The following environment variables are not set:\n` +
        missingEnvVars.map((v) => `   - ${v}`).join('\n') +
        '\n\n   Tests that require these variables will use mock data or be skipped.\n'
    );
  } else {
    console.log('✅ All required AWS environment variables are set\n');
  }

  try {
    // Check frontend availability (fail-fast)
    await checkFrontendAvailability(baseURL);

    // Check API availability if NEXT_PUBLIC_API_URL is set
    const apiURL = process.env.NEXT_PUBLIC_API_URL;
    if (apiURL) {
      console.log(`📍 API URL: ${apiURL}\n`);
      await checkAPIAvailability(apiURL);
    } else {
      console.log('⚠️  NEXT_PUBLIC_API_URL not set, skipping API check\n');
    }

    // Check Cognito availability (non-blocking)
    const cognitoAvailable = await isCognitoAvailable();

    if (!cognitoAvailable) {
      console.warn(formatCognitoUnavailableWarning());
      console.warn('\n⚠️  Some tests may be skipped due to Cognito unavailability\n');
    } else {
      console.log('✅ Cognito service is available\n');
    }

    // Pre-cleanup: remove residual E2E test data from previous runs
    // Requirements 1.1-1.4: cleanupE2EData after service availability check
    const tableName = process.env.DYNAMODB_TABLE_NAME;
    if (!tableName) {
      console.log('⚠️  DYNAMODB_TABLE_NAME not set, skipping pre-cleanup\n');
    } else {
      try {
        const result = await cleanupE2EData(tableName);
        if (result.gamesDeleted === 0) {
          console.log('✅ 残留E2Eデータなし\n');
        } else {
          console.log(
            `🧹 Pre-cleanup: deleted ${result.gamesDeleted} games, ${result.candidatesDeleted} candidates\n`
          );
        }
        if (result.errors.length > 0) {
          console.warn(
            `⚠️  Pre-cleanup completed with ${result.errors.length} error(s):\n` +
              result.errors.map((e) => `   - ${e}`).join('\n') +
              '\n'
          );
        }
      } catch (error) {
        console.error(
          `⚠️  Pre-cleanup failed: ${error instanceof Error ? error.message : error}\n`
        );
        // Continue test execution even if pre-cleanup fails (Requirement 1.4)
      }
    }

    console.log('✓ Test environment is ready\n');
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n❌ Service availability check failed:\n   ${error.message}\n`);
    } else {
      console.error('\n❌ Service availability check failed with unknown error\n');
    }
    throw error;
  }
}
