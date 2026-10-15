import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents, parseTiming } from '../src/events.mjs';
import { FxSource, parsePostUrl } from '../src/source.mjs';
import { emptyState, mergeBatch, failedState, publicSnapshot } from '../src/state.mjs';
import { renderFeeds, normalizeBase } from '../src/publish.mjs';

// Explicit synthetic fixtures for automated logic tests; never published as news.
const now = new Date('2026-10-15T09:00:00Z');
const settings = { handle: 'thsottiaux', expectedUserId: '123', overlapHours: 72, maxPages: 2, retentionDays: 90, maxPosts: 3000, pollIntervalHours: 1, timezone: 'Asia/Shanghai' };
const post = (id, text, extra = {}) => ({ id: String(id), authorId: '123', handle: 'thsottiaux', text, createdAt: `2026-10-15T0${Number(id) % 7}:00:00.000Z`, url: `https://x.com/thsottiaux/status/${id}`, verified: true, replyToId: null, quote: null, ...extra });
const response = body => new Response(JSON.stringify(body), { status: 200 });
const profile = { code: 200, user: { id: '123', screen_name: 'thsottiaux' } };
const raw = (id, text, extra = {}) => ({ type: 'status', id: String(id), text, created_at: '2026-10-15T01:00:00Z', author: { id: '123', screen_name: 'thsottiaux' }, ...extra });

