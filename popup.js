// B站视频过滤器 - Popup Script

let keywords = [];
let uploaders = [];
let isEnabled = true;
let totalBlocked = 0;
let durationFilter = { enabled: false, minSeconds: 0, maxSeconds: 0 };
let viewsFilter = { enabled: false, minViews: 0, maxViews: 0 };

document.addEventListener('DOMContentLoaded', function () {
    loadSettings();
    bindEvents();
});

function bindEvents() {
    // Tab switching
    document.querySelectorAll('.tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            var tabName = tab.dataset.tab;
            document.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
            tab.classList.add('active');
            document.querySelectorAll('.panel').forEach(function (panel) {
                panel.classList.remove('active');
                if (panel.id === tabName + 'Panel') panel.classList.add('active');
            });
        });
    });

    // Add keyword
    document.getElementById('addKeywordBtn').addEventListener('click', addKeyword);
    document.getElementById('keywordInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') addKeyword();
    });

    // Add uploader
    document.getElementById('addUploaderBtn').addEventListener('click', addUploader);
    document.getElementById('uploaderInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') addUploader();
    });

    // Master toggle
    document.getElementById('enableToggle').addEventListener('change', function () {
        isEnabled = this.checked;
        saveSettings();
        notifyContentScript();
    });

    // Duration toggle
    document.getElementById('durationEnabled').addEventListener('change', function () {
        durationFilter.enabled = this.checked;
        saveSettings();
        notifyContentScript();
    });

    // Duration inputs
    ['minMinutes', 'minSeconds', 'maxMinutes', 'maxSeconds'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', updateDuration);
    });

    // Duration presets
    document.querySelectorAll('.preset:not(.views-preset)').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var minSec = parseInt(btn.dataset.min) || 0;
            var maxSec = parseInt(btn.dataset.max) || 0;
            document.getElementById('minMinutes').value = Math.floor(minSec / 60);
            document.getElementById('minSeconds').value = minSec % 60;
            document.getElementById('maxMinutes').value = Math.floor(maxSec / 60);
            document.getElementById('maxSeconds').value = maxSec % 60;
            durationFilter = { enabled: true, minSeconds: minSec, maxSeconds: maxSec };
            document.getElementById('durationEnabled').checked = true;
            saveSettings();
            notifyContentScript();
            showToast('时长过滤已设置');
        });
    });

    // Views toggle
    document.getElementById('viewsEnabled').addEventListener('change', function () {
        viewsFilter.enabled = this.checked;
        saveSettings();
        notifyContentScript();
    });

    // Views inputs
    ['minViews', 'maxViews'].forEach(function (id) {
        document.getElementById(id).addEventListener('change', updateViews);
    });

    // Views presets
    document.querySelectorAll('.views-preset').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var min = parseInt(btn.dataset.min) || 0;
            var max = parseInt(btn.dataset.max) || 0;
            document.getElementById('minViews').value = min;
            document.getElementById('maxViews').value = max;
            viewsFilter = { enabled: true, minViews: min, maxViews: max };
            document.getElementById('viewsEnabled').checked = true;
            saveSettings();
            notifyContentScript();
            showToast('播放量过滤已设置');
        });
    });

    // Clear all
    document.getElementById('clearAllBtn').addEventListener('click', function () {
        if (confirm('确定要清空所有设置吗？')) {
            keywords = [];
            uploaders = [];
            totalBlocked = 0;
            durationFilter = { enabled: false, minSeconds: 0, maxSeconds: 0 };
            viewsFilter = { enabled: false, minViews: 0, maxViews: 0 };
            resetInputs();
            saveSettings();
            renderKeywords();
            renderUploaders();
            notifyContentScript();
            showToast('已清空');
        }
    });
}

function resetInputs() {
    document.getElementById('minMinutes').value = 0;
    document.getElementById('minSeconds').value = 0;
    document.getElementById('maxMinutes').value = 0;
    document.getElementById('maxSeconds').value = 0;
    document.getElementById('durationEnabled').checked = false;
    document.getElementById('minViews').value = 0;
    document.getElementById('maxViews').value = 0;
    document.getElementById('viewsEnabled').checked = false;
}

function updateDuration() {
    durationFilter.minSeconds = (parseInt(document.getElementById('minMinutes').value) || 0) * 60
        + (parseInt(document.getElementById('minSeconds').value) || 0);
    durationFilter.maxSeconds = (parseInt(document.getElementById('maxMinutes').value) || 0) * 60
        + (parseInt(document.getElementById('maxSeconds').value) || 0);
    saveSettings();
    notifyContentScript();
}

function updateViews() {
    viewsFilter.minViews = parseInt(document.getElementById('minViews').value) || 0;
    viewsFilter.maxViews = parseInt(document.getElementById('maxViews').value) || 0;
    saveSettings();
    notifyContentScript();
}

