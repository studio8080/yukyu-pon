/*
 * GA4（料金・規約などの静的ページだけ）。アプリ本体（index.html）では読み込まない。
 * 従業員のデータはアプリの中（このページとは別）にあり、ここからは読まない・送らない。
 * 送るのはページの閲覧だけ: URL はクエリとハッシュを除き、参照元はドメインだけ。拡張計測・Google シグナル・広告はオフ。
 * Do Not Track / Global Privacy Control を尊重し、privacy.html の「無効にする」で止められる。
 */
(function () {
  'use strict';
  // 有効にするか（2026-10-07 時点ではオフ。静的ページも同じ保存領域のため、運営者の判断待ち。README 3章）
  var ENABLED = false;
  var id = 'G-J91XL10BCE';
  var optKey = 'yukyuponAnalyticsOptOut';
  var button = document.getElementById('analytics-optout');
  var status = document.getElementById('analytics-optout-status');
  var optedOut = false;
  try { optedOut = localStorage.getItem(optKey) === '1'; } catch (_) {}
  if (status && optedOut) status.textContent = 'このブラウザでは、アクセス解析は無効です。';
  if (button) button.addEventListener('click', function () {
    try { localStorage.setItem(optKey, '1'); } catch (_) {}
    window['ga-disable-' + id] = true;
    document.cookie.split(';').forEach(function (entry) {
      var name = entry.trim().split('=')[0];
      if (!/^_ga(?:_|$)/.test(name)) return;
      ['', '; domain=' + location.hostname, '; domain=.' + location.hostname].forEach(function (domain) {
        document.cookie = name + '=; Max-Age=0; path=/' + domain + '; SameSite=Lax';
      });
    });
    if (status) status.textContent = 'このブラウザでは、アクセス解析を無効にしました。';
  });
  if (!ENABLED) { if (status && !optedOut) status.textContent = '現在、アクセス解析は使っていません。'; return; }
  if (optedOut || navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
  if (location.hostname !== 'yukyu.kokokikaku.com') return; // 開発中は送らない
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  var referrer = '';
  try { referrer = new URL(document.referrer).origin + '/'; } catch (_) {}
  var page = location.origin + location.pathname;
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  gtag('consent', 'default', { analytics_storage: 'denied',
    region: ['AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO','GB','CH'] });
  gtag('js', new Date());
  gtag('config', id, { send_page_view: false, page_location: page, page_referrer: referrer, page_title: document.title,
    allow_google_signals: false, allow_ad_personalization_signals: false, cookie_domain: location.hostname });
  gtag('event', 'page_view', { page_location: page, page_referrer: referrer, page_title: document.title });
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + id;
  document.head.appendChild(s);
})();
