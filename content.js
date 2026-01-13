// B站视频过滤器 - 内容脚本

let keywords = [];
let uploaders = [];
let isEnabled = true;
let durationFilter = { enabled: false, minSeconds: 0, maxSeconds: 0 };
let viewsFilter = { enabled: false, minViews: 0, maxViews: 0 };
let blockedCount = 0;
let observer = null;

// 选择器
const VIDEO_SELECTORS = ['.bili-video-card', '.video-card', '.feed-card', '.recommend-card', '.video-list-item', '.small-item', '.floor-single-card'];
const TITLE_SELECTORS = ['.bili-video-card__info--tit', '.bili-video-card__info--tit a', '.title', 'a.title', '[title]'];
const UPLOADER_SELECTORS = ['.bili-video-card__info--author', '.up-name', '.author', '.owner .name'];
const DURATION_SELECTORS = ['.bili-video-card__stats__duration', '.duration', 'span[class*="duration"]'];
const VIEWS_SELECTORS = ['.bili-video-card__stats--item:first-child', '.play-count', 'span[class*="play"]'];

function init() {
    console.log('[B站过滤器] 初始化...');
    loadSettings();
    setupMessageListener();
}

function loadSettings() {
    chrome.storage.local.get(['keywords', 'uploaders', 'isEnabled', 'totalBlocked', 'durationFilter', 'viewsFilter', 'blacklistKeywords'], function (result) {
        keywords = result.keywords || result.blacklistKeywords || [];
        uploaders = result.uploaders || [];
        isEnabled = result.isEnabled !== undefined ? result.isEnabled : true;
        blockedCount = result.totalBlocked || 0;
        durationFilter = result.durationFilter || { enabled: false, minSeconds: 0, maxSeconds: 0 };
        viewsFilter = result.viewsFilter || { enabled: false, minViews: 0, maxViews: 0 };

        console.log('[B站过滤器] 设置加载:', { keywords: keywords.length, uploaders: uploaders.length });

        if (isEnabled) {
            filterVideos();
            startObserver();
        }
    });
}

function setupMessageListener() {
    chrome.runtime.onMessage.addListener(function (message) {
        if (message.type === 'SETTINGS_UPDATED') {
            keywords = message.keywords || [];
            uploaders = message.uploaders || [];
            isEnabled = message.isEnabled;
            durationFilter = message.durationFilter;
            viewsFilter = message.viewsFilter;

            console.log('[B站过滤器] 设置更新');

            showAllVideos();
            if (isEnabled) {
                filterVideos();
                startObserver();
            } else {
                stopObserver();
            }
        }
    });
}

function getVideoTitle(el) {
    for (var i = 0; i < TITLE_SELECTORS.length; i++) {
        var found = el.querySelector(TITLE_SELECTORS[i]);
        if (found) {
            var title = found.getAttribute('title') || found.textContent;
            if (title && title.trim()) return title.trim();
        }
    }
    return el.getAttribute('title') || '';
}

function getUploaderName(el) {
    for (var i = 0; i < UPLOADER_SELECTORS.length; i++) {
        var found = el.querySelector(UPLOADER_SELECTORS[i]);
        if (found && found.textContent && found.textContent.trim()) {
            return found.textContent.trim();
        }
    }
    return '';
}

function parseDuration(str) {
    if (!str) return -1;
    var match = str.trim().match(/(\d+):(\d+)(?::(\d+))?/);
    if (match) {
        if (match[3]) return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
        return parseInt(match[1]) * 60 + parseInt(match[2]);
    }
    return -1;
}

function getVideoDuration(el) {
    for (var i = 0; i < DURATION_SELECTORS.length; i++) {
        var found = el.querySelector(DURATION_SELECTORS[i]);
        if (found) {
            var sec = parseDuration(found.textContent);
            if (sec >= 0) return sec;
        }
    }
    return -1;
}

