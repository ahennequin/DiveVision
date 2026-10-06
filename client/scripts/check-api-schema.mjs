// Fails when src/api/schema.d.ts is not what `npm run api:generate` would
// produce from openapi.json. (openapi.json itself is checked against the
// FastAPI app by divevision/test/test_app.py::test_openapi_snapshot_is_current.)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const committedPath = 'src/api/schema.d.ts';
const dir = mkdtempSync(join(tmpdir(), 'divevision-api-'));
const freshPath = join(dir, 'schema.d.ts');

try {
  execFileSync('npx', ['openapi-typescript', 'openapi.json', '--output', freshPath], {
    stdio: 'ignore',
  });
  if (readFileSync(freshPath, 'utf8') !== readFileSync(committedPath, 'utf8')) {
    console.error(
      `${committedPath} is stale: run \`npm run api:generate\` (or \`npm run api:update\` ` +
        'after changing the FastAPI app) and commit the result.',
    );
    process.exit(1);
  }
  console.log(`${committedPath} matches openapi.json`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
