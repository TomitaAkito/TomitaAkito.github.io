// =========================================================
// 全ページ共通スクリプト：ハンバーガーメニューの開閉制御
// =========================================================
(function () {
  const hamburger = document.getElementById("hamburger");
  const nav = document.getElementById("nav");
  const overlay = document.getElementById("navOverlay");

  if (!hamburger || !nav) return;

  function closeMenu() {
    hamburger.classList.remove("active");
    nav.classList.remove("open");
    overlay && overlay.classList.remove("open");
    hamburger.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    const isOpen = nav.classList.toggle("open");
    hamburger.classList.toggle("active", isOpen);
    overlay && overlay.classList.toggle("open", isOpen);
    hamburger.setAttribute("aria-expanded", String(isOpen));
  }

  hamburger.addEventListener("click", toggleMenu);
  overlay && overlay.addEventListener("click", closeMenu);

  // メニュー内のリンクをクリックしたら閉じる（スマホ操作性向上）
  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  // 画面幅を広げた際に開閉状態をリセット
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) closeMenu();
  });
})();


document.addEventListener('DOMContentLoaded', function() {
  
  // 1. トップへ戻るボタンの表示・非表示制御
  const pageTopBtn = document.getElementById('page-top');
  if (pageTopBtn) {
    window.addEventListener('scroll', function() {
      if (window.scrollY > 300) {
        pageTopBtn.classList.add('show');
      } else {
        pageTopBtn.classList.remove('show');
      }
    });
  }

  // 2. ページ遷移アニメーション（別ページへ行くときにフェードアウトさせる）
  const links = document.querySelectorAll('a[href]');
  links.forEach(link => {
    link.addEventListener('click', function(e) {
      const targetUrl = this.href;
      const currentUrl = window.location.origin;
      
      // 内部リンク（自分のサイト内）かつ、別タブで開かないリンクのみアニメーションを発火
      const isInternal = targetUrl.startsWith(currentUrl) || targetUrl.startsWith('/');
      const isAnchor = targetUrl.includes('#'); // ページ内リンク（トップへ戻るボタンなど）は除外
      const isBlank = this.target === '_blank';

      if (isInternal && !isAnchor && !isBlank) {
        e.preventDefault(); // 通常の瞬間移動をキャンセル
        document.body.classList.add('fade-out'); // フェードアウトのアニメーションを開始
        
        // アニメーションが終わる頃（300ミリ秒後）に実際のページ移動を行う
        setTimeout(() => {
          window.location.href = targetUrl;
        }, 300);
      }
    });
  });
});

// BFCache（ブラウザのバックボタン）対策：キャッシュから復元された際に透明状態を解除する
window.addEventListener('pageshow', function (event) {
  if (event.persisted || document.body.classList.contains('fade-out')) {
    document.body.classList.remove('fade-out');
  }
});