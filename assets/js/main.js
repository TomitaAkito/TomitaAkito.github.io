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
  
  // ★ サイト内のすべての画像に対して、HTMLのドラッグ機能を強制的に「無効(false)」にする
  document.querySelectorAll('img').forEach(img => {
    img.draggable = false;
  });

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

// =========================================================
// マウス追従型 ニュースプレビュー機能
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  // 画面上に1つだけプレビュー用の「箱」を作る
  const previewBox = document.createElement('div');
  previewBox.className = 'hover-preview-window';
  previewBox.innerHTML = `
    <img src="" alt="preview" id="hp-img">
    <p id="hp-text"></p>
  `;
  document.body.appendChild(previewBox);

  const hpImg = document.getElementById('hp-img');
  const hpText = document.getElementById('hp-text');

  // 全てのニュースリンクを取得
  const links = document.querySelectorAll('.news-item a');
  
  links.forEach(link => {
    // 1. マウスが乗った時（データを取り出してウィンドウを表示）
    link.addEventListener('mouseenter', () => {
      const previewData = link.querySelector('.news-preview-data');
      if (!previewData) return;
      
      const imgSrc = previewData.getAttribute('data-image');
      const text = previewData.getAttribute('data-text');

      // 画像があれば表示
      if (imgSrc) {
        hpImg.src = imgSrc;
        hpImg.style.display = 'block';
      } else {
        hpImg.style.display = 'none';
      }

      // 文章があれば表示
      if (text) {
        hpText.textContent = text;
        hpText.style.display = 'block';
      } else {
        hpText.style.display = 'none';
      }

      // どちらかがあればウィンドウを表示
      if (imgSrc || text) {
        previewBox.classList.add('show');
      }
    });

    // 2. マウスが動いている時（カーソルの位置に合わせて追従・反転）
    link.addEventListener('mousemove', (e) => {
      // プレビューウィンドウの実際の幅と高さを取得
      const boxWidth = previewBox.offsetWidth || 300;
      const boxHeight = previewBox.offsetHeight || 250;
      
      // 基本はカーソルの「右下（+15px）」に配置
      let x = e.clientX + 15;
      let y = e.clientY + 15;
      
      // ① もし画面の「右端」にはみ出すなら、カーソルの「左側」に反転させる
      if (x + boxWidth > window.innerWidth) {
        x = e.clientX - boxWidth - 15;
      }
      
      // ② もし画面の「下端」にはみ出すなら、カーソルの「上側」に反転させる
      // （※ ①と組み合わせることで、右下で見切れる時は「左上」に表示されます）
      if (y + boxHeight > window.innerHeight) {
        y = e.clientY - boxHeight - 15;
      }
      
      // 計算したXとYの位置を適用
      previewBox.style.left = x + 'px';
      previewBox.style.top = y + 'px';
    });

    // 3. マウスが離れた時（ウィンドウを隠す）
    link.addEventListener('mouseleave', () => {
      previewBox.classList.remove('show');
    });
  });
});