function parseViews(str) {
    if (!str) return -1;
    var match = str.trim().match(/([\d.]+)\s*(万|亿)?/);
    if (match) {
        var num = parseFloat(match[1]);
        if (match[2] === '万') num *= 10000;
        if (match[2] === '亿') num *= 100000000;
        return Math.floor(num);
    }
    return -1;
}

function getVideoViews(el) {
    for (var i = 0; i < VIEWS_SELECTORS.length; i++) {
        var found = el.querySelector(VIEWS_SELECTORS[i]);
        if (found) {
            var views = parseViews(found.textContent);
            if (views >= 0) return views;
        }
    }
    return -1;
}

function matchesKeywords(title) {
    if (!title || keywords.length === 0) return false;
    var lower = title.toLowerCase();
    for (var i = 0; i < keywords.length; i++) {
        if (lower.indexOf(keywords[i].toLowerCase()) !== -1) return true;
    }
    return false;
}

function matchesUploader(name) {
    if (!name || uploaders.length === 0) return false;
    var lower = name.toLowerCase();
    for (var i = 0; i < uploaders.length; i++) {
        if (lower.indexOf(uploaders[i].toLowerCase()) !== -1) return true;
    }
    return false;
}

function shouldFilterByDuration(sec) {
    if (!durationFilter.enabled || sec < 0) return false;
    if (durationFilter.minSeconds > 0 && sec < durationFilter.minSeconds) return true;
    if (durationFilter.maxSeconds > 0 && sec > durationFilter.maxSeconds) return true;
    return false;
}

function shouldFilterByViews(views) {
    if (!viewsFilter.enabled || views < 0) return false;
    if (viewsFilter.minViews > 0 && views < viewsFilter.minViews) return true;
    if (viewsFilter.maxViews > 0 && views > viewsFilter.maxViews) return true;
    return false;
}

function shouldHideVideo(title, uploaderName, duration, views) {
    // 关键词匹配
    if (matchesKeywords(title)) {
        return { hide: true, reason: '关键词' };
    }

    // UP主匹配
    if (matchesUploader(uploaderName)) {
        return { hide: true, reason: 'UP主' };
    }

    // 时长过滤
    if (shouldFilterByDuration(duration)) {
        return { hide: true, reason: '时长' };
    }

    // 播放量过滤
    if (shouldFilterByViews(views)) {
        return { hide: true, reason: '播放量' };
    }

    return { hide: false, reason: '' };
}

function filterVideos() {
    if (!isEnabled) return;

    var newBlocked = 0;
    var selector = VIDEO_SELECTORS.join(', ');
    var cards = document.querySelectorAll(selector);

    cards.forEach(function (card) {
        var title = getVideoTitle(card);
        var uploader = getUploaderName(card);
        var duration = getVideoDuration(card);
        var views = getVideoViews(card);

        var result = shouldHideVideo(title, uploader, duration, views);

        if (result.hide) {
            if (!card.classList.contains('bilibili-filter-hidden')) {
                card.classList.add('bilibili-filter-hidden');
                newBlocked++;
                console.log('[B站过滤器] 隐藏 (' + result.reason + '):', title.substring(0, 30));
            }
        } else {
            card.classList.remove('bilibili-filter-hidden');
        }
    });

    if (newBlocked > 0) {
        blockedCount += newBlocked;
        updateBlockedCount();
    }
}

function showAllVideos() {
    document.querySelectorAll('.bilibili-filter-hidden').forEach(function (card) {
        card.classList.remove('bilibili-filter-hidden');
    });
}

function updateBlockedCount() {
    chrome.storage.local.set({ totalBlocked: blockedCount });
    chrome.runtime.sendMessage({ type: 'BLOCKED_COUNT_UPDATE', count: blockedCount }).catch(function () { });
}

function startObserver() {
    if (observer) return;

    var timeout;
    observer = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes.length > 0) {
                clearTimeout(timeout);
                timeout = setTimeout(filterVideos, 200);
                break;
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// URL变化监听
var lastUrl = location.href;
new MutationObserver(function () {
    if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(function () { showAllVideos(); filterVideos(); }, 500);
    }
}).observe(document, { subtree: true, childList: true });
