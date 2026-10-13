// B站视频过滤器 - chrome.storage 封装（content script 与 popup 共用）

(function (root) {
  'use strict';

  const C = root.BFCore;
  const area = chrome.storage.local;

  async function loadSettings() {
    const data = await area.get([C.SETTINGS_KEY].concat(C.LEGACY_KEYS));
    if (data[C.SETTINGS_KEY]) return C.normalizeSettings(data[C.SETTINGS_KEY]);

    // 首次运行或从 v1 升级
    const hasLegacy = C.LEGACY_KEYS.some(function (k) { return data[k] !== undefined; });
    const settings = hasLegacy ? C.migrateV1(data) : C.defaultSettings();
    const stats = C.defaultStats();
    if (hasLegacy && data.totalBlocked) stats.total = data.totalBlocked;
    await area.set({ [C.SETTINGS_KEY]: settings, [C.STATS_KEY]: stats });
    if (hasLegacy) await area.remove(C.LEGACY_KEYS);
    return settings;
  }

  function saveSettings(settings) {
    return area.set({ [C.SETTINGS_KEY]: C.normalizeSettings(settings) });
  }

  // 读-改-写，降低 popup 与多个页面同时修改时互相覆盖的概率
  async function updateSettings(mutator) {
    const s = await loadSettings();
    const result = mutator(s);
    await saveSettings(s);
    return result === undefined ? s : result;
  }

  async function loadStats() {
    const data = await area.get(C.STATS_KEY);
    return Object.assign(C.defaultStats(), data[C.STATS_KEY] || {});
  }

  async function addStats(delta) {
    const stats = await loadStats();
    stats.total += delta.total || 0;
    Object.keys(delta.hits || {}).forEach(function (k) {
      stats.hits[k] = (stats.hits[k] || 0) + delta.hits[k];
    });
    await area.set({ [C.STATS_KEY]: stats });
  }

  function resetStats() {
    return area.set({ [C.STATS_KEY]: C.defaultStats() });
  }

  function onChange(callback) {
    chrome.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local') return;
      if (changes[C.SETTINGS_KEY] && changes[C.SETTINGS_KEY].newValue) {
        callback('settings', C.normalizeSettings(changes[C.SETTINGS_KEY].newValue));
      }
      if (changes[C.STATS_KEY] && changes[C.STATS_KEY].newValue) {
        callback('stats', changes[C.STATS_KEY].newValue);
      }
    });
  }

  root.BFStore = {
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    updateSettings: updateSettings,
    loadStats: loadStats,
    addStats: addStats,
    resetStats: resetStats,
    onChange: onChange
  };
})(self);
