import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { FxSource } from '../src/source.mjs';
import { readState, saveState, mergeBatch, failedState, publicSnapshot } from '../src/state.mjs';
import { publish } from '../src/publish.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const settings = JSON.parse(await readFile(resolve(root, 'config/settings.json'), 'utf8'));
export const costs = JSON.parse(await readFile(resolve(root, 'config/costs.json'), 'utf8'));
export async function runCollection({ importedUrl = null } = {}) {
  const statePath = resolve(root, process.env.STATE_PATH || '.state/state.json');
  let state = await readState(statePath), failed = false;
  const source = new FxSource(settings), started = performance.now();
  try {
    const result = importedUrl ? { posts: [await source.getPost(importedUrl)], complete: false, pages: 0, requests: source.requests, imported: true } : await source.collect({ sinceId: state.cursor });
    if (result.imported) {
      const oldHealth = { status: state.status, error: state.error, lastAttemptAt: state.lastAttemptAt, lastSuccessAt: state.lastSuccessAt, collection: state.collection };
      state = { ...mergeBatch(state, result, settings), ...oldHealth }; // A single imported post is not a successful timeline scan.
    } else state = mergeBatch(state, result, settings);
  } catch (error) { state = failedState(state, error); failed = true; }
  await saveState(statePath, state);
  const snapshot = publicSnapshot(state, settings, costs);
  await publish(snapshot, resolve(root, 'site'), process.env.BASE_URL || settings.baseUrl);
  console.log(JSON.stringify({ status: state.status, imported: Boolean(importedUrl && !failed), posts: state.posts.length, events: snapshot.events.length, pages: state.collection?.pages, requests: source.requests, lastSuccessAt: state.lastSuccessAt, durationSeconds: Math.round((performance.now() - started) / 10) / 100, error: state.error }, null, 2));
  if (failed) process.exitCode = 2;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runCollection({ importedUrl: process.env.POST_URL || null });
