/**
 * #4369 — a per-source sync must never repoint the registered checkout.
 *
 * The path in sources.local_path is source registration state, not a
 * per-invocation sync argument. A foreign directory must be rejected even
 * when both directories exist, while the same directory through a symlink
 * remains valid.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PGLiteEngine } from '../src/core/pglite-engine.ts';
import { readSyncAnchor, writeSyncAnchor } from '../src/core/sync-anchor.ts';
import { resetPgliteState } from './helpers/reset-pglite.ts';

describe('#4369: registered source anchors are immutable per source', () => {
  let engine: PGLiteEngine;
  let root: string;
  let registered: string;
  let foreign: string;

  beforeAll(async () => {
    engine = new PGLiteEngine();
    await engine.connect({});
    await engine.initSchema();
  }, 60_000);

  afterAll(async () => {
    await engine.disconnect();
  }, 60_000);

  beforeEach(async () => {
    await resetPgliteState(engine);
    root = mkdtempSync(join(tmpdir(), 'gbrain-4369-'));
    registered = join(root, 'registered');
    foreign = join(root, 'foreign');
    mkdirSync(registered);
    mkdirSync(foreign);
    await engine.executeRaw(
      `INSERT INTO sources (id, name, local_path, config)
       VALUES ('source-a', 'source-a', $1, '{}'::jsonb)`,
      [registered],
    );
  });

  test('refuses a foreign existing directory and preserves the registered path', async () => {
    await writeSyncAnchor(engine, 'source-a', 'repo_path', foreign);

    const anchor = await readSyncAnchor(engine, 'source-a', 'repo_path');
    expect(anchor).not.toBeNull();
    expect(realpathSync(anchor!)).toBe(realpathSync(registered));
  });

  test('accepts the registered directory through a symlink while preserving identity', async () => {
    const alias = join(root, 'registered-alias');
    symlinkSync(registered, alias, 'dir');

    await writeSyncAnchor(engine, 'source-a', 'repo_path', alias);

    const anchor = await readSyncAnchor(engine, 'source-a', 'repo_path');
    expect(anchor).not.toBeNull();
    expect(realpathSync(anchor!)).toBe(realpathSync(registered));
    expect(readlinkSync(alias)).toBe(registered);
  });

  test('fails closed when the requested path cannot be realpath-resolved', async () => {
    const missing = join(root, 'does-not-exist');

    await writeSyncAnchor(engine, 'source-a', 'repo_path', missing);

    expect(await readSyncAnchor(engine, 'source-a', 'repo_path')).toBe(registered);
  });

  test('allows a null registration to bootstrap once', async () => {
    await engine.executeRaw(`UPDATE sources SET local_path = NULL WHERE id = 'source-a'`);

    await writeSyncAnchor(engine, 'source-a', 'repo_path', registered);

    expect(await readSyncAnchor(engine, 'source-a', 'repo_path')).toBe(registered);
  });

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });
});
