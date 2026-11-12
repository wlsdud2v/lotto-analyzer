/*
 * Google AdSense 광고
 *
 * 게시자 ID(ca-pub-…)는 index.html 의 <meta name="google-adsense-account"> 한 곳에서만 바꾸면 됩니다.
 * ID가 아직 ca-pub-XXXX… 이거나, 안드로이드 앱(WebView)·로컬 파일로 열었을 때는 아무것도 하지 않습니다.
 *   - 앱 안의 WebView 에 AdSense 를 띄우려면 Google Mobile Ads SDK 의 WebView API for Ads 연동이 필요해서
 *     앱에서는 광고를 끄고, 앱 광고는 나중에 AdMob 으로 따로 붙입니다.
 *
 * 광고 방식
 *   1) 자동 광고: AdSense 사이트 설정에서 '자동 광고'를 켜면 스크립트만으로 Google 이 알아서 배치합니다.
 *   2) 수동 광고 단위: AdSense > 광고 > 광고 단위별 > 디스플레이 광고 를 만들고
 *      나오는 data-ad-slot 숫자를 아래 SLOTS 에 넣으면 각 화면 하단(.ad-slot 자리)에 표시됩니다.
 *      비워 둔 자리는 숨겨집니다.
 */
(function () {
  'use strict';


  /** 화면별 수동 광고 단위 슬롯 ID (예: '1234567890') */
  const SLOTS = {
    lotto: '',    // 로또 번호 분석기 화면 아래
    speetto: '',  // 스피또 화면 아래
    fortune: ''   // 운세 화면 아래
  };


  const meta = document.querySelector('meta[name="google-adsense-account"]');
  const client = meta ? meta.content.trim() : '';
  const hasClient = /^ca-pub-\d{10,20}$/.test(client);
  const inApp = !!window.AndroidBridge
    || location.protocol === 'file:'
    || location.hostname === 'appassets.androidplatform.net';
  const slots = Array.prototype.slice.call(document.querySelectorAll('.ad-slot'));


  function removeSlot(el) { if (el.parentNode) el.parentNode.removeChild(el); }


  // 앱에는 privacy.html 이 들어가지 않으므로 링크를 숨김
  if (inApp) {
    document.querySelectorAll('.foot a[href="privacy.html"]').forEach(removeSlot);
  }

  if (!hasClient || inApp) {
    slots.forEach(removeSlot);
    return;
  }


  // AdSense 스크립트 (자동 광고 + 수동 광고 단위 공용)
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + encodeURIComponent(client);
  document.head.appendChild(s);


  function fill(el) {
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', client);
    ins.setAttribute('data-ad-slot', SLOTS[el.dataset.ad]);
    ins.setAttribute('data-ad-format', 'auto');
    ins.setAttribute('data-full-width-responsive', 'true');
    el.appendChild(ins);
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* 광고 차단기 등 */ }
  }


  // 숨겨진 화면(스피또·운세 등)에서 광고를 미리 요청하면 폭이 0 이라 실패하므로,
  // 광고 자리가 실제로 화면에 보이게 될 때 한 번만 채웁니다.
  const pending = slots.filter(function (el) {
    if (SLOTS[el.dataset.ad]) return true;
    removeSlot(el);
    return false;
  });
  if (!pending.length) return;

  if (!('IntersectionObserver' in window)) { pending.forEach(fill); return; }

  const io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (!en.isIntersecting || en.target.offsetWidth === 0) return;
      io.unobserve(en.target);
      fill(en.target);
    });
  }, { rootMargin: '300px 0px' });
  pending.forEach(function (el) { io.observe(el); });
})();
