// B站视频过滤器 - 共享核心：设置结构、迁移、规则匹配
// 同时被 content script、popup 和 Node 测试加载，因此不依赖 DOM / chrome API。

(function (root) {
  'use strict';

  const SETTINGS_KEY = 'bf_settings';
  const STATS_KEY = 'bf_stats';
  const SCHEMA_VERSION = 2;

  function defaultSettings() {
    return {
      version: SCHEMA_VERSION,
      enabled: true,
      keywords: [],            // string，"/pattern/flags" 形式视为正则
      uploaders: [],           // { mid: string|null, name: string }
      videos: [],              // { bvid: string, title: string }
      whitelist: [],           // { mid: string|null, name: string }
      duration: { enabled: false, min: 0, max: 0 },   // 秒，0 = 不限
      views: { enabled: false, min: 0, max: 0 },      // 次，0 = 不限
      types: { ads: true, live: false, nonVideo: false },
      scopes: { home: true, search: true, video: true, other: true },
      ui: { quickBlock: true, badge: true }
    };
  }

  function defaultStats() {
    return { total: 0, hits: {} };
  }

  // 合并存储值与默认值，保证新增字段存在
  function normalizeSettings(raw) {
    const d = defaultSettings();
    if (!raw || typeof raw !== 'object') return d;
    const s = Object.assign({}, d, raw);
    ['duration', 'views', 'types', 'scopes', 'ui'].forEach(function (k) {
      s[k] = Object.assign({}, d[k], raw[k] || {});
    });
    ['keywords', 'uploaders', 'videos', 'whitelist'].forEach(function (k) {
      s[k] = Array.isArray(raw[k]) ? raw[k].slice() : [];
    });
    s.version = SCHEMA_VERSION;
    return s;
  }

  // v1 使用分散的 key：keywords / uploaders / isEnabled / durationFilter / viewsFilter / totalBlocked
  function migrateV1(legacy) {
    const s = defaultSettings();
    const kws = legacy.keywords || legacy.blacklistKeywords || [];
    s.keywords = kws.filter(Boolean).map(String);
    s.uploaders = (legacy.uploaders || []).filter(Boolean).map(function (name) {
      return parseUploaderInput(String(name)) || { mid: null, name: String(name) };
    });
    if (legacy.isEnabled === false) s.enabled = false;
    if (legacy.durationFilter) {
      s.duration = {
        enabled: !!legacy.durationFilter.enabled,
        min: legacy.durationFilter.minSeconds || 0,
        max: legacy.durationFilter.maxSeconds || 0
      };
    }
    if (legacy.viewsFilter) {
      s.views = {
        enabled: !!legacy.viewsFilter.enabled,
        min: legacy.viewsFilter.minViews || 0,
        max: legacy.viewsFilter.maxViews || 0
      };
    }
    return s;
  }

  const LEGACY_KEYS = ['keywords', 'blacklistKeywords', 'uploaders', 'isEnabled', 'durationFilter', 'viewsFilter', 'totalBlocked'];

  // ---------- 解析 ----------

  function parseDuration(str) {
    if (!str) return -1;
    const m = String(str).trim().match(/(\d+):(\d{1,2})(?::(\d{1,2}))?/);
    if (!m) return -1;
    if (m[3] !== undefined) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    return (+m[1]) * 60 + (+m[2]);
  }

  // "248.4万" -> 2484000，"1.1亿" -> 110000000，"1250" -> 1250
  function parseCount(str) {
    if (str === null || str === undefined) return -1;
    const m = String(str).replace(/,/g, '').trim().match(/([\d.]+)\s*([万亿wWkK])?/);
    if (!m) return -1;
    let n = parseFloat(m[1]);
    if (isNaN(n)) return -1;
    const unit = m[2];
    if (unit === '万' || unit === 'w' || unit === 'W') n *= 1e4;
    else if (unit === '亿') n *= 1e8;
    else if (unit === 'k' || unit === 'K') n *= 1e3;
    return Math.round(n);
  }

  function formatCount(n) {
    if (!n) return '0';
    if (n >= 1e8) return trimZero(n / 1e8) + '亿';
    if (n >= 1e4) return trimZero(n / 1e4) + '万';
    return String(n);
  }

  function trimZero(x) {
    return x.toFixed(1).replace(/\.0$/, '');
  }

  function formatDuration(sec) {
    if (!sec) return '0';
    if (sec % 3600 === 0) return (sec / 3600) + ' 小时';
    if (sec % 60 === 0) return (sec / 60) + ' 分钟';
    if (sec < 60) return sec + ' 秒';
    return Math.floor(sec / 60) + ' 分 ' + (sec % 60) + ' 秒';
  }

  function extractMid(href) {
    if (!href) return null;
    const m = String(href).match(/space\.bilibili\.com\/(\d+)/);
    return m ? m[1] : null;
  }

  function extractBvid(href) {
    if (!href) return null;
    const m = String(href).match(/\b(BV[0-9A-Za-z]{10})\b/);
    return m ? m[1] : null;
  }

  // 用户输入：名称 / 纯数字 UID / "UID:123" / 空间链接
  function parseUploaderInput(input) {
    const text = String(input || '').trim();
    if (!text) return null;
    const mid = extractMid(text);
    if (mid) return { mid: mid, name: '' };
    const uid = text.match(/^(?:uid[:：\s]*)?(\d{1,16})$/i);
    if (uid) return { mid: uid[1], name: '' };
    return { mid: null, name: text };
  }

  // 一次粘贴多个：按换行、中英文逗号、顿号分割
  function splitBatch(input) {
    return String(input || '')
      .split(/[\n,，、]+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  // ---------- 关键词 ----------

  const regexCache = new Map();

  function parseRegex(kw) {
    const m = String(kw).match(/^\/(.+)\/([a-z]*)$/);
    if (!m) return null;
    const key = kw;
    if (regexCache.has(key)) return regexCache.get(key);
    let re = null;
    try {
      const flags = m[2].indexOf('i') === -1 ? m[2] + 'i' : m[2];
      re = new RegExp(m[1], flags.replace(/[gy]/g, ''));
    } catch (e) {
      re = false; // 无效正则
    }
    regexCache.set(key, re);
    return re;
  }

  function isValidKeyword(kw) {
    return parseRegex(kw) !== false;
  }

  function matchKeyword(title, kw) {
    if (!title || !kw) return false;
    const re = parseRegex(kw);
    if (re === false) return false;
    if (re) return re.test(title);
    return title.toLowerCase().indexOf(String(kw).toLowerCase()) !== -1;
  }

  // ---------- UP主 ----------

  function sameUploader(rule, info) {
    if (!rule) return false;
    if (rule.mid && info.mid) return rule.mid === info.mid;
    if (rule.mid && !info.mid) return false;
    // 仅有名称的规则：精确匹配（不再用子串，避免误伤）
    return !!(rule.name && info.name && rule.name.toLowerCase() === info.name.toLowerCase());
  }

  function uploaderKey(u) {
    return u.mid ? 'mid:' + u.mid : 'name:' + String(u.name).toLowerCase();
  }

  function uploaderLabel(u) {
    if (u.name && u.mid) return u.name;
    if (u.name) return u.name;
    return 'UID ' + u.mid;
  }

  // ---------- 判定 ----------

  // video: { title, upName, mid, bvid, duration, views, kind: 'video'|'ad'|'live'|'nonVideo' }
  // 返回 null 或 { type, key, label }，key 用于统计命中
  function evaluate(video, s) {
    if (!s.enabled) return null;

    const up = { mid: video.mid || null, name: video.upName || '' };
    const whitelisted = s.whitelist.some(function (w) { return sameUploader(w, up); });

    if (video.kind === 'ad' && s.types.ads) return { type: 'ads', key: 'type:ads', label: '广告推广' };
    if (whitelisted) return null;
    if (video.kind === 'live' && s.types.live) return { type: 'live', key: 'type:live', label: '直播' };
    if (video.kind === 'nonVideo' && s.types.nonVideo) return { type: 'nonVideo', key: 'type:nonVideo', label: '番剧/影视/课堂推荐' };

    if (video.bvid) {
      for (let i = 0; i < s.videos.length; i++) {
        if (s.videos[i].bvid === video.bvid) {
          return { type: 'video', key: 'video:' + video.bvid, label: '已屏蔽的视频', rule: s.videos[i] };
        }
      }
    }

    for (let i = 0; i < s.uploaders.length; i++) {
      if (sameUploader(s.uploaders[i], up)) {
        const u = s.uploaders[i];
        return { type: 'uploader', key: 'up:' + uploaderKey(u), label: 'UP主 · ' + (up.name || uploaderLabel(u)), rule: u };
      }
    }

    for (let i = 0; i < s.keywords.length; i++) {
      if (matchKeyword(video.title, s.keywords[i])) {
        return { type: 'keyword', key: 'kw:' + s.keywords[i], label: '关键词 · ' + s.keywords[i], rule: s.keywords[i] };
      }
    }

    if (video.kind === 'video') {
      const d = s.duration;
      if (d.enabled && video.duration >= 0) {
        if (d.min > 0 && video.duration < d.min) return { type: 'duration', key: 'duration', label: '时长短于 ' + formatDuration(d.min) };
        if (d.max > 0 && video.duration > d.max) return { type: 'duration', key: 'duration', label: '时长超过 ' + formatDuration(d.max) };
      }
      const v = s.views;
      if (v.enabled && video.views >= 0) {
        if (v.min > 0 && video.views < v.min) return { type: 'views', key: 'views', label: '播放量低于 ' + formatCount(v.min) };
        if (v.max > 0 && video.views > v.max) return { type: 'views', key: 'views', label: '播放量高于 ' + formatCount(v.max) };
      }
    }
    return null;
  }

  // 由 URL 判断当前页面所属范围
  function scopeOf(url) {
    let u;
    try { u = new URL(url); } catch (e) { return 'other'; }
    if (u.hostname === 'search.bilibili.com') return 'search';
    if (u.hostname === 'www.bilibili.com' || u.hostname === 'bilibili.com') {
      if (u.pathname === '/' || u.pathname === '/index.html') return 'home';
      if (/^\/(video|list|bangumi\/play)\//.test(u.pathname)) return 'video';
    }
    return 'other';
  }

  const TYPE_LABELS = {
    keyword: '关键词', uploader: 'UP主', video: '视频', duration: '时长',
    views: '播放量', ads: '广告', live: '直播', nonVideo: '推荐楼层'
  };

  const api = {
    SETTINGS_KEY: SETTINGS_KEY,
    STATS_KEY: STATS_KEY,
    LEGACY_KEYS: LEGACY_KEYS,
    TYPE_LABELS: TYPE_LABELS,
    defaultSettings: defaultSettings,
    defaultStats: defaultStats,
    normalizeSettings: normalizeSettings,
    migrateV1: migrateV1,
    parseDuration: parseDuration,
    parseCount: parseCount,
    formatCount: formatCount,
    formatDuration: formatDuration,
    extractMid: extractMid,
    extractBvid: extractBvid,
    parseUploaderInput: parseUploaderInput,
    splitBatch: splitBatch,
    isValidKeyword: isValidKeyword,
    matchKeyword: matchKeyword,
    sameUploader: sameUploader,
    uploaderKey: uploaderKey,
    uploaderLabel: uploaderLabel,
    evaluate: evaluate,
    scopeOf: scopeOf
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BFCore = api;
})(typeof self !== 'undefined' ? self : this);
