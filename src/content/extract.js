// B站视频过滤器 - 页面卡片识别与信息提取
// 每个 adapter 描述一种卡片：如何找到它、隐藏哪个容器、如何提取字段。

(function (root) {
  'use strict';

  const C = root.BFCore;

  function q(el, sel) {
    return sel ? el.querySelector(sel) : null;
  }

  function text(el) {
    return el ? (el.getAttribute('title') || el.textContent || '').trim() : '';
  }

  function hrefOf(el) {
    return el ? el.getAttribute('href') || '' : '';
  }

  function firstHref(el, pattern) {
    if (el.matches && el.matches('a') && pattern.test(hrefOf(el))) return hrefOf(el);
    const links = el.querySelectorAll('a[href]');
    for (let i = 0; i < links.length; i++) {
      if (pattern.test(links[i].getAttribute('href'))) return links[i].getAttribute('href');
    }
    return '';
  }

  const AD_HREF = /cm\.bilibili\.com|[?&]creative_id=\d/;
  const LIVE_HREF = /live\.bilibili\.com/;

  // 搜索页的卡片外层是 col_* 栅格单元，隐藏卡片本身会留下空洞
  function gridCell(el) {
    const p = el.parentElement;
    if (p && /(^|\s)col_/.test(p.className)) return p;
    return null;
  }

  const ADAPTERS = [
    {
      // 首页推荐流、搜索结果、分区页等新版卡片
      name: 'bili-video-card',
      selector: '.bili-video-card',
      skip: function (el) { return !!el.closest('.recommended-swipe, .recommended-swipe-shim'); },
      container: function (el) {
        return el.closest('.feed-card') || el.closest('.bili-feed-card') || gridCell(el) || el;
      },
      fields: {
        title: '.bili-video-card__info--tit',
        owner: '.bili-video-card__info--owner',
        author: '.bili-video-card__info--author',
        duration: '.bili-video-card__stats__duration',
        views: '.bili-video-card__stats--item'
      },
      kind: function (el) {
        if (q(el, '.bili-video-card__info--ad, .bili-video-card__info--creative-ad, .bili-video-card__info--ad-creative, .vui_icon.bili-video-card__info--ad-img')) return 'ad';
        const link = firstHref(el, /./);
        if (AD_HREF.test(link)) return 'ad';
        if (LIVE_HREF.test(link) || q(el, '.bili-video-card__info--living')) return 'live';
        return 'video';
      }
    },
    {
      name: 'bili-live-card',
      selector: '.bili-live-card',
      container: function (el) { return el.closest('.feed-card') || el.closest('.bili-feed-card') || el; },
      fields: { title: '.bili-live-card__info--tit', author: '.bili-live-card__info--uname', owner: '.bili-live-card__info--uname' },
      kind: function () { return 'live'; }
    },
    {
      // 首页番剧 / 国创 / 课堂 / 直播 等楼层卡片
      name: 'floor-single-card',
      selector: '.floor-single-card',
      // 首页无限加载的锚点里也放了一张楼层骨架卡，隐藏它会导致无法继续加载
      skip: function (el) { return !!el.closest('.load-more-anchor'); },
      container: function (el) { return el.closest('.feed-card') || el; },
      fields: { title: '.title, .floor-title' },
      kind: function (el) { return LIVE_HREF.test(firstHref(el, /./)) ? 'live' : 'nonVideo'; }
    },
    {
      // 视频播放页右侧推荐
      name: 'video-page-card',
      selector: '.video-page-card-small',
      container: function (el) { return el; },
      fields: {
        title: '.title',
        owner: '.upname a',
        author: '.upname .name',
        duration: '.duration',
        views: '.playinfo'
      },
      kind: function (el) { return AD_HREF.test(firstHref(el, /./)) ? 'ad' : 'video'; }
    },
    {
      // 视频播放页右侧广告位
      name: 'video-page-ad',
      selector: '.video-page-operator-card-small, .video-card-ad-small, .video-page-special-card-small, #slide_ad, .ad-report',
      container: function (el) { return el; },
      fields: { title: '.title' },
      kind: function () { return 'ad'; }
    },
    {
      // 热门 / 每周必看
      name: 'popular-card',
      selector: '.popular-container .video-card, .video-list .video-card',
      container: function (el) { return el; },
      fields: { title: '.video-name', author: '.up-name__text', views: '.play-text' },
      kind: function () { return 'video'; }
    },
    {
      // 排行榜
      name: 'rank-item',
      selector: '.rank-list .rank-item',
      container: function (el) { return el; },
      fields: { title: '.title', owner: '.up-name', author: '.up-name', views: '.detail-state .data-box' },
      kind: function () { return 'video'; }
    }
  ];

  const ALL_SELECTOR = ADAPTERS.map(function (a) { return a.selector; }).join(', ');

  function adapterFor(el) {
    for (let i = 0; i < ADAPTERS.length; i++) {
      if (el.matches(ADAPTERS[i].selector)) return ADAPTERS[i];
    }
    return null;
  }

  function extract(el, adapter) {
    const f = adapter.fields;
    const titleEl = q(el, f.title);
    const ownerEl = q(el, f.owner);
    const authorEl = q(el, f.author);
    const kind = adapter.kind(el);

    const video = {
      kind: kind,
      title: text(titleEl),
      upName: authorEl ? (authorEl.getAttribute('title') || authorEl.textContent || '').trim() : '',
      mid: C.extractMid(hrefOf(ownerEl)) || C.extractMid(firstHref(el, /space\.bilibili\.com\/\d+/)),
      bvid: C.extractBvid(firstHref(el, /\/video\/BV/)),
      duration: C.parseDuration(text(q(el, f.duration))),
      views: C.parseCount(text(q(el, f.views)))
    };

    // 骨架屏 / 尚未渲染完成：标题为空的普通视频卡片暂不处理，等下一次 DOM 变化
    if (kind === 'video' && !video.title) return null;
    return video;
  }

  // 用于判断卡片内容是否被 Vue 复用替换（如「换一换」）
  function signature(el) {
    const a = el.querySelector('a[href]');
    return (a ? a.getAttribute('href') : '') + '|' + (el.textContent || '').length;
  }

  root.BFExtract = {
    ADAPTERS: ADAPTERS,
    ALL_SELECTOR: ALL_SELECTOR,
    adapterFor: adapterFor,
    extract: extract,
    signature: signature
  };
})(self);
