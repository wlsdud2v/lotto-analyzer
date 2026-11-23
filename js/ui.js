/**
 * 화면 보조 동작: 밝기(라이트/다크), 아래에서 올라오는 창(메뉴·ⓘ 설명·분석 기준),
 * 줄 수 +/−, 아래 메뉴 표시, 추천 후 결과로 이동, 세트 '자세히' 펼치기.
 * app.js 의 상태·렌더링에는 손대지 않고 화면 동작만 담당한다.
 */
(() => {
  const $ = sel => document.querySelector(sel);
  const $$ = sel => [...document.querySelectorAll(sel)];
  const root = document.documentElement;
  const THEME_KEY = 'lotto.theme';
  const MORE_TABS = ['more', 'teachers', 'tarot', 'machine', 'prize'];


  // ───────────── 화면 밝기 ─────────────

  const systemDark = () => window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const savedTheme = () => { try { return localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { return 'auto'; } };

  function applyTheme(t) {
    if (t === 'light' || t === 'dark') root.dataset.theme = t;
    else delete root.dataset.theme;
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* 무시 */ }
    $$('#themeSel button').forEach(b => b.classList.toggle('active', b.dataset.t === t));
    const dark = t === 'dark' || (t === 'auto' && systemDark());
    $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', dark ? '#141311' : '#ffffff'));
  }

  $('#themeBtn').addEventListener('click', () => {
    const t = savedTheme();
    const dark = t === 'dark' || (t === 'auto' && systemDark());
    applyTheme(dark ? 'light' : 'dark');
  });
  $('#themeSel').addEventListener('click', e => {
    const b = e.target.closest('button[data-t]');
    if (b) applyTheme(b.dataset.t);
  });
  applyTheme(savedTheme());


  // ───────────── 아래에서 올라오는 창 ─────────────

  function openSheet(dlg) {
    if (!dlg) return;
    if (dlg.open) return;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function closeSheet(dlg) {
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  $$('dialog.sheet').forEach(dlg => {
    // 바깥(어두운 부분)을 누르면 닫기
    dlg.addEventListener('click', e => { if (e.target === dlg) closeSheet(dlg); });
  });

  $('#menuBtn').addEventListener('click', () => openSheet($('#menuSheet')));


  /** ⓘ 버튼: 숨겨 둔 설명(.info-src)을 복사해 설명 창에 보여 줌 (동적으로 바뀐 내용도 그대로) */
  function openInfo(btn) {
    const src = document.getElementById(btn.dataset.info);
    if (!src) return;
    const copy = src.cloneNode(true);
    copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
    $('#infoTitle').textContent = btn.dataset.title || '설명';
    const body = $('#infoBody');
    body.innerHTML = '';
    [...copy.childNodes].forEach(n => body.appendChild(n));
    openSheet($('#infoSheet'));
    body.scrollTop = 0;
  }


  document.addEventListener('click', e => {
    const t = e.target;

    const info = t.closest('[data-info]');
    if (info) { e.preventDefault(); openInfo(info); return; }

    const opener = t.closest('[data-sheet]');
    if (opener) { e.preventDefault(); openSheet(document.getElementById(opener.dataset.sheet)); return; }

    const closer = t.closest('[data-close]');
    if (closer) { closeSheet(closer.closest('dialog')); return; }

    // 프로그램 전환은 app.js 가 처리 — 메뉴 창만 닫아 줌
    if (t.closest('.app-btn')) { closeSheet($('#menuSheet')); return; }

    // 줄 수 −/+
    const stepBtn = t.closest('.stepper [data-d]');
    if (stepBtn) {
      const input = $('#setCount');
      const v = Math.max(+input.min || 1, Math.min(+input.max || 10, (+input.value || 5) + +stepBtn.dataset.d));
      input.value = v;
      return;
    }

    // 세트 '자세히' 펼치기
    const meta = t.closest('[data-act="meta"]');
    if (meta) {
      const set = meta.closest('.set');
      const open = set.classList.toggle('open');
      meta.setAttribute('aria-expanded', open ? 'true' : 'false');
      meta.classList.toggle('on', open);
      return;
    }

    // 번호 받기 → 결과로 이동
    if (t.closest('#genBtn')) {
      requestAnimationFrame(() => $('#resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }

    // 로또 화면 전환 (더보기 타일 · 뒤로 · 자세히) → 맨 위로
    if (t.closest('#app-lotto .tab')) window.scrollTo({ top: 0 });
  });


  /** 아래 메뉴에서 지금 화면 표시. 더보기 안의 화면이면 '더보기', 운세 프로그램이면 '운세'에 불 */
  function syncNav() {
    const app = document.body.dataset.app || 'lotto';
    let group = null;
    if (app === 'fortune') group = 'fortune';
    else if (app === 'lotto') {
      const p = $('#app-lotto .panel.active');
      const id = p ? p.id.replace(/^tab-/, '') : 'recommend';
      group = MORE_TABS.includes(id) ? 'more' : id;
    }
    $$('.bnav .bn').forEach(b => {
      const on = b.dataset.go === group;
      b.classList.toggle('is-on', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
  }

  new MutationObserver(syncNav).observe(document.body, { attributes: true, attributeFilter: ['data-app'] });
  new MutationObserver(syncNav).observe($('#app-lotto'), { attributes: true, subtree: true, attributeFilter: ['class'] });
  syncNav();


  // 메뉴 창: 지금 보고 있는 프로그램 표시
  const markApp = () => $$('#menuSheet .menu-row').forEach(r => r.classList.toggle('active', r.dataset.app === document.body.dataset.app));
  new MutationObserver(markApp).observe(document.body, { attributes: true, attributeFilter: ['data-app'] });
  markApp();


  // 안드로이드 뒤로 가기 / Esc: 열린 창 닫기는 <dialog> 기본 동작 사용
})();
