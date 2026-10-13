// B站视频过滤器 - 内容脚本主逻辑：过滤引擎 + 页面内交互（悬停屏蔽 / 撤销 / 预览）

(function () {
  'use strict';

  const C = self.BFCore;
  const S = self.BFStore;
  const X = self.BFExtract;

  let settings = C.defaultSettings();
  let scope = C.scopeOf(location.href);
  let lastUrl = location.href;
  let preview = false;

  const cardInfo = new WeakMap();      // 卡片元素 -> { video, result, container }
  const counted = new Set();           // 本次页面已计入统计的视频，避免重复累计
  let pendingStats = { total: 0, hits: {} };
  let statsTimer = null;

  function isActive() {
    return settings.enabled && settings.scopes[scope] !== false;
  }

  // ---------- 过滤 ----------

  function processCards(force) {
    const cards = document.querySelectorAll(X.ALL_SELECTOR);
    const active = isActive();

    for (let i = 0; i < cards.length; i++) {
      const el = cards[i];
      const adapter = X.adapterFor(el);
      if (!adapter || (adapter.skip && adapter.skip(el))) continue;

      const sig = X.signature(el);
      if (!force && el.dataset.bfSig === sig) continue;

      const video = X.extract(el, adapter);
      if (!video) continue;
      el.dataset.bfSig = sig;

      const container = adapter.container(el);
      const result = active ? C.evaluate(video, settings) : null;
      if (result && result.type === 'uploader') fillUploaderName(result.rule, video);
      cardInfo.set(el, { video: video, result: result, container: container });
      apply(container, video, result);
    }
    refreshBadge();
  }

  function apply(container, video, result) {
    if (result) {
      container.classList.add('bf-hidden');
      container.dataset.bfReason = result.label;
      container.dataset.bfType = result.type;
      const id = video.bvid || video.title || result.key;
      if (!counted.has(id)) {
        counted.add(id);
        pendingStats.total++;
        pendingStats.hits[result.key] = (pendingStats.hits[result.key] || 0) + 1;
        scheduleStatsFlush();
      }
    } else if (container.classList.contains('bf-hidden')) {
      container.classList.remove('bf-hidden');
      delete container.dataset.bfReason;
      delete container.dataset.bfType;
    }
  }

  // 只填了 UID 的规则，在页面上遇到该 UP主时补全名称，方便在列表里辨认
  const filling = new Set();
  function fillUploaderName(rule, video) {
    if (rule.name || !rule.mid || !video.upName || filling.has(rule.mid)) return;
    filling.add(rule.mid);
    S.updateSettings(function (s) {
      s.uploaders.forEach(function (u) { if (u.mid === rule.mid && !u.name) u.name = video.upName; });
    }).catch(function () { });
  }

  function scheduleStatsFlush() {
    if (statsTimer) return;
    statsTimer = setTimeout(function () {
      statsTimer = null;
      const delta = pendingStats;
      pendingStats = { total: 0, hits: {} };
      S.addStats(delta).catch(function () { });
    }, 1500);
  }

  function pageState() {
    const hidden = document.querySelectorAll('.bf-hidden');
    const byType = {};
    hidden.forEach(function (el) {
      const t = el.dataset.bfType || 'other';
      byType[t] = (byType[t] || 0) + 1;
    });
    return { supported: true, scope: scope, active: isActive(), hidden: hidden.length, byType: byType, preview: preview };
  }

  // DOM 变化节流处理；同时兼作 SPA 路由变化检测
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(function () {
      scheduled = false;
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        scope = C.scopeOf(lastUrl);
        counted.clear();
        processCards(true);
      } else {
        processCards(false);
      }
    }, 60);
  }

  // ---------- 页面内 UI（Shadow DOM，避免与 B站样式互相影响） ----------

  const ICONS = {
    ban: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    user: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
    video: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z" fill="currentColor"/></svg>',
    tag: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>',
    heart: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    undo: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    shield: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3 5 6v6c0 4.4 3 7.8 7 9 4-1.2 7-4.6 7-9V6z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
  };

  const UI_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
    .qbtn {
      position: fixed; width: 30px; height: 30px; border-radius: 8px; border: 0;
      display: none; align-items: center; justify-content: center; cursor: pointer;
      background: rgba(24,25,28,.72); color: #fff; pointer-events: auto;
      backdrop-filter: blur(6px); transition: background .15s, transform .15s;
    }
    .qbtn.show { display: flex; }
    .qbtn:hover, .qbtn.open { background: #fb7299; transform: scale(1.06); }
    .menu {
      position: fixed; min-width: 220px; max-width: 300px; padding: 6px; border-radius: 12px;
      background: #fff; color: #18191c; pointer-events: auto; display: none;
      box-shadow: 0 12px 32px rgba(0,0,0,.18), 0 0 0 1px rgba(0,0,0,.06);
      animation: pop .14s ease-out; font-size: 13px;
    }
    .menu.show { display: block; }
    @keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
    .head { padding: 6px 10px 8px; color: #9499a0; font-size: 12px; line-height: 1.5; border-bottom: 1px solid #f1f2f3; margin-bottom: 4px; }
    .head b { color: #18191c; font-weight: 600; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item {
      width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 0; border-radius: 8px;
      background: none; color: inherit; font-size: 13px; text-align: left; cursor: pointer;
    }
    .item:hover { background: #f6f7f8; }
    .item svg { flex: none; color: #61666d; }
    .item.danger:hover { background: #fff1f5; color: #e84b85; }
    .item.danger:hover svg { color: #e84b85; }
    .item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .item em { font-style: normal; color: #fb7299; }
    .kw { padding: 6px 6px 4px; }
    .kw input {
      width: 100%; height: 34px; padding: 0 10px; border-radius: 8px; border: 1px solid #e3e5e7;
      font-size: 13px; outline: none; color: #18191c; background: #fff;
    }
    .kw input:focus { border-color: #fb7299; box-shadow: 0 0 0 3px rgba(251,114,153,.15); }
    .kw p { margin: 6px 2px 0; font-size: 12px; color: #9499a0; }
    .toast {
      position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%) translateY(16px); opacity: 0;
      display: flex; align-items: center; gap: 14px; padding: 10px 10px 10px 16px; border-radius: 12px;
      background: #18191c; color: #fff; font-size: 13px; pointer-events: auto;
      box-shadow: 0 10px 30px rgba(0,0,0,.25); transition: all .2s ease; max-width: 80vw;
    }
    .toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
    .toast button {
      display: flex; align-items: center; gap: 4px; border: 0; border-radius: 8px; padding: 5px 10px; cursor: pointer;
      background: rgba(255,255,255,.12); color: #fff; font-size: 13px;
    }
    .toast button:hover { background: rgba(255,255,255,.22); }
    .badge {
      position: fixed; left: 16px; bottom: 16px; display: none; align-items: center; gap: 6px;
      height: 34px; padding: 0 12px 0 10px; border-radius: 17px; border: 0; cursor: pointer; pointer-events: auto;
      background: rgba(255,255,255,.92); color: #61666d; font-size: 12px; backdrop-filter: blur(8px);
      box-shadow: 0 4px 16px rgba(0,0,0,.12), 0 0 0 1px rgba(0,0,0,.05); transition: all .15s;
    }
    .badge.show { display: flex; }
    .badge b { color: #fb7299; font-weight: 600; }
    .badge svg { color: #fb7299; }
    .badge:hover { color: #18191c; }
    .badge.on { background: #fb7299; color: #fff; }
    .badge.on b, .badge.on svg { color: #fff; }
    @media (prefers-color-scheme: dark) {
      .menu { background: #232527; color: #e3e5e7; box-shadow: 0 12px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(255,255,255,.08); }
      .head { border-color: #2f3134; } .head b { color: #e3e5e7; }
      .item:hover { background: #2f3134; } .item svg { color: #9499a0; }
      .item.danger:hover { background: #3a2530; }
      .kw input { background: #18191c; border-color: #3a3c3f; color: #e3e5e7; }
      .badge { background: rgba(35,37,39,.92); color: #9499a0; }
    }
  `;

  let ui = null;
  let lastStateKey = '';

  function h(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mountUI() {
    const host = document.createElement('div');
    host.id = 'bf-ui-root';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.appendChild(h('style', null, UI_CSS));
    const layer = h('div', 'layer');
    const qbtn = h('button', 'qbtn', ICONS.ban);
    qbtn.title = '屏蔽…';
    const menu = h('div', 'menu');
    const toast = h('div', 'toast');
    const badge = h('button', 'badge');
    layer.append(qbtn, menu, toast, badge);
    shadow.appendChild(layer);
    document.documentElement.appendChild(host);

    ui = { host: host, qbtn: qbtn, menu: menu, toast: toast, badge: badge, card: null, menuCard: null, hideTimer: null, toastTimer: null };

    qbtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (ui.menu.classList.contains('show')) closeMenu();
      else openMenu(ui.card);
    });
    qbtn.addEventListener('mouseenter', function () { clearTimeout(ui.hideTimer); });
    qbtn.addEventListener('mouseleave', scheduleHideButton);
    menu.addEventListener('mouseenter', function () { clearTimeout(ui.hideTimer); });
    badge.addEventListener('click', function () { setPreview(!preview); });

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('mousedown', function (e) {
      if (!ui.menu.classList.contains('show')) return;
      if (e.composedPath().indexOf(host) === -1) closeMenu();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMenu();
    }, true);
    window.addEventListener('scroll', function () {
      if (!ui.menu.classList.contains('show')) hideButton();
    }, { passive: true });
  }

  function onMouseOver(e) {
    if (!settings.ui.quickBlock || !settings.enabled) return;
    if (ui.menu.classList.contains('show')) return;
    const el = e.target.closest && e.target.closest(X.ALL_SELECTOR);
    if (!el || !cardInfo.has(el)) {
      if (ui.card && !(e.target.closest && ui.card.contains(e.target))) scheduleHideButton();
      return;
    }
    clearTimeout(ui.hideTimer);
    if (ui.card === el && ui.qbtn.classList.contains('show')) return;
    ui.card = el;
    positionButton(el);
  }

  function positionButton(el) {
    const cover = el.querySelector('.bili-video-card__image, .bili-live-card__cover, .pic-box, .pic, .cover, img') || el;
    const r = cover.getBoundingClientRect();
    if (r.width < 40 || r.height < 20) { hideButton(); return; }
    ui.qbtn.style.left = (r.left + 8) + 'px';
    ui.qbtn.style.top = (r.top + 8) + 'px';
    ui.qbtn.classList.add('show');
  }

  function scheduleHideButton() {
    clearTimeout(ui.hideTimer);
    ui.hideTimer = setTimeout(function () {
      if (!ui.menu.classList.contains('show')) hideButton();
    }, 220);
  }

  function hideButton() {
    ui.qbtn.classList.remove('show', 'open');
    ui.card = null;
  }

  function closeMenu() {
    ui.menu.classList.remove('show');
    ui.qbtn.classList.remove('open');
    ui.menuCard = null;
    scheduleHideButton();
  }

  function openMenu(el) {
    const info = el && cardInfo.get(el);
    if (!info) return;
    ui.menuCard = el;
    const v = info.video;
    const r = info.result;
    const menu = ui.menu;
    menu.innerHTML = '';

    const up = { mid: v.mid, name: v.upName };
    const upName = v.upName || (v.mid ? 'UID ' + v.mid : '');
    const head = h('div', 'head');
    head.innerHTML = r
      ? '已过滤：' + esc(r.label) + '<b>' + esc(v.title || '(无标题)') + '</b>'
      : (upName ? esc(upName) : '视频') + '<b>' + esc(v.title || '(无标题)') + '</b>';
    menu.appendChild(head);

    if (r) {
      // 预览模式下操作已被过滤的卡片：提供撤销对应规则
      if (r.type === 'uploader') addItem(ICONS.undo, '取消屏蔽此 UP主', function () {
        mutate(function (s) { s.uploaders = s.uploaders.filter(function (u) { return C.uploaderKey(u) !== C.uploaderKey(r.rule); }); }, '已取消屏蔽 UP主');
      });
      if (r.type === 'keyword') addItem(ICONS.undo, '删除关键词 <em>' + esc(r.rule) + '</em>', function () {
        mutate(function (s) { s.keywords = s.keywords.filter(function (k) { return k !== r.rule; }); }, '已删除关键词');
      });
      if (r.type === 'video') addItem(ICONS.undo, '取消屏蔽此视频', function () {
        mutate(function (s) { s.videos = s.videos.filter(function (x) { return x.bvid !== v.bvid; }); }, '已取消屏蔽');
      });
      if (upName && r.type !== 'ads' && r.type !== 'uploader') addItem(ICONS.heart, '总是显示 <em>' + esc(upName) + '</em> 的视频', function () {
        mutate(function (s) { s.whitelist.push(up); }, '已加入白名单');
      });
    } else {
      if (upName) addItem(ICONS.user, '屏蔽 UP主 <em>' + esc(upName) + '</em>', function () {
        mutate(function (s) {
          if (!s.uploaders.some(function (u) { return C.sameUploader(u, up); })) s.uploaders.push({ mid: up.mid || null, name: up.name });
        }, '已屏蔽 UP主「' + upName + '」');
      }, 'danger');
      if (v.bvid) addItem(ICONS.video, '不想看这个视频', function () {
        mutate(function (s) {
          if (!s.videos.some(function (x) { return x.bvid === v.bvid; })) s.videos.push({ bvid: v.bvid, title: v.title });
        }, '已屏蔽该视频');
      }, 'danger');
      if (v.title) addItem(ICONS.tag, '按关键词屏蔽…', function () { showKeywordInput(v); }, null, true);
    }

    // 定位：优先在按钮下方，超出视口时翻转
    menu.classList.add('show');
    ui.qbtn.classList.add('open');
    const b = ui.qbtn.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = Math.min(b.left, window.innerWidth - mw - 8);
    let top = b.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, b.top - mh - 6);
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = top + 'px';
  }

  function addItem(icon, label, onClick, cls, keepOpen) {
    const btn = h('button', 'item' + (cls ? ' ' + cls : ''), icon + '<span>' + label + '</span>');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!keepOpen) closeMenu();
      onClick();
    });
    ui.menu.appendChild(btn);
  }

  function showKeywordInput(v) {
    const wrap = h('div', 'kw');
    const input = h('input');
    input.placeholder = '输入标题中的关键词，回车确认';
    // 若用户在页面上选中了文字，直接带入
    const sel = String(window.getSelection() || '').trim();
    if (sel && sel.length <= 30) input.value = sel;
    const tip = h('p', null, '多个用逗号分隔，支持 /正则/');
    wrap.append(input, tip);
    ui.menu.querySelectorAll('.item').forEach(function (n) { n.remove(); });
    ui.menu.appendChild(wrap);
    input.focus();
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Escape') return closeMenu();
      if (e.key !== 'Enter') return;
      const words = C.splitBatch(input.value);
      const bad = words.filter(function (w) { return !C.isValidKeyword(w); });
      if (!words.length) return;
      if (bad.length) { tip.textContent = '无效的正则：' + bad[0]; tip.style.color = '#e84b85'; return; }
      closeMenu();
      mutate(function (s) {
        words.forEach(function (w) { if (s.keywords.indexOf(w) === -1) s.keywords.push(w); });
      }, '已添加关键词「' + words.join('、') + '」');
    });
  }

  // 修改设置并提供撤销
  async function mutate(fn, message) {
    const before = JSON.parse(JSON.stringify(await S.loadSettings()));
    await S.updateSettings(fn);
    showToast(message, function () { S.saveSettings(before); });
  }

  function showToast(message, onUndo) {
    const t = ui.toast;
    t.innerHTML = '';
    t.appendChild(h('span', null, esc(message)));
    if (onUndo) {
      const b = h('button', null, ICONS.undo + '撤销');
      b.addEventListener('click', function () {
        onUndo();
        t.classList.remove('show');
      });
      t.appendChild(b);
    }
    t.classList.add('show');
    clearTimeout(ui.toastTimer);
    ui.toastTimer = setTimeout(function () { t.classList.remove('show'); }, 5000);
  }

  function refreshBadge() {
    if (!ui) return;
    const st = pageState();
    const show = settings.ui.badge && settings.enabled && (st.hidden > 0 || preview);
    ui.badge.classList.toggle('show', show);
    ui.badge.classList.toggle('on', preview);
    ui.badge.innerHTML = preview
      ? ICONS.eye + '预览中 · <b>' + st.hidden + '</b> 个已过滤 · 点击退出'
      : ICONS.shield + '已过滤 <b>' + st.hidden + '</b>';
    ui.badge.title = preview ? '退出预览' : '查看被过滤的视频';
    const key = JSON.stringify(st);
    if (key !== lastStateKey) {
      lastStateKey = key;
      chrome.runtime.sendMessage({ type: 'BF_PAGE_STATE', state: st }).catch(function () { });
    }
  }

  function setPreview(value) {
    preview = !!value;
    document.documentElement.classList.toggle('bf-preview', preview);
    refreshBadge();
  }

  // ---------- 启动 ----------

  function onSettings(next) {
    settings = next;
    if (!settings.enabled && preview) setPreview(false);
    // 规则变化后卡片可能被隐藏或移动，收起悬停按钮，等下次悬停重新定位
    if (ui) { closeMenu(); hideButton(); }
    processCards(true);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
    if (msg.type === 'BF_GET_PAGE_STATE') reply(pageState());
    if (msg.type === 'BF_SET_PREVIEW') { setPreview(msg.value); reply(pageState()); }
  });

  // document_start 时就开始监听，卡片一插入就处理，尽量避免「先闪现再消失」
  async function init() {
    S.onChange(function (kind, value) { if (kind === 'settings') onSettings(value); });
    settings = await S.loadSettings();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    processCards(true);
  }

  init();
  if (document.body) mountUI();
  else document.addEventListener('DOMContentLoaded', function () { mountUI(); refreshBadge(); });
})();
