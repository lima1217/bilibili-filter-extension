// 运行：node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/shared/core.js');

function settings(patch) {
  return Object.assign(C.defaultSettings(), patch || {});
}

function video(patch) {
  return Object.assign({ kind: 'video', title: '普通视频', upName: '某UP', mid: '1', bvid: 'BV1xx411c7mD', duration: 300, views: 50000 }, patch || {});
}

test('parseDuration', () => {
  assert.equal(C.parseDuration('48:13'), 2893);
  assert.equal(C.parseDuration('1:02:03'), 3723);
  assert.equal(C.parseDuration(''), -1);
  assert.equal(C.parseDuration('直播中'), -1);
});

test('parseCount', () => {
  assert.equal(C.parseCount('248.4万'), 2484000);
  assert.equal(C.parseCount('1.1亿'), 110000000);
  assert.equal(C.parseCount('1,250'), 1250);
  assert.equal(C.parseCount('1.5w'), 15000);
  assert.equal(C.parseCount('abc'), -1);
});

test('formatCount / formatDuration', () => {
  assert.equal(C.formatCount(15000), '1.5万');
  assert.equal(C.formatCount(100000000), '1亿');
  assert.equal(C.formatDuration(60), '1 分钟');
  assert.equal(C.formatDuration(3600), '1 小时');
  assert.equal(C.formatDuration(30), '30 秒');
});

test('parseUploaderInput', () => {
  assert.deepEqual(C.parseUploaderInput('https://space.bilibili.com/546195?spm=1'), { mid: '546195', name: '' });
  assert.deepEqual(C.parseUploaderInput('546195'), { mid: '546195', name: '' });
  assert.deepEqual(C.parseUploaderInput('UID: 42'), { mid: '42', name: '' });
  assert.deepEqual(C.parseUploaderInput('老番茄'), { mid: null, name: '老番茄' });
  assert.equal(C.parseUploaderInput('  '), null);
});

test('splitBatch', () => {
  assert.deepEqual(C.splitBatch('a, b，c、d\ne\n\n'), ['a', 'b', 'c', 'd', 'e']);
});

test('extractBvid / extractMid', () => {
  assert.equal(C.extractBvid('https://www.bilibili.com/video/BV1iqpt6cEMU?x=1'), 'BV1iqpt6cEMU');
  assert.equal(C.extractMid('//space.bilibili.com/8365699'), '8365699');
});

test('keyword: substring is case-insensitive, regex supported, invalid regex ignored', () => {
  assert.ok(C.matchKeyword('原神 PV 首发', 'pv'));
  assert.ok(C.matchKeyword('第12期 节目', '/第\\d+期/'));
  assert.ok(!C.matchKeyword('第十二期', '/第\\d+期/'));
  assert.equal(C.isValidKeyword('/[unclosed/'), false);
  assert.ok(!C.matchKeyword('anything', '/[unclosed/'));
});

test('uploader matches by mid, name match is exact', () => {
  assert.ok(C.sameUploader({ mid: '1', name: 'x' }, { mid: '1', name: '改名后' }));
  assert.ok(!C.sameUploader({ mid: '1', name: '' }, { mid: '2', name: '' }));
  assert.ok(C.sameUploader({ mid: null, name: '小明' }, { mid: '9', name: '小明' }));
  assert.ok(!C.sameUploader({ mid: null, name: '小明' }, { mid: '9', name: '小明同学' }));
});

test('evaluate: rules and priorities', () => {
  assert.equal(C.evaluate(video(), settings()), null);
  assert.equal(C.evaluate(video({ kind: 'ad' }), settings()).type, 'ads');
  assert.equal(C.evaluate(video({ kind: 'live' }), settings()), null);
  assert.equal(C.evaluate(video({ kind: 'live' }), settings({ types: { ads: true, live: true, nonVideo: false } })).type, 'live');
  assert.equal(C.evaluate(video({ title: '开箱视频' }), settings({ keywords: ['开箱'] })).key, 'kw:开箱');
  assert.equal(C.evaluate(video(), settings({ uploaders: [{ mid: '1', name: '' }] })).key, 'up:mid:1');
  assert.equal(C.evaluate(video(), settings({ videos: [{ bvid: 'BV1xx411c7mD' }] })).type, 'video');
  assert.equal(C.evaluate(video({ duration: 30 }), settings({ duration: { enabled: true, min: 60, max: 0 } })).type, 'duration');
  assert.equal(C.evaluate(video({ duration: 30 }), settings({ duration: { enabled: false, min: 60, max: 0 } })), null);
  assert.equal(C.evaluate(video({ duration: -1 }), settings({ duration: { enabled: true, min: 60, max: 0 } })), null);
  assert.equal(C.evaluate(video({ views: 100 }), settings({ views: { enabled: true, min: 1000, max: 0 } })).type, 'views');
  assert.equal(C.evaluate(video({ title: '开箱' }), settings({ enabled: false, keywords: ['开箱'] })), null);
});

test('evaluate: whitelist overrides everything except ads', () => {
  const s = settings({ keywords: ['开箱'], whitelist: [{ mid: '1', name: '' }], duration: { enabled: true, min: 600, max: 0 } });
  assert.equal(C.evaluate(video({ title: '开箱' }), s), null);
  assert.equal(C.evaluate(video({ title: '开箱', kind: 'ad' }), s).type, 'ads');
});

test('migrateV1', () => {
  const s = C.migrateV1({
    keywords: ['a'], uploaders: ['老番茄', '546195'], isEnabled: false,
    durationFilter: { enabled: true, minSeconds: 60, maxSeconds: 0 },
    viewsFilter: { enabled: false, minViews: 1000, maxViews: 0 }
  });
  assert.deepEqual(s.keywords, ['a']);
  assert.deepEqual(s.uploaders, [{ mid: null, name: '老番茄' }, { mid: '546195', name: '' }]);
  assert.equal(s.enabled, false);
  assert.deepEqual(s.duration, { enabled: true, min: 60, max: 0 });
  assert.deepEqual(s.views, { enabled: false, min: 1000, max: 0 });
});

test('normalizeSettings fills missing fields', () => {
  const s = C.normalizeSettings({ version: 2, keywords: ['x'], types: { live: true } });
  assert.deepEqual(s.types, { ads: true, live: true, nonVideo: false });
  assert.deepEqual(s.uploaders, []);
  assert.equal(s.scopes.home, true);
});

test('scopeOf', () => {
  assert.equal(C.scopeOf('https://www.bilibili.com/'), 'home');
  assert.equal(C.scopeOf('https://search.bilibili.com/all?keyword=x'), 'search');
  assert.equal(C.scopeOf('https://www.bilibili.com/video/BV1iqpt6cEMU'), 'video');
  assert.equal(C.scopeOf('https://www.bilibili.com/v/popular/all'), 'other');
});
