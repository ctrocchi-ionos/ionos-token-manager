// Import this FIRST in every test file: gives the test its own empty data dir and safe env.
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'tokenmgr-test-'));
process.env.ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.DEV_AUTH_EMAIL;
delete process.env.ALLOW_DEV_AUTH;
