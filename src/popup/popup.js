// B站视频过滤器 - Popup

(function () {
  'use strict';

  const C = self.BFCore;
  const S = self.BFStore;
  const $ = function (sel, root) { return (root || document).querySelector(sel); };
  const $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  let settings = C.defaultSettings();
  let stats = C.defaultStats();
  let kind = 'keywords';
  let tab = null;            // 当前浏览器标签页
  let pageState = null;
  let justAdded = new Set(); // 用于新增条目的高亮动画

  const KINDS = {
    keywords: {
      placeholder: '输入关键词，回车添加',
      hint: '匹配标题、不区分大小写；逗号分隔可批量；支持 <code>/正则/</code>',
      emptyTitle: '还没有屏蔽关键词',
      emptyText: '例如「开箱」「/第\\d+期/」'
    },
    uploaders: {
      placeholder: 'UP主名称 / UID / 空间链接',
      hint: '名称需完全一致；填 UID 或空间链接更精确，UP主改名也不受影响',
      emptyTitle: '还没有屏蔽 UP主',
      emptyText: ''
    },
    videos: {
      placeholder: 'BV 号或视频链接',
      hint: '屏蔽某个具体视频，不影响同一 UP主的其他视频',
      emptyTitle: '还没有屏蔽单个视频',
      emptyText: ''
    }
  };

  const ICON_DEL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  const ICON_BAN = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>';
  const ICON_EMPTY = '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 5h16l-6 8v6l-4-2v-4z"/></svg>';

  // ---------- 工具 ----------

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function persist() {
    return S.saveSettings(settings);
  }

  let toastTimer = null;
  function toast(message, undo) {
    const t = $('#toast');
    t.innerHTML = '<span>' + esc(message) + '</span>';
    if (undo) {
      const b = document.createElement('button');
      b.textContent = '撤销';
      b.addEventListener('click', function () {
        undo();
        t.classList.remove('show');
      });
      t.appendChild(b);
    }
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, undo ? 4500 : 2200);
  }

  // 修改设置，并在提示里提供撤销
  function change(fn, message) {
    const before = clone(settings);
    fn(settings);
    persist();
    renderAll();
    if (message) toast(message, function () {
      settings = before;
      persist();
      renderAll();
    });
  }

  // ---------- 头部与当前页面 ----------

  function renderHeader() {
    $('#enabled').checked = settings.enabled;
    document.body.classList.toggle('off', !settings.enabled);
    $('#statusText').textContent = settings.enabled
      ? '累计已过滤 ' + stats.total.toLocaleString() + ' 个视频'
      : '过滤已暂停';
  }

  const SCOPE_NAMES = { home: '首页', search: '搜索页', video: '视频页', other: '当前页面' };

  function renderPageCard() {
    const card = $('#pageCard');
    const onBili = tab && /^https?:\/\/([a-z0-9-]+\.)*bilibili\.com\//.test(tab.url || '');

    if (!onBili) {
      card.innerHTML = '<div class="page-main"><p class="page-hint">打开 <b>bilibili.com</b> 即可在这里查看本页过滤情况。<br>在视频封面上悬停，点 <span class="kbd">' + ICON_BAN + '</span> 就能一键屏蔽。</p></div>';
      return;
    }
    if (!pageState) {
      card.innerHTML = '<div class="page-main"><p class="page-hint">扩展刚安装或更新，<b>刷新页面</b>后生效。</p></div>' +
        '<button class="btn-preview" id="reloadBtn">刷新</button>';
      $('#reloadBtn').addEventListener('click', function () { chrome.tabs.reload(tab.id); window.close(); });
      return;
    }
    if (!settings.enabled) {
      card.innerHTML = '<div class="page-main"><p class="page-hint">过滤已暂停，打开右上角开关恢复。</p></div>';
      return;
    }
    if (!pageState.active) {
      card.innerHTML = '<div class="page-main"><p class="page-hint">已在设置中关闭对<b>' + SCOPE_NAMES[pageState.scope] + '</b>的过滤。</p></div>';
      return;
    }

    const chips = Object.keys(pageState.byType).map(function (t) {
      return '<span>' + (C.TYPE_LABELS[t] || t) + ' ' + pageState.byType[t] + '</span>';
    }).join('');
    card.innerHTML =
      '<div class="page-main">' +
      '<div class="page-label"><span class="page-num">' + pageState.hidden + '</span>' + SCOPE_NAMES[pageState.scope] + '已过滤</div>' +
      (chips ? '<div class="page-chips">' + chips + '</div>' : '<div class="page-chips"><span>本页暂无命中</span></div>') +
      '</div>' +
      (pageState.hidden > 0 || pageState.preview
        ? '<button class="btn-preview' + (pageState.preview ? ' on' : '') + '" id="previewBtn" title="在页面上显示被过滤的视频及原因">' +
          (pageState.preview ? '退出预览' : '预览') + '</button>'
        : '');

    const btn = $('#previewBtn');
    if (btn) btn.addEventListener('click', function () {
      chrome.tabs.sendMessage(tab.id, { type: 'BF_SET_PREVIEW', value: !pageState.preview }).then(function (st) {
        pageState = st;
        renderPageCard();
      }).catch(function () { });
    });
  }

  async function loadPageState() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0] || null;
    pageState = null;
    if (tab && /bilibili\.com/.test(tab.url || '')) {
      try {
        pageState = await chrome.tabs.sendMessage(tab.id, { type: 'BF_GET_PAGE_STATE' });
      } catch (e) {
        pageState = null;
      }
    }
    renderPageCard();
  }

  // ---------- 标签页 ----------

  function selectTab(name) {
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    $$('.panel').forEach(function (p) { p.classList.toggle('active', p.dataset.panel === name); });
    moveIndicator();
  }

  function moveIndicator() {
    const active = $('.tab.active');
    const ind = $('.tab-indicator');
    const w = 28;
    ind.style.width = w + 'px';
    ind.style.left = (active.offsetLeft + active.offsetWidth / 2 - w / 2) + 'px';
  }

  // ---------- 屏蔽列表 ----------

  function selectKind(next) {
    kind = next;
    $$('.seg-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.kind === kind); });
    const input = $('#blockInput');
    input.placeholder = KINDS[kind].placeholder;
    input.classList.remove('invalid');
    $('#blockSearch').value = '';
    setHint(KINDS[kind].hint);
    renderBlockList();
    input.focus();
  }

  function setHint(html, isError) {
    const h = $('#blockHint');
    h.innerHTML = html;
    h.classList.toggle('error', !!isError);
  }

  function addBlock(raw) {
    const parts = C.splitBatch(raw);
    if (!parts.length) return false;
    const before = clone(settings);
    const added = [];
    let dup = 0;
    const invalid = [];

    parts.forEach(function (p) {
      if (kind === 'keywords') {
        if (!C.isValidKeyword(p)) return invalid.push(p);
        if (settings.keywords.indexOf(p) !== -1) return dup++;
        settings.keywords.push(p);
        added.push('kw:' + p);
      } else if (kind === 'uploaders') {
        const u = C.parseUploaderInput(p);
        if (!u) return invalid.push(p);
        if (settings.uploaders.some(function (x) { return C.uploaderKey(x) === C.uploaderKey(u); })) return dup++;
        settings.uploaders.push(u);
        added.push('up:' + C.uploaderKey(u));
      } else {
        const bvid = C.extractBvid(p);
        if (!bvid) return invalid.push(p);
        if (settings.videos.some(function (v) { return v.bvid === bvid; })) return dup++;
        settings.videos.push({ bvid: bvid, title: '' });
        added.push('video:' + bvid);
      }
    });

    if (invalid.length && !added.length) {
      const msg = kind === 'keywords' ? '正则表达式有误：' : kind === 'videos' ? '没有识别到 BV 号：' : '无法识别：';
      setHint(msg + esc(invalid[0]), true);
      $('#blockInput').classList.add('invalid');
      return false;
    }

    justAdded = new Set(added);
    persist();
    renderAll();
    setHint(KINDS[kind].hint);
    let msg = added.length ? '已添加 ' + added.length + ' 项' : '';
    if (dup) msg += (msg ? '，' : '') + dup + ' 项已存在';
    if (invalid.length) msg += '，' + invalid.length + ' 项无法识别';
    toast(msg, added.length ? function () { settings = before; persist(); renderAll(); } : null);
    return true;
  }

  function hitsOf(key) {
    return stats.hits[key] || 0;
  }

  function blockItems() {
    if (kind === 'keywords') {
      return settings.keywords.map(function (k) {
        const isRe = /^\/.+\/[a-z]*$/.test(k);
        return {
          id: 'kw:' + k,
          avatar: '<span class="avatar kw">' + (isRe ? '.*' : '#') + '</span>',
          title: esc(k) + (isRe ? '<span class="badge-re">正则</span>' : ''),
          sub: '',
          search: k,
          hits: hitsOf('kw:' + k),
          remove: function (s) { s.keywords = s.keywords.filter(function (x) { return x !== k; }); },
          label: k
        };
      });
    }
    if (kind === 'uploaders') return settings.uploaders.map(uploaderItem('uploaders'));
    return settings.videos.map(function (v) {
      return {
        id: 'video:' + v.bvid,
        avatar: '<span class="avatar vd">▶</span>',
        title: esc(v.title || v.bvid),
        sub: '<a href="https://www.bilibili.com/video/' + v.bvid + '" target="_blank">' + v.bvid + '</a>',
        search: (v.title || '') + v.bvid,
        hits: hitsOf('video:' + v.bvid),
        remove: function (s) { s.videos = s.videos.filter(function (x) { return x.bvid !== v.bvid; }); },
        label: v.title || v.bvid
      };
    });
  }

  function uploaderItem(listName) {
    return function (u) {
      const key = C.uploaderKey(u);
      const name = C.uploaderLabel(u);
      return {
        id: 'up:' + key,
        avatar: '<span class="avatar">' + esc(u.name ? u.name.slice(0, 1) : 'U') + '</span>',
        title: esc(name),
        sub: !u.mid ? '按名称精确匹配'
          : u.name ? '<a href="https://space.bilibili.com/' + u.mid + '" target="_blank">UID ' + u.mid + '</a>'
          : '<a href="https://space.bilibili.com/' + u.mid + '" target="_blank">空间主页</a> · 在页面遇到后自动补全名称',
        search: (u.name || '') + (u.mid || ''),
        hits: listName === 'uploaders' ? hitsOf('up:' + key) : null,
        remove: function (s) { s[listName] = s[listName].filter(function (x) { return C.uploaderKey(x) !== key; }); },
        label: name
      };
    };
  }

  function renderList(ul, items) {
    ul.innerHTML = '';
    items.forEach(function (it) {
      const li = document.createElement('li');
      li.className = 'item' + (justAdded.has(it.id) ? ' new' : '');
      li.innerHTML = it.avatar +
        '<div class="item-main"><div class="item-title">' + it.title + '</div>' +
        (it.sub ? '<div class="item-sub">' + it.sub + '</div>' : '') + '</div>' +
        (it.hits === null ? '' : '<span class="hits' + (it.hits ? '' : ' zero') + '" title="累计命中次数">' + (it.hits ? '命中 ' + it.hits.toLocaleString() : '未命中') + '</span>') +
        '<button class="del" title="删除">' + ICON_DEL + '</button>';
      li.querySelector('.del').addEventListener('click', function () {
        change(it.remove, '已删除「' + it.label + '」');
      });
      ul.appendChild(li);
    });
  }

  function renderBlockList() {
    const query = $('#blockSearch').value.trim().toLowerCase();
    const all = blockItems().reverse(); // 最新添加的在最上面
    const items = query ? all.filter(function (it) { return it.search.toLowerCase().indexOf(query) !== -1; }) : all;

    $('#countKeywords').textContent = settings.keywords.length;
    $('#countUploaders').textContent = settings.uploaders.length;
    $('#countVideos').textContent = settings.videos.length;
    $('#blockTools').hidden = all.length < 8;

    const ul = $('#blockList');
    const old = $('#blockEmpty');
    if (old) old.remove();
    renderList(ul, items);

    if (!items.length) {
      const k = KINDS[kind];
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.id = 'blockEmpty';
      empty.innerHTML = query
        ? '<b>没有匹配「' + esc(query) + '」的条目</b>'
        : ICON_EMPTY + '<b>' + k.emptyTitle + '</b><p>' + esc(k.emptyText) +
          (k.emptyText ? '<br>' : '') + '也可以在 B站页面悬停视频封面，点 <span class="kbd">' + ICON_BAN + '</span> 一键屏蔽</p>';
      ul.after(empty);
    }
    justAdded = new Set();
  }

  // ---------- 筛选条件 ----------

  function minutesToInput(sec) {
    if (!sec) return '';
    return String(Math.round(sec / 60 * 100) / 100);
  }

  function inputToSeconds(v) {
    const n = parseFloat(String(v).trim());
    return isNaN(n) || n <= 0 ? 0 : Math.round(n * 60);
  }

  function countToInput(n) {
    return n ? C.formatCount(n) : '';
  }

  function inputToCount(v) {
    const n = C.parseCount(v);
    return n > 0 ? n : 0;
  }

  function setIfIdle(el, value) {
    if (document.activeElement !== el) el.value = value;
  }

  function renderFilters() {
    const d = settings.duration;
    $('#durationEnabled').checked = d.enabled;
    $('#durationCard').classList.toggle('disabled', !d.enabled);
    setIfIdle($('#durationMin'), minutesToInput(d.min));
    setIfIdle($('#durationMax'), minutesToInput(d.max));
    $$('#durationChips button').forEach(function (b) {
      b.classList.toggle('active', d.enabled && d[b.dataset.bound] === +b.dataset.value);
    });
    const ds = [];
    if (d.min) ds.push('短于 ' + C.formatDuration(d.min));
    if (d.max) ds.push('长于 ' + C.formatDuration(d.max));
    summary($('#durationSummary'), d.enabled && ds.length, '隐藏' + ds.join('、') + '的视频', '隐藏过短或过长的视频');

    const v = settings.views;
    $('#viewsEnabled').checked = v.enabled;
    $('#viewsCard').classList.toggle('disabled', !v.enabled);
    setIfIdle($('#viewsMin'), countToInput(v.min));
    setIfIdle($('#viewsMax'), countToInput(v.max));
    $$('#viewsChips button').forEach(function (b) {
      b.classList.toggle('active', v.enabled && v[b.dataset.bound] === +b.dataset.value);
    });
    const vs = [];
    if (v.min) vs.push('低于 ' + C.formatCount(v.min));
    if (v.max) vs.push('高于 ' + C.formatCount(v.max));
    summary($('#viewsSummary'), v.enabled && vs.length, '隐藏播放量' + vs.join('、') + '的视频', '隐藏冷门或过热的视频');

    $$('[data-type]').forEach(function (i) { i.checked = !!settings.types[i.dataset.type]; });
  }

  function summary(el, on, onText, offText) {
    el.textContent = on ? onText : offText;
    el.classList.toggle('on', !!on);
  }

  function bindRange(group, parse) {
    const minEl = $('#' + group + 'Min');
    const maxEl = $('#' + group + 'Max');
    let timer = null;
    function commit() {
      const g = settings[group];
      g.min = parse(minEl.value);
      g.max = parse(maxEl.value);
      // 填了数值就自动启用，省去再点一次开关
      if (g.min || g.max) g.enabled = true;
      persist();
      renderFilters();
    }
    [minEl, maxEl].forEach(function (el) {
      el.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(commit, 500);
      });
      el.addEventListener('blur', function () {
        clearTimeout(timer);
        commit();
        renderFilters();
      });
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter') el.blur(); });
    });

    $('#' + group + 'Enabled').addEventListener('change', function (e) {
      settings[group].enabled = e.target.checked;
      persist();
      renderFilters();
    });

    $$('#' + group + 'Chips button').forEach(function (b) {
      b.addEventListener('click', function () {
        const g = settings[group];
        const bound = b.dataset.bound;
        const value = +b.dataset.value;
        g[bound] = g.enabled && g[bound] === value ? 0 : value;
        g.enabled = !!(g.min || g.max);
        persist();
        renderFilters();
      });
    });
  }

  // ---------- 设置 ----------

  function renderSettings() {
    $$('[data-scope]').forEach(function (i) { i.checked = settings.scopes[i.dataset.scope] !== false; });
    $$('[data-ui]').forEach(function (i) { i.checked = !!settings.ui[i.dataset.ui]; });
    renderList($('#whitelistList'), settings.whitelist.map(uploaderItem('whitelist')).reverse());
  }

  function exportConfig() {
    const data = { app: 'bilibili-filter', exportedAt: new Date().toISOString(), settings: settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bilibili-filter-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function importConfig(file) {
    const reader = new FileReader();
    reader.onload = function () {
      let data;
      try {
        data = JSON.parse(reader.result);
      } catch (e) {
        return toast('文件不是有效的 JSON');
      }
      // 兼容直接导出的 settings 对象和 v1 的扁平结构
      const raw = data.settings || data;
      const next = raw.version ? C.normalizeSettings(raw) : C.migrateV1(raw);
      const before = clone(settings);
      settings = next;
      persist();
      renderAll();
      toast('已导入：' + next.keywords.length + ' 个关键词，' + next.uploaders.length + ' 个 UP主', function () {
        settings = before;
        persist();
        renderAll();
      });
    };
    reader.readAsText(file);
  }

  function confirmButton(btn, label, action) {
    let armed = false;
    let timer = null;
    const original = btn.textContent;
    btn.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        btn.textContent = label;
        btn.classList.add('confirm');
        timer = setTimeout(function () {
          armed = false;
          btn.textContent = original;
          btn.classList.remove('confirm');
        }, 3000);
        return;
      }
      clearTimeout(timer);
      armed = false;
      btn.textContent = original;
      btn.classList.remove('confirm');
      action();
    });
  }

  // ---------- 渲染 & 事件 ----------

  function renderAll() {
    renderHeader();
    renderPageCard();
    renderBlockList();
    renderFilters();
    renderSettings();
  }

  function bind() {
    $('#enabled').addEventListener('change', function (e) {
      settings.enabled = e.target.checked;
      persist();
      renderAll();
    });

    $$('.tab').forEach(function (t) {
      t.addEventListener('click', function () { selectTab(t.dataset.tab); });
    });

    $$('.seg-btn').forEach(function (b) {
      b.addEventListener('click', function () { selectKind(b.dataset.kind); });
    });

    $('#blockForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = $('#blockInput');
      if (addBlock(input.value)) input.value = '';
    });
    $('#blockInput').addEventListener('input', function (e) {
      e.target.classList.remove('invalid');
      if ($('#blockHint').classList.contains('error')) setHint(KINDS[kind].hint);
    });
    // 粘贴多行时自动批量添加
    $('#blockInput').addEventListener('paste', function (e) {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (/\n/.test(text.trim())) {
        e.preventDefault();
        addBlock(text);
      }
    });
    $('#blockSearch').addEventListener('input', renderBlockList);

    bindRange('duration', inputToSeconds);
    bindRange('views', inputToCount);

    $$('[data-type]').forEach(function (i) {
      i.addEventListener('change', function () { settings.types[i.dataset.type] = i.checked; persist(); });
    });
    $$('[data-scope]').forEach(function (i) {
      i.addEventListener('change', function () { settings.scopes[i.dataset.scope] = i.checked; persist(); loadPageStateSoon(); });
    });
    $$('[data-ui]').forEach(function (i) {
      i.addEventListener('change', function () { settings.ui[i.dataset.ui] = i.checked; persist(); });
    });

    $('#whitelistForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = $('#whitelistInput');
      const items = C.splitBatch(input.value).map(C.parseUploaderInput).filter(Boolean);
      if (!items.length) return;
      change(function (s) {
        items.forEach(function (u) {
          if (!s.whitelist.some(function (x) { return C.uploaderKey(x) === C.uploaderKey(u); })) s.whitelist.push(u);
        });
      }, '已加入白名单');
      input.value = '';
    });

    $('#exportBtn').addEventListener('click', exportConfig);
    $('#importBtn').addEventListener('click', function () { $('#importFile').click(); });
    $('#importFile').addEventListener('change', function (e) {
      if (e.target.files[0]) importConfig(e.target.files[0]);
      e.target.value = '';
    });
    confirmButton($('#resetStatsBtn'), '确认清零？', function () {
      S.resetStats();
      toast('统计已清零');
    });
    confirmButton($('#resetAllBtn'), '再点一次确认', function () {
      const before = clone(settings);
      settings = C.defaultSettings();
      persist();
      renderAll();
      toast('已恢复默认设置', function () { settings = before; persist(); renderAll(); });
    });

    chrome.runtime.onMessage.addListener(function (msg, sender) {
      if (msg.type === 'BF_PAGE_STATE' && tab && sender.tab && sender.tab.id === tab.id) {
        pageState = msg.state;
        renderPageCard();
      }
    });

    S.onChange(function (what, value) {
      if (what === 'stats') {
        stats = Object.assign(C.defaultStats(), value);
        renderHeader();
        renderBlockList();
      } else if (JSON.stringify(value) !== JSON.stringify(settings)) {
        settings = value;
        renderAll();
      }
    });
  }

  let pageTimer = null;
  function loadPageStateSoon() {
    clearTimeout(pageTimer);
    pageTimer = setTimeout(loadPageState, 150);
  }

  async function init() {
    bind();
    const results = await Promise.all([S.loadSettings(), S.loadStats()]);
    settings = results[0];
    stats = results[1];
    $('#about').textContent = 'v' + chrome.runtime.getManifest().version + ' · 设置自动保存，并即时同步到所有 B站标签页';
    selectKind('keywords');
    renderAll();
    requestAnimationFrame(moveIndicator);
    loadPageState();
  }

  init();
})();
