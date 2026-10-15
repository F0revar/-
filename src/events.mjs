export const labels = {
  reset: '额度重置', bank_credit: '重置次数', limit_change: '限额与规则', feature: '功能更新', incident: '故障与修复',
};
export const stateLabels = { completed: '已宣布完成', scheduled: '预告 · 待确认', announced: '更新动态', uncertain: '尚待核实', retracted: '否定 / 撤回' };
const reset = /\breset(?:s|ting)?\b|重置/i;
const quota = /\b(?:usage|quota|limits?|allowance|credits?|banked)\b|额度|配额/i;
const completed = /\b(?:have|has|just|already)\s+(?:been\s+)?reset\b|\b(?:i|we)\s+(?:have\s+)?reset\b|\blimits?\s+(?:are|were|is|was)\s+(?:now\s+)?reset\b|\b(?:refilled|replenished|restored|propagated|applied|completed)\b|已重置|已恢复/i;
const future = /\b(?:will|going to|planning to|scheduled|expected|landing|lands|arriving)\b|\b(?:in|within)\s+(?:the\s+next\s+)?(?:\d+|one|two|an?)\s+hours?\b|即将|计划|预计/i;
const negated = /\b(?:no|not|never|won't|haven't|hasn't|didn't|cannot|can't)\s+(?:\w+\s+){0,3}reset\b|\breset\b.{0,24}\b(?:cancelled|canceled|not happening)\b|不会重置|取消重置/i;
const uncertain = /\b(?:maybe|might|hope|wish|could|should|trying)\b|[?？]|可能|希望/i;
const shortDone = /^(?:@\w+\s+)*(?:done(?: and dusted)?|it(?:'s| is) done|all set|it has landed|landed|fully propagated)[.!\s]*$/i;
const products = text => [
  /\bcodex\b/i.test(text) ? 'Codex' : null,
  /\bchatgpt\s+work\b/i.test(text) ? 'ChatGPT Work' : /\bchatgpt\b/i.test(text) ? 'ChatGPT' : null,
].filter(Boolean);

export function parseTiming(text, createdAt) {
  const relative = text.match(/\b(in|within)\s+(?:the\s+next\s+)?(\d+(?:\.\d+)?|one|two|three|an?|the next)\s+(hours?|minutes?)\b/i);
  if (!relative || !Number.isFinite(Date.parse(createdAt))) return null;
  const amount = ({ one: 1, two: 2, three: 3, a: 1, an: 1, 'the next': 1 })[relative[2].toLowerCase()] ?? Number(relative[2]);
  if (!Number.isFinite(amount)) return null;
  const end = new Date(Date.parse(createdAt) + amount * (relative[3].toLowerCase().startsWith('hour') ? 3_600_000 : 60_000)).toISOString();
  return { start: relative[1].toLowerCase() === 'within' ? createdAt : end, end: relative[1].toLowerCase() === 'within' ? end : null, evidence: relative[0] };
}

function addQuotes(post, map, depth = 0) {
  if (depth > 3 || !post?.quote) return;
  if (!map.has(post.quote.id)) map.set(post.quote.id, post.quote);
  addQuotes(post.quote, map, depth + 1);
}
function related(post, map) {
  const result = [], visited = new Set([post.id]);
  let next = post;
  for (let depth = 0; depth < 4; depth++) {
    // Embedded quotes can omit reply metadata. Prefer the authored timeline record.
    const parent = next.quote ? map.get(next.quote.id) || next.quote : map.get(next.replyToId);
    if (!parent || visited.has(parent.id) || parent.authorId !== post.authorId || !parent.verified) break;
    visited.add(parent.id); result.push(parent); next = parent;
  }
  return result;
}

export function buildEvents(posts) {
  const map = new Map(posts.map(p => [p.id, p]));
  posts.forEach(p => addQuotes(p, map));
  const groups = new Map();
  for (const post of [...posts].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
    const own = post.text, context = related(post, map);
    const contextText = context.map(p => p.text).join('\n');
    const hasOwnReset = reset.test(own), hasRelatedReset = context.some(p => reset.test(p.text));
    const linkedContinuation = hasRelatedReset && (shortDone.test(own.trim()) || future.test(own));
    let type = null, state = 'uncertain';
    if (/\bbanked reset\b|\breset (?:credits?|bank)\b/i.test(own) && /\b(?:add|added|grant|granted|save|available|expire)\b/i.test(own)) type = 'bank_credit';
    else if (hasOwnReset || linkedContinuation || (quota.test(own) && completed.test(own))) type = 'reset';
    else if (quota.test(own) && /\b(?:increase|higher|lower|double|change|weekly|window|2x|more)\b/i.test(own)) type = 'limit_change';
    else if (products(own).length && /\b(?:incident|outage|fix|fixed|error|issue|recovery|reliability|mitigated)\b/i.test(own)) type = 'incident';
    else if (products(own).length && /\b(?:launch(?:ed)?|releas(?:e|ed)|rolling|available|introducing|new|shipped|support(?:s|ed)?|increased)\b/i.test(own)) type = 'feature';
    if (!type) continue;
    // Device/password resets must not become quota news.
    if (type === 'reset' && /\b(?:password|router|computer|factory reset)\b/i.test(own) && !quota.test(own) && !products(own).length) continue;
    const assertionText = ['reset', 'bank_credit'].includes(type) && !linkedContinuation
      ? own.split(/(?<=[.!?])\s+|\n/).filter(clause => reset.test(clause) || quota.test(clause)).join('\n') || own : own;
    if (negated.test(assertionText)) state = 'retracted';
    else if (!post.verified || uncertain.test(assertionText)) state = 'uncertain';
    else if (['feature', 'incident', 'limit_change'].includes(type) && /\b(?:have|has)\s+(?:increased|released|introduced|shipped|fixed)\b|\bnow\s+(?:available|supports)\b/i.test(assertionText)) state = 'announced';
    else if (future.test(assertionText)) state = 'scheduled';
    else if (type === 'feature' || type === 'incident' || type === 'limit_change') state = 'announced';
    else if (completed.test(assertionText) || (linkedContinuation && shortDone.test(own.trim())) || (type === 'bank_credit' && /\b(?:added|granted)\b/i.test(own))) state = 'completed';
    const textWithEvidence = own + (linkedContinuation ? '\n' + contextText : '');
    const matchedProducts = products(textWithEvidence);
    const scope = /\ball paid\b/i.test(textWithEvidence) ? '原帖提及全部付费用户' : /\b(?:plus|pro|business|enterprise)\b/i.test(textWithEvidence) ? [...new Set(textWithEvidence.match(/\b(?:plus|pro|business|enterprise)\b/gi))].join(' / ') : '原帖未说明适用套餐';
    const ancestors = context.filter(p => reset.test(p.text));
    const root = type === 'reset' && ancestors.length ? ancestors.at(-1).id : post.id;
    const key = `${type}:${root}`;
    const event = groups.get(key) || { id: key, type, firstPublishedAt: post.createdAt, evidence: [] };
    if (event.state === 'completed' && ['uncertain', 'scheduled'].includes(state)) {
      // Later speculation is evidence, not a revocation of an explicit completion.
      for (const p of context.concat(post)) if (!event.evidence.some(e => e.id === p.id)) event.evidence.push({ id: p.id, text: p.text, url: p.url, createdAt: p.createdAt });
      continue;
    }
    Object.assign(event, {
      state, products: matchedProducts, scope, updatedAt: post.createdAt,
      sourceId: post.id, sourceUrl: post.url, text: own, timing: parseTiming(own, post.createdAt),
      title: labels[type], headline: `${matchedProducts.join(' / ') || '适用产品待核实'} · ${labels[type]}`,
      summary: `${stateLabels[state]}；${scope}。${state === 'completed' ? '这是公开声明，个人账户是否到账需另行查看。' : state === 'scheduled' ? '到达预计时间后仍需等待明确确认。' : '请结合原帖与上下文阅读。'}`,
    });
    for (const p of [...context].reverse().concat(post)) if (!event.evidence.some(e => e.id === p.id)) event.evidence.push({ id: p.id, text: p.text, url: p.url, createdAt: p.createdAt });
    groups.set(key, event);
  }
  return [...groups.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
