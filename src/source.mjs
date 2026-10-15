// Adapted in part from AllenXiao95/codex-reset-signal (MIT).
// See THIRD_PARTY_NOTICES.md. Context retention and overlap collection are new.
const API = 'https://api.fxtwitter.com';
const numeric = value => typeof value === 'string' && /^\d+$/.test(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function parsePostUrl(value, handle = 'thsottiaux') {
  let url;
  try { url = new URL(value); } catch { throw new Error('请输入完整的 X 原帖链接'); }
  if (url.protocol !== 'https:' || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) || url.username || url.password || url.port)
    throw new Error('仅支持 HTTPS 的 x.com 或 twitter.com 原帖链接');
  const match = url.pathname.match(/^\/([A-Za-z0-9_]+)\/status\/(\d+)\/?$/);
  if (!match || match[1].toLowerCase() !== handle.toLowerCase()) throw new Error(`仅支持 @${handle} 本人的原帖`);
  return { id: match[2], url: `https://x.com/${handle}/status/${match[2]}` };
}

function normalize(raw, depth = 0) {
  if (!object(raw) || !numeric(raw.id) || !object(raw.author) || !numeric(raw.author.id)) throw new Error('上游帖子缺少有效 ID 或作者');
  const text = object(raw.raw_text) && typeof raw.raw_text.text === 'string' ? raw.raw_text.text : raw.text;
  const timestamp = typeof raw.created_timestamp === 'number' ? raw.created_timestamp * 1000 : Date.parse(raw.created_at);
  if (typeof text !== 'string' || text.length > 40_000 || !Number.isFinite(timestamp)) throw new Error('上游正文或发布时间无效');
  const handle = raw.author.screen_name;
  if (typeof handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('上游作者账号无效');
  return {
    id: raw.id, authorId: raw.author.id, handle, text,
    createdAt: new Date(timestamp).toISOString(), url: `https://x.com/${handle}/status/${raw.id}`,
    kind: raw.replying_to ? 'reply' : raw.quote ? 'quote' : 'post',
    replyToId: numeric(raw.replying_to?.status) ? raw.replying_to.status : null,
    quote: depth < 3 && raw.quote?.type !== 'tombstone' && object(raw.quote?.author) ? normalize(raw.quote, depth + 1) : null,
    verified: true, source: 'fxembed',
  };
}

export class FxSource {
  constructor(settings, fetcher = fetch) { this.settings = settings; this.fetcher = fetcher; this.requests = 0; }
  async request(path) {
    const url = new URL(path, API);
    if (url.origin !== API) throw new Error('非法上游地址');
    this.requests++;
    const response = await this.fetcher(url, {
      signal: AbortSignal.timeout(20_000), redirect: 'error',
      headers: { Accept: 'application/json', 'User-Agent': 'QuotaWeatherStation/0.1 (personal hourly reader)' },
    });
    if (response.status !== 200) throw new Error(`免费来源返回 HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error('上游响应超出大小限制');
    const body = JSON.parse(text);
    if (!object(body) || body.code !== 200 || body.stale === true || body.errors != null) throw new Error('上游响应失败、过期或不完整');
    return body;
  }
  async resolveUser() {
    const body = await this.request(`/2/profile/${this.settings.handle}`);
    if (!numeric(body.user?.id) || body.user.screen_name?.toLowerCase() !== this.settings.handle.toLowerCase()) throw new Error('上游账号校验失败');
    if (body.user.id !== this.settings.expectedUserId) throw new Error('目标作者 ID 已变化，需核实配置');
    return body.user.id;
  }
  async collect({ sinceId = null, now = new Date() } = {}) {
    if (sinceId && !numeric(sinceId)) throw new Error('检查点格式无效');
    const userId = await this.resolveUser();
    const cutoff = now.getTime() - this.settings.overlapHours * 3_600_000;
    const posts = new Map(), cursors = new Set();
    let cursor = null;
    for (let page = 0; page < this.settings.maxPages; page++) {
      const query = new URLSearchParams({ count: '100', with_replies: '1' });
      if (cursor) query.set('cursor', cursor);
      const body = await this.request(`/2/profile/id:${userId}/statuses?${query}`);
      if (!Array.isArray(body.results) || !object(body.cursor) || !(body.cursor.bottom == null || typeof body.cursor.bottom === 'string')) throw new Error('上游分页结构异常');
      let newestTime = -Infinity, newestPageId = null;
      for (const raw of body.results) {
        if (raw?.type !== 'status') throw new Error('上游时间线包含无法解析的条目');
        const item = normalize(raw);
        newestTime = Math.max(newestTime, Date.parse(item.createdAt));
        if (!newestPageId || BigInt(item.id) > BigInt(newestPageId)) newestPageId = item.id;
        if (item.authorId !== userId || raw.reposted_by != null) continue;
        posts.set(item.id, item); // Do not skip known IDs: overlap detects edits.
      }
      const next = body.cursor.bottom;
      const oldEnough = newestTime <= cutoff && (!sinceId || (newestPageId && BigInt(newestPageId) <= BigInt(sinceId)));
      if (!next || oldEnough) return { posts: [...posts.values()], complete: true, pages: page + 1, requests: this.requests };
      if (cursors.has(next)) throw new Error('上游分页游标重复；保留原检查点');
      cursors.add(next); cursor = next;
    }
    return { posts: [...posts.values()], complete: false, pages: this.settings.maxPages, requests: this.requests };
  }
  async getPost(url) {
    const parsed = parsePostUrl(url, this.settings.handle);
    const body = await this.request(`/${this.settings.handle}/status/${parsed.id}`);
    const post = normalize(body.tweet);
    if (post.id !== parsed.id || post.authorId !== this.settings.expectedUserId || post.handle.toLowerCase() !== this.settings.handle.toLowerCase()) throw new Error('原帖作者或 ID 校验失败');
    return { ...post, source: 'manual-url' };
  }
}
