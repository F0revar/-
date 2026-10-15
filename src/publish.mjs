import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './state.mjs';
import { stateLabels } from './events.mjs';
export const escapeXml = value => String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
export function normalizeBase(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('BASE_URL 必须是 HTTP(S) 网站根地址');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url.href;
}
function channel(title, description, items, snapshot, base) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeXml(title)}</title><link>${escapeXml(base)}</link><description>${escapeXml(description)}</description><language>zh-CN</language><lastBuildDate>${new Date(snapshot.generatedAt).toUTCString()}</lastBuildDate>${items.join('')}\n</channel></rss>\n`;
}
export function renderFeeds(snapshot, baseUrl) {
  const base = normalizeBase(baseUrl);
  const items = snapshot.events.filter(e => ['reset', 'bank_credit', 'limit_change'].includes(e.type)).slice(0, 60).map(event => `<item><guid isPermaLink="false">${escapeXml(event.id)}</guid><title>${escapeXml(`${stateLabels[event.state]} · ${event.headline}`)}</title><link>${escapeXml(event.sourceUrl)}</link><pubDate>${new Date(event.firstPublishedAt).toUTCString()}</pubDate><description>${escapeXml(event.summary + '\n' + event.text + '\n免费来源可能漏帖；状态更新以同一 GUID 修订，不承诺阅读器二次提醒。')}</description><category>${event.state}</category></item>`);
  const daily = snapshot.digests.map(digest => `<item><guid isPermaLink="false">quota-weather:daily:${digest.day}</guid><title>${digest.day} · 额度气象简报</title><link>${escapeXml(new URL(`#digest-${digest.day}`, base).href)}</link><pubDate>${new Date(Math.min(Date.parse(`${digest.day}T09:00:00+08:00`), Date.parse(snapshot.generatedAt))).toUTCString()}</pubDate><description>${escapeXml(digest.note + '\n' + digest.entries.map(e => `${stateLabels[e.state]}｜${e.headline}\n${e.summary}\n${e.sourceUrl}`).join('\n\n') + '\n覆盖说明：' + snapshot.source.coverageNote)}</description></item>`);
  return { events: channel('额度气象站 · 额度事件', '公开公告与预告，按事件去重；不代表个人账户余额。', items, snapshot, base), daily: channel('额度气象站 · 每日简报', '中文规则简报，复杂消息请阅读原帖；免费来源可能漏帖。', daily, snapshot, base) };
}
export async function publish(snapshot, directory, baseUrl) {
  const dataDir = join(directory, 'data'); await mkdir(dataDir, { recursive: true });
  const feeds = renderFeeds(snapshot, baseUrl);
  const json = JSON.stringify(snapshot, null, 2);
  await atomicWrite(join(dataDir, 'status.json'), json + '\n');
  await atomicWrite(join(dataDir, 'snapshot.js'), 'window.QUOTA_WEATHER_DATA = ' + json.replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029') + ';\n');
  await atomicWrite(join(directory, 'feed.xml'), feeds.events);
  await atomicWrite(join(directory, 'daily.xml'), feeds.daily);
}
