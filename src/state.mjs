import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildEvents } from './events.mjs';

export const dayInShanghai = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
export function emptyState() { return { schemaVersion: 1, posts: [], cursor: null, lastAttemptAt: null, lastSuccessAt: null, status: 'empty', error: null, collection: null }; }
export async function readState(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state.schemaVersion !== 1 || !Array.isArray(state.posts)) throw new Error('状态文件版本不受支持');
    return state;
  } catch (error) { if (error.code === 'ENOENT') return emptyState(); throw error; }
}
export async function atomicWrite(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, data, 'utf8');
  await rename(temp, path);
}
export const saveState = (path, state) => atomicWrite(path, JSON.stringify(state, null, 2) + '\n');

export function mergeBatch(previous, result, settings, now = new Date()) {
  const timestamp = now.toISOString(), map = new Map(previous.posts.map(p => [p.id, p]));
  let cursor = previous.cursor;
  for (const post of result.posts) {
    if (post.authorId !== settings.expectedUserId || post.handle.toLowerCase() !== settings.handle.toLowerCase() || !/^\d+$/.test(post.id) || !Number.isFinite(Date.parse(post.createdAt))) throw new Error('拒绝合并未经校验的目标作者数据');
    const old = map.get(post.id);
    const fingerprint = createHash('sha256').update(JSON.stringify([post.text, post.quote, post.replyToId])).digest('hex');
    map.set(post.id, { ...post, fingerprint, firstSeenAt: old?.firstSeenAt || timestamp, lastSeenAt: timestamp, editedAt: old && old.fingerprint !== fingerprint ? timestamp : old?.editedAt || null });
    if (result.complete && (!cursor || BigInt(post.id) > BigInt(cursor))) cursor = post.id;
  }
  const cutoff = now.getTime() - settings.retentionDays * 86_400_000;
  const posts = [...map.values()].filter(p => Date.parse(p.createdAt) >= cutoff).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, settings.maxPosts);
  return { ...previous, schemaVersion: 1, posts, cursor, lastAttemptAt: timestamp, lastSuccessAt: timestamp, status: result.complete ? 'ok' : 'partial', error: result.complete ? null : '达到本轮分页上限，补查可能不完整；检查点未推进。', collection: { pages: result.pages, requests: result.requests, fetched: result.posts.length } };
}
export function failedState(previous, error, now = new Date()) {
  return { ...previous, lastAttemptAt: now.toISOString(), status: 'error', error: String(error.message || '采集失败').slice(0, 220) };
}

export function publicSnapshot(state, settings, costs, now = new Date()) {
  const events = buildEvents(state.posts);
  const today = dayInShanghai(now);
  const stale = !state.lastSuccessAt || now.getTime() - Date.parse(state.lastSuccessAt) > 3 * settings.pollIntervalHours * 3_600_000;
  const todayEvents = events.filter(e => dayInShanghai(e.updatedAt) === today);
  const confirmed = todayEvents.filter(e => e.state === 'completed');
  const scheduled = todayEvents.filter(e => e.state === 'scheduled');
  const delayed = stale || ['error', 'empty'].includes(state.status);
  const weather = delayed ? { kind: 'delayed', title: '信号暂时有雾', subtitle: '来源尚未更新成功，保留已有记录。' }
    : confirmed.length ? { kind: 'sunny', title: '有额度好消息', subtitle: '发现了明确完成声明，适用范围以原帖为准。' }
    : scheduled.length ? { kind: 'cloudy', title: '有预告，等落地', subtitle: '预计时间不是完成证明，继续等待确认。' }
    : { kind: 'quiet', title: '公告气象平稳', subtitle: '本轮已检查，暂未发现明确完成的新额度公告。' };
  const days = [...new Set([today, ...events.map(e => dayInShanghai(e.updatedAt))])].sort().reverse().slice(0, 30);
  const digests = days.map(day => {
    const entries = events.filter(e => dayInShanghai(e.updatedAt) === day).sort((a, b) => ({ completed: 0, scheduled: 1, announced: 2, uncertain: 3, retracted: 4 })[a.state] - ({ completed: 0, scheduled: 1, announced: 2, uncertain: 3, retracted: 4 })[b.state]).slice(0, 5);
    return { day, entries, note: entries.length ? `精选 ${entries.length} 条有来源的动态。` : delayed && day === today ? '来源尚未更新成功，不能据此判断今天没有消息。' : '本轮未发现匹配的新动态；免费来源仍可能漏帖。' };
  });
  return {
    schemaVersion: 1, generatedAt: now.toISOString(), timezone: settings.timezone, handle: settings.handle,
    weather, costs, events, digests, posts: state.posts,
    source: { provider: 'FxEmbed', status: state.status, coverage: 'best_effort', coverageNote: '免费时间线可能漏帖；已读完分页也不等于全量覆盖。支持原帖补录。', lastAttemptAt: state.lastAttemptAt, lastSuccessAt: state.lastSuccessAt, newestPostAt: state.posts[0]?.createdAt || null, error: state.error, collection: state.collection, stale, pollIntervalHours: settings.pollIntervalHours },
  };
}
