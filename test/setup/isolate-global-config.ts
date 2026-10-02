import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setGlobalConfigPathForTests } from '../../src/config/global.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-validator-global-test-'));
setGlobalConfigPathForTests(path.join(dir, 'config.yml'));