test('预告到期也不升级为完成', () => {
  const events = buildEvents([post(1, 'We will reset Codex usage limits in 2 hours')]);
  assert.equal(events[0].state, 'scheduled');
  assert.equal(parseTiming('in 2 hours', '2026-10-15T00:00:00Z').start, '2026-10-15T02:00:00.000Z');
});
test('否定重置和设备重置不误报完成', () => {
  assert.equal(buildEvents([post(1, 'No reset is planned for Codex usage limits')])[0].state, 'retracted');
  assert.equal(buildEvents([post(1, 'I have reset my router')]).length, 0);
});
test('明确的完成声明保持产品和范围，缺失时不填付费套餐', () => {
  const event = buildEvents([post(1, 'We have reset usage limits for all paid Codex users')])[0];
  assert.equal(event.state, 'completed'); assert.deepEqual(event.products, ['Codex']); assert.match(event.scope, /全部付费/);
  const missing = buildEvents([post(2, 'We have reset usage limits')])[0];
  assert.deepEqual(missing.products, []); assert.match(missing.scope, /未说明/);
});
test('后一句功能预告不覆盖本句额度完成声明', () => {
  assert.equal(buildEvents([post(1, 'Codex usage limits have been reset. We will release more features soon.')])[0].state, 'completed');
});
test('后来不确定的回复不会撤销已确认状态', () => {
  const root = post(1, 'We have reset Codex usage limits', { createdAt: '2026-10-15T01:00:00Z' });
  const reply = post(2, 'Maybe another reset soon?', { replyToId: '1', createdAt: '2026-10-15T02:00:00Z' });
  const events = buildEvents([root, reply]); assert.equal(events.length, 1); assert.equal(events[0].state, 'completed');
});
test('已发布功能的后续计划不让当前更新变成预告', () => {
  assert.equal(buildEvents([post(1, 'We have increased the context for Codex. We will go higher later.')])[0].state, 'announced');
});
test('重置次数与直接额度重置分开', () => {
  const event = buildEvents([post(1, 'We added a banked reset for Codex users')])[0];
  assert.equal(event.type, 'bank_credit'); assert.equal(event.state, 'completed');
});
test('短完成帖通过本人回复/引用链关联，使用完整时间线元数据', () => {
  const root = post(1, 'Codex usage reset is coming', { createdAt: '2026-10-15T01:00:00Z' });
  const planned = post(2, 'Landing within the next 2 hours', { replyToId: '1', createdAt: '2026-10-15T02:00:00Z' });
  const done = post(3, 'Done and dusted', { quote: { ...planned, replyToId: null }, createdAt: '2026-10-15T03:00:00Z' });
  const events = buildEvents([root, planned, done]);
  assert.equal(events.length, 1); assert.equal(events[0].state, 'completed'); assert.equal(events[0].sourceId, '3'); assert.equal(events[0].evidence.length, 3);
});
test('不能把其他作者的声明和手工文字当本人完成证据', () => {
  const other = post(1, 'We have reset Codex usage limits', { authorId: '999', handle: 'someone' });
  assert.equal(buildEvents([post(2, 'Done and dusted', { quote: other })]).length, 0);
  assert.equal(buildEvents([post(1, 'We have reset Codex usage limits', { verified: false })])[0].state, 'uncertain');
});
test('API 返回其他作者、纯转发时过滤；已知 ID 仍重读以检测编辑', async () => {
  const bodies = [profile, { code: 200, results: [raw(8, 'We have reset Codex usage limits'), raw(9, 'other', { author: { id: '456', screen_name: 'other' } }), raw(10, 'repost', { reposted_by: {} })], cursor: { bottom: null } }];
  const source = new FxSource(settings, async () => response(bodies.shift()));
  const result = await source.collect({ sinceId: '8', now }); assert.equal(result.posts.length, 1); assert.equal(result.posts[0].id, '8');
});
test('分页失败使整批失败，不返回伪完整结果', async () => {
  let count = 0;
  const source = new FxSource(settings, async () => { count++; return count === 1 ? response(profile) : count === 2 ? response({ code: 200, results: [raw(8, 'reset')], cursor: { bottom: 'next' } }) : new Response('bad', { status: 503 }); });
  await assert.rejects(source.collect({ now }), /503/);
});
test('显式 stale 和重复游标都拒绝成功', async () => {
  await assert.rejects(new FxSource(settings, async () => response({ code: 200, stale: true })).resolveUser(), /过期/);
  let n = 0;
  const source = new FxSource(settings, async () => response(++n === 1 ? profile : { code: 200, results: [raw(8, 'reset')], cursor: { bottom: 'same' } }));
  await assert.rejects(source.collect({ now }), /游标重复/);
});
test('不完整分页可保留可见帖子，但不推进持久游标', () => {
  const before = { ...emptyState(), cursor: '1' };
  const state = mergeBatch(before, { posts: [post(5, 'reset')], complete: false, pages: 2, requests: 3 }, settings, now);
  assert.equal(state.cursor, '1'); assert.equal(state.status, 'partial'); assert.equal(state.posts.length, 1);
});
test('重放不重复、编辑被标记，采集失败保留原状态', () => {
  const original = mergeBatch(emptyState(), { posts: [post(5, 'reset')], complete: true }, settings, now);
  const replay = mergeBatch(original, { posts: [post(5, 'reset')], complete: true }, settings, now); assert.equal(replay.posts.length, 1); assert.equal(replay.posts[0].editedAt, null);
  const changed = mergeBatch(replay, { posts: [post(5, 'Codex usage limits reset')], complete: true }, settings, now); assert.equal(changed.posts[0].editedAt, now.toISOString());
  const failure = failedState(changed, new Error('offline'), now); assert.equal(failure.cursor, changed.cursor); assert.deepEqual(failure.posts, changed.posts); assert.equal(failure.lastSuccessAt, changed.lastSuccessAt);
});
test('仅来源失败时显示雾，不能把失败说成没有消息', () => {
  const view = publicSnapshot(failedState(emptyState(), new Error('offline'), now), settings, { items: [] }, now);
  assert.equal(view.weather.kind, 'delayed'); assert.match(view.digests[0].note, /不能据此判断/);
});
test('原帖 URL 校验拒绝陌生域名、其他账号和凭证', () => {
  assert.equal(parsePostUrl('https://x.com/thsottiaux/status/123?s=20').id, '123');
  for (const url of ['https://evil.example/thsottiaux/status/1', 'https://x.com/other/status/1', 'javascript:alert(1)', 'https://secret@x.com/thsottiaux/status/1']) assert.throws(() => parsePostUrl(url));
});
test('RSS 转义不可信原文、去重 GUID 稳定，支持 Pages 子路径', () => {
  const state = mergeBatch(emptyState(), { posts: [post(5, 'We have reset Codex usage limits <script>&')], complete: true }, settings, now);
  const view = publicSnapshot(state, settings, {}, now), feeds = renderFeeds(view, 'https://example.github.io/quota/');
  assert.match(feeds.events, /&lt;script&gt;&amp;/); assert.doesNotMatch(feeds.events, /<script>/);
  assert.match(feeds.daily, /https:\/\/example.github.io\/quota\/#digest-/);
  assert.equal((feeds.events.match(/<guid /g) || []).length, 1);
  assert.equal(normalizeBase('https://example.github.io/quota'), 'https://example.github.io/quota/');
  assert.throws(() => normalizeBase('https://secret@example.github.io/'));
});