function loadSettings() {
    chrome.storage.local.get(['keywords', 'uploaders', 'isEnabled', 'totalBlocked', 'durationFilter', 'viewsFilter', 'blacklistKeywords'], function (result) {
        keywords = result.keywords || result.blacklistKeywords || [];
        uploaders = result.uploaders || [];
        isEnabled = result.isEnabled !== undefined ? result.isEnabled : true;
        totalBlocked = result.totalBlocked || 0;
        durationFilter = result.durationFilter || { enabled: false, minSeconds: 0, maxSeconds: 0 };
        viewsFilter = result.viewsFilter || { enabled: false, minViews: 0, maxViews: 0 };

        document.getElementById('enableToggle').checked = isEnabled;
        document.getElementById('blockedCount').textContent = totalBlocked;
        document.getElementById('durationEnabled').checked = durationFilter.enabled;
        document.getElementById('minMinutes').value = Math.floor(durationFilter.minSeconds / 60);
        document.getElementById('minSeconds').value = durationFilter.minSeconds % 60;
        document.getElementById('maxMinutes').value = Math.floor(durationFilter.maxSeconds / 60);
        document.getElementById('maxSeconds').value = durationFilter.maxSeconds % 60;
        document.getElementById('viewsEnabled').checked = viewsFilter.enabled;
        document.getElementById('minViews').value = viewsFilter.minViews;
        document.getElementById('maxViews').value = viewsFilter.maxViews;

        renderKeywords();
        renderUploaders();
    });
}

function saveSettings() {
    chrome.storage.local.set({
        keywords: keywords,
        uploaders: uploaders,
        isEnabled: isEnabled,
        totalBlocked: totalBlocked,
        durationFilter: durationFilter,
        viewsFilter: viewsFilter
    });
}

function addKeyword() {
    var input = document.getElementById('keywordInput');
    var kw = input.value.trim();
    if (!kw) { showToast('请输入关键词'); return; }
    if (keywords.indexOf(kw) !== -1) { showToast('关键词已存在'); return; }
    keywords.push(kw);
    input.value = '';
    saveSettings();
    renderKeywords();
    notifyContentScript();
    showToast('已添加');
}

function addUploader() {
    var input = document.getElementById('uploaderInput');
    var up = input.value.trim();
    if (!up) { showToast('请输入UP主名称'); return; }
    if (uploaders.indexOf(up) !== -1) { showToast('UP主已存在'); return; }
    uploaders.push(up);
    input.value = '';
    saveSettings();
    renderUploaders();
    notifyContentScript();
    showToast('已添加');
}

function renderKeywords() {
    var list = document.getElementById('keywordList');
    var count = document.getElementById('keywordCount');
    count.textContent = keywords.length;

    if (keywords.length === 0) {
        list.innerHTML = '<div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg><p>添加关键词来屏蔽视频</p></div>';
        return;
    }

    list.innerHTML = keywords.map(function (kw) {
        return '<span class="tag" data-value="' + escapeHtml(kw) + '">' + escapeHtml(kw) + '<button class="remove-btn">×</button></span>';
    }).join('');

    list.querySelectorAll('.remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var val = btn.parentElement.dataset.value;
            keywords = keywords.filter(function (k) { return k !== val; });
            saveSettings();
            renderKeywords();
            notifyContentScript();
        });
    });
}

function renderUploaders() {
    var list = document.getElementById('uploaderList');
    var count = document.getElementById('uploaderCount');
    count.textContent = uploaders.length;

    if (uploaders.length === 0) {
        list.innerHTML = '<div class="empty-state"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><p>添加UP主名称来屏蔽</p></div>';
        return;
    }

    list.innerHTML = uploaders.map(function (up) {
        return '<span class="tag" data-value="' + escapeHtml(up) + '">' + escapeHtml(up) + '<button class="remove-btn">×</button></span>';
    }).join('');

    list.querySelectorAll('.remove-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var val = btn.parentElement.dataset.value;
            uploaders = uploaders.filter(function (u) { return u !== val; });
            saveSettings();
            renderUploaders();
            notifyContentScript();
        });
    });
}

function notifyContentScript() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (tabs[0] && tabs[0].url && tabs[0].url.indexOf('bilibili.com') !== -1) {
            chrome.tabs.sendMessage(tabs[0].id, {
                type: 'SETTINGS_UPDATED',
                keywords: keywords,
                uploaders: uploaders,
                isEnabled: isEnabled,
                durationFilter: durationFilter,
                viewsFilter: viewsFilter
            }).catch(function () { });
        }
    });
}

function showToast(msg) {
    var old = document.querySelector('.toast');
    if (old) old.remove();
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function () { toast.remove(); }, 2000);
}

function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

chrome.runtime.onMessage.addListener(function (message) {
    if (message.type === 'BLOCKED_COUNT_UPDATE') {
        totalBlocked = message.count;
        document.getElementById('blockedCount').textContent = totalBlocked;
        saveSettings();
    }
});
