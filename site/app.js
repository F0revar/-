(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const stateNames = { completed: '已宣布完成', scheduled: '预告 · 待确认', announced: '更新动态', uncertain: '尚待核实', retracted: '否定 / 撤回' };
  const typeNames = { reset: '额度重置', bank_credit: '重置次数', limit_change: '限额与规则', feature: '功能更新', incident: '故障与修复' };
  const key = 'quota-weather:manual:v1';
  let snapshot = window.QUOTA_WEATHER_DATA || null, filter = 'all', search = '', notes = [], toastTimer;
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(value)) notes = value.filter(validNote).slice(0, 100); } catch { /* Storage can be unavailable; keep the page usable. */ }
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value; if (className) el.className = className; return el; };
  const time = (value, full = false) => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', ...(full ? { year: 'numeric', month: '2-digit', day: '2-digit' } : { month: '2-digit', day: '2-digit' }), hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '尚无记录';
  function safeUrl(value) { try { const u = new URL(value); return u.protocol === 'https:' && ['x.com', 'twitter.com'].includes(u.hostname) && /^\/thsottiaux\/status\/\d+\/?$/i.test(u.pathname) && !u.port && !u.username && !u.password ? u : null; } catch { return null; } }
  function validNote(note) { return note && typeof note.text === 'string' && note.text.length <= 10000 && safeUrl(note.sourceUrl) && Number.isFinite(Date.parse(note.updatedAt)); }
  function link(value, title) { const a = text('a', title); a.href = safeUrl(value)?.href || 'https://x.com/thsottiaux'; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
  function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4200); }
  const badge = state => text('span', stateNames[state] || stateNames.uncertain, `badge ${state}`);
  function events() { return [...(snapshot?.events || []), ...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  function showEvidence(event) {
    const list = $('#evidence-list'); list.replaceChildren();
    (event.evidence || [{ text: event.text, url: event.sourceUrl, createdAt: event.updatedAt }]).forEach(item => {
      const row = text('div', '', 'evidence-item'); row.append(text('div', time(item.createdAt, true), 'small'), text('p', item.text), link(item.url, '阅读这条原帖 ↗')); list.append(row);
    });
    $('#evidence-dialog').showModal();
  }
  function renderBriefing() {
    const list = $('#briefing-list'); list.replaceChildren();
    const requestedDay = location.hash.match(/^#digest-(\d{4}-\d\d-\d\d)$/)?.[1];
    const digest = snapshot?.digests?.find(d => d.day === requestedDay) || snapshot?.digests?.[0]; const entries = digest?.entries || [];
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const heading = $('#briefing h2'); heading.firstChild.textContent = digest && digest.day !== today ? `${digest.day} 简报 ` : '今日中文简报 ';
    list.classList.toggle('single', entries.length === 1);
    $('#digest-count').textContent = entries.length;
    if (digest) list.id = 'briefing-list';
    if (!entries.length) { const empty = text('div', digest?.note || '尚无来源数据。请先运行采集；这里不会显示示例消息。', 'empty-state'); if (digest) empty.id = `digest-${digest.day}`; list.append(empty); return; }
    entries.forEach((event, index) => {
      const card = text('article', '', `brief-card${index === 0 ? ' featured' : ''}`);
      if (index === 0 && digest) card.id = `digest-${digest.day}`;
      card.append(badge(event.state), text('h3', event.headline), text('p', event.summary));
      const foot = text('div', '', 'brief-foot'); foot.append(text('span', time(event.updatedAt)), link(event.sourceUrl, '阅读原帖 ↗')); card.append(foot); list.append(card);
    });
  }
  function renderArchive() {
    const list = $('#archive-list'); list.replaceChildren();
    const values = events().filter(event => {
      const matched = filter === 'all' || filter === 'reset' && ['reset', 'bank_credit', 'limit_change'].includes(event.type) || filter === 'scheduled' && event.state === 'scheduled' || filter === 'feature' && ['feature', 'incident'].includes(event.type) || filter === 'manual' && event.local;
      return matched && `${event.headline} ${event.text} ${event.summary || ''}`.toLowerCase().includes(search.toLowerCase());
    });
    if (!values.length) { list.append(text('div', filter === 'manual' ? '这里还没有本地补录。可以粘贴原帖链接，保存一条待核实记录。' : '当前筛选没有匹配记录。可以调整关键词或查看其他分类。', 'empty-state')); return; }
    values.forEach(event => {
      const row = text('article', '', 'event-row');
      const date = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' }).format(new Date(event.updatedAt));
      const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(event.updatedAt));
      const when = text('div', date, 'event-date'); when.append(text('small', `${clock} UTC+8`));
      const main = text('div', '', 'event-main'), heading = text('h3', event.headline); heading.append(badge(event.state));
      main.append(heading, text('p', event.text.length > 230 ? event.text.slice(0, 230) + '…' : event.text, 'original-excerpt'), text('div', event.local ? '本浏览器补录 · 待核验 · 未进入公共 RSS' : `${typeNames[event.type] || '消息'} · ${event.scope} · ${event.evidence?.length || 1} 条证据`, 'event-context'));
      const actions = text('div', '', 'event-actions'), evidenceButton = text('button', '看证据', 'text-button'); evidenceButton.addEventListener('click', () => showEvidence(event));
      actions.append(evidenceButton, link(event.sourceUrl, '原帖 ↗'));
      if (event.local) { const remove = text('button', '删除', 'text-button'); remove.addEventListener('click', () => { const next = notes.filter(n => n.id !== event.id); try { localStorage.setItem(key, JSON.stringify(next)); notes = next; renderArchive(); toast('已删除本浏览器中的记录'); } catch { toast('浏览器不允许写入本地存储，未删除'); } }); actions.append(remove); }
      row.append(when, main, actions); list.append(row);
    });
  }
  function renderCosts() {
    const costs = snapshot?.costs; if (!costs) return;
    const list = $('#cost-items'); list.replaceChildren();
    costs.items.forEach(item => { const row = text('div', '', 'cost-row'), description = text('div', ''); description.append(text('strong', item.name), text('small', `${item.service} · ${item.note}`)); row.append(description, text('b', `¥${item.monthly} / 月`)); list.append(row); });
    $('#cost-verification').textContent = `核价日期 ${costs.verifiedAt} · 实际账单需在部署账户另行核对`;
    $('#cost-assumptions').replaceChildren(...costs.assumptions.map(s => text('li', s)));
    const optional = $('#optional-costs'); optional.replaceChildren();
    costs.optional.forEach(item => { const p = text('p', `${item.name}（未启用）：${item.example} `); if (item.source) { const a = text('a', '价格来源 ↗'); a.href = item.source; a.target = '_blank'; a.rel = 'noopener noreferrer'; p.append(a); } optional.append(p); });
  }
  function render() {
    $('#date-label').textContent = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date()) + ' · UTC+8';
    if (snapshot) {
      const source = snapshot.source, aged = source.lastSuccessAt && Date.now() - Date.parse(source.lastSuccessAt) > 3 * source.pollIntervalHours * 3600000;
      const weather = aged ? { kind: 'delayed', title: '信号暂时有雾', subtitle: '快照已超过预期间隔，历史记录仍可阅读。' } : snapshot.weather;
      $('#weather-card').className = `weather-card ${weather.kind}`; $('#weather-title').textContent = weather.title; $('#weather-subtitle').textContent = weather.subtitle;
      $('#weather-kicker').textContent = `${weather.kind === 'sunny' ? '有来源的好消息' : weather.kind === 'cloudy' ? '关注进展，等待确认' : weather.kind === 'delayed' ? '数据新鲜度提醒' : '每一条，都可以溯源'} / BEIJING TIME`;
      $('#last-success').textContent = time(source.lastSuccessAt, true);
      $('#source-state').textContent = aged ? '快照较旧' : ({ ok: '检查成功', partial: '补查不完整', error: '来源异常', empty: '尚未采集' })[source.status];
      $('#source-dot').className = `status-dot${aged || source.status !== 'ok' ? ' error' : ''}`;
      $('#post-count').replaceChildren(document.createTextNode(snapshot.posts.length), text('small', ' 条已存档帖子'));
      $('#source-message').textContent = source.error || 'FxEmbed · 免费来源 · 尽力覆盖';
      $('#newest-post').textContent = '最新原帖 ' + time(source.newestPostAt);
    }
    renderBriefing(); renderArchive(); renderCosts();
  }
  document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => { b.classList.toggle('active', b === button); b.setAttribute('aria-pressed', String(b === button)); }); renderArchive(); }));
  $('#search').addEventListener('input', event => { search = event.target.value; renderArchive(); });
  $('#refresh-button').addEventListener('click', async event => {
    if (location.protocol === 'file:') return toast('离线文件无法重新采集。请运行 npm start，或重新运行采集后打开页面。');
    event.target.disabled = true;
    try { const response = await fetch('data/status.json', { cache: 'no-store' }); if (!response.ok) throw new Error(); const next = await response.json(); if (next.schemaVersion !== 1 || !Array.isArray(next.events) || !Array.isArray(next.posts) || !next.source) throw new Error(); snapshot = next; render(); toast('已读取站点最新快照；这不会直接触发上游采集'); }
    catch { toast('快照刷新失败，保留当前记录'); } finally { event.target.disabled = false; }
  });
  $('#rss-button').addEventListener('click', () => {
    const local = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    $('#daily-url').textContent = new URL('daily.xml', location.href).href; $('#events-url').textContent = new URL('feed.xml', location.href).href;
    $('#rss-local-note').textContent = local ? '当前是本地预览地址，其他设备或云端阅读器无法订阅。部署后在这里复制正式地址。' : '订阅地址使用当前站点路径。RSS 是否通知由阅读器决定。';
    $('#rss-dialog').showModal();
  });
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const value = $(button.dataset.copy === 'daily' ? '#daily-url' : '#events-url').textContent;
    try { await navigator.clipboard.writeText(value); toast('已复制订阅链接'); } catch { toast('浏览器不允许自动复制，请选中上方链接复制'); }
  }));
  $('#manual-button').addEventListener('click', () => { $('#manual-error').textContent = ''; $('#manual-dialog').showModal(); });
  $('#manual-form').addEventListener('submit', event => {
    event.preventDefault(); const url = safeUrl($('#manual-url').value.trim()), raw = $('#manual-text').value.trim(), at = $('#manual-time').value;
    if (!url || !raw || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(at)) { $('#manual-error').textContent = '请填写 Tibo 本人的 HTTPS 原帖链接、正文和有效的北京时间。'; return; }
    const published = new Date(at + ':00+08:00');
    if (!Number.isFinite(published.getTime()) || published.getTime() > Date.now() + 300000) { $('#manual-error').textContent = '发布时间无效或在未来，请核对。'; return; }
    const postId = url.pathname.match(/\/status\/(\d+)/)[1];
    if (notes.some(n => n.sourceId === postId) || snapshot?.posts.some(p => p.id === postId)) { $('#manual-error').textContent = '这条原帖已经在档案或本地补录中，无需重复保存。'; return; }
    const note = { id: `manual:${postId}`, sourceId: postId, sourceUrl: `https://x.com/thsottiaux/status/${postId}`, headline: '本地补录 · 适用范围待核实', text: raw, updatedAt: published.toISOString(), type: 'manual', state: 'uncertain', local: true };
    const next = [note, ...notes].slice(0, 100);
    try { localStorage.setItem(key, JSON.stringify(next)); notes = next; } catch { $('#manual-error').textContent = '浏览器拒绝本地存储，记录尚未保存。请检查浏览器隐私设置。'; return; }
    $('#manual-dialog').close(); $('#manual-form').reset(); filter = 'manual'; document.querySelector('[data-filter="manual"]').click(); toast('已保存到当前浏览器；尚未进入公共 RSS'); $('#archive').scrollIntoView({ behavior: 'smooth' });
  });
  $('#export-button').addEventListener('click', () => {
    if (!notes.length) return toast('当前浏览器还没有可导出的补录记录');
    const blob = new Blob([JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), notes }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'quota-weather-local-notes.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('已导出本地记录；它们仍需原帖核验');
  });
  window.addEventListener('hashchange', () => { renderBriefing(); if (location.hash.startsWith('#digest-')) document.getElementById(location.hash.slice(1))?.scrollIntoView(); });
  render();
})();
