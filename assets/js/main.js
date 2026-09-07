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

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) closeMenu();
  });
})();


document.addEventListener('DOMContentLoaded', function() {
  
  document.querySelectorAll('img').forEach(img => {
    img.draggable = false;
  });

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

  // 外部リンク用モーダルの生成
  const modalHTML = `
    <div id="ext-link-modal" class="modal-overlay">
      <div class="modal-content">
        <h3 class="modal-title">外部サイトへ移動します</h3>
        <p class="modal-text">このサイトから離れますがよろしいですか？<br><span id="ext-link-url" class="modal-url"></span></p>
        <div class="modal-actions">
          <button id="ext-link-cancel" class="btn btn-outline">キャンセル</button>
          <button id="ext-link-proceed" class="btn">移動する</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modalOverlay = document.getElementById('ext-link-modal');
  const modalUrlText = document.getElementById('ext-link-url');
  const cancelBtn = document.getElementById('ext-link-cancel');
  const proceedBtn = document.getElementById('ext-link-proceed');

  let pendingUrl = '';
  let pendingTargetBlank = false;

  cancelBtn.addEventListener('click', () => {
    modalOverlay.classList.remove('show');
  });

  proceedBtn.addEventListener('click', () => {
    modalOverlay.classList.remove('show');
    if (pendingUrl) {
      if (pendingTargetBlank) {
        window.open(pendingUrl, '_blank');
      } else {
        window.location.href = pendingUrl;
      }
    }
  });

  document.body.addEventListener('click', function(e) {
    // モーダル内のボタンのクリック時はスキップ
    if (e.target.closest('#ext-link-modal')) return;

    const link = e.target.closest('a[href]');
    if (!link) return;

    const targetUrl = link.href;
    const currentUrl = window.location.origin;
    
    const isInternal = targetUrl.startsWith(currentUrl) || targetUrl.startsWith('/');
    const isAnchor = targetUrl.includes('#');
    const isBlank = link.target === '_blank';

    if (isInternal && !isAnchor && !isBlank) {
      e.preventDefault();
      document.body.classList.add('fade-out');
      
      setTimeout(() => {
        window.location.href = targetUrl;
      }, 300);
    } else if (!isInternal && targetUrl.startsWith('http')) {
      e.preventDefault();
      pendingUrl = targetUrl;
      pendingTargetBlank = isBlank;
      modalUrlText.textContent = targetUrl;
      modalOverlay.classList.add('show');
    }
  });
});

window.addEventListener('pageshow', function (event) {
  if (event.persisted || document.body.classList.contains('fade-out')) {
    document.body.classList.remove('fade-out');
  }
});

document.addEventListener('DOMContentLoaded', () => {
  const previewBox = document.createElement('div');
  previewBox.className = 'hover-preview-window';
  previewBox.innerHTML = `
    <img src="" alt="preview" id="hp-img">
    <p id="hp-text"></p>
  `;
  document.body.appendChild(previewBox);

  const hpImg = document.getElementById('hp-img');
  const hpText = document.getElementById('hp-text');

  const links = document.querySelectorAll('.news-item a');
  
  links.forEach(link => {
    link.addEventListener('mouseenter', () => {
      const previewData = link.querySelector('.news-preview-data');
      if (!previewData) return;
      
      const imgSrc = previewData.getAttribute('data-image');
      const text = previewData.getAttribute('data-text');

      if (imgSrc) {
        hpImg.src = imgSrc;
        hpImg.style.display = 'block';
      } else {
        hpImg.style.display = 'none';
      }

      if (text) {
        hpText.textContent = text;
        hpText.style.display = 'block';
      } else {
        hpText.style.display = 'none';
      }

      if (imgSrc || text) {
        previewBox.classList.add('show');
      }
    });

    link.addEventListener('mousemove', (e) => {
      const boxWidth = previewBox.offsetWidth || 300;
      const boxHeight = previewBox.offsetHeight || 250;
      
      let x = e.clientX + 15;
      let y = e.clientY + 15;
      
      if (x + boxWidth > window.innerWidth) {
        x = e.clientX - boxWidth - 15;
      }
      
      if (y + boxHeight > window.innerHeight) {
        y = e.clientY - boxHeight - 15;
      }
      
      previewBox.style.left = x + 'px';
      previewBox.style.top = y + 'px';
    });

    link.addEventListener('mouseleave', () => {
      previewBox.classList.remove('show');
    });
  });

  // Reveal Animation Observer
  const revealObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-active');
        // 一度アニメーションしたら監視を解除する
        observer.unobserve(entry.target);
      }
    });
  }, {
    rootMargin: '0px 0px -50px 0px', // 画面下部から50px入ったところで発火
    threshold: 0
  });

  // 記事内の h2タグ (Markdownの ## ) を自動的にリビールアニメーション構造に変換
  const postBodyH2List = document.querySelectorAll('.post-body h2');
  postBodyH2List.forEach(h2 => {
    if (!h2.querySelector('.reveal-wrapper')) {
      const originalText = h2.innerHTML;
      h2.innerHTML = `
        <span class="reveal-wrapper">
          <span class="reveal-box"></span>
          <span class="reveal-text">${originalText}</span>
        </span>
      `;
    }
  });

  // 初期ロード時の監視開始を関数化（フェードアニメーション後に実行するため）
  window.startScrollAnimations = () => {
    const revealElements = document.querySelectorAll('.reveal-wrapper, .fade-line-heading');
    revealElements.forEach(el => {
      revealObserver.observe(el);
    });

    document.querySelectorAll('.news-item, .link-category').forEach(setupStagger);
  };

  // -----------------------------------------------------
  // Stagger FadeIn Animation (パラパラ出現)
  // -----------------------------------------------------
  const staggerObserver = new IntersectionObserver((entries, observer) => {
    const intersecting = entries.filter(e => e.isIntersecting);
    intersecting.forEach((entry, index) => {
      // 少しずつタイミングをずらして表示
      entry.target.style.transitionDelay = `${index * 0.1}s`;
      entry.target.classList.add('is-fadein');
      observer.unobserve(entry.target);
    });
  }, {
    rootMargin: '0px 0px -30px 0px',
    threshold: 0
  });

  function setupStagger(element) {
    element.classList.add('stagger-item');
    staggerObserver.observe(element);
  }

  // 初回ロード時の適用は startScrollAnimations() で行うため削除

  // 非同期で追加される要素（Projectsなど）への自動適用
  const bodyObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.classList.contains('project-card')) {
            setupStagger(node);
          }
          if (node.querySelectorAll) {
            node.querySelectorAll('.project-card').forEach(setupStagger);
          }
        }
      });
    });
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

});

// -----------------------------------------------------
// -----------------------------------------------------
// Page Transition (Fade Animation)
// -----------------------------------------------------

// ページロード時：少し待ってからフェードアウトして画面を見せる
window.addEventListener('load', () => {
  // ローダーを少し見せるために0.4秒待つ
  setTimeout(() => {
    document.body.classList.remove('is-changing');
    
    // フェードアウト開始と同時にスクロールアニメーションの監視を開始する
    if (window.startScrollAnimations) {
      window.startScrollAnimations();
    }
  }, 400);
});

// BFCache対策（スマホ等のブラウザ「戻る」ボタンで戻ってきた時の処理）
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    // キャッシュからページが復元された場合は、即座にフェード画面を解除する
    document.body.classList.remove('is-changing');
  }
});

// リンククリック時：画面を白くフェードインさせてから遷移する
document.addEventListener('click', (e) => {
  const target = e.target.closest('a');
  if (!target) return;

  const href = target.getAttribute('href');
  const targetAttr = target.getAttribute('target');

  // 以下の場合は通常通りの動作（アニメーションさせない）
  if (!href || href.startsWith('#') || targetAttr === '_blank' || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return;
  }

  // 同一ドメイン内（または相対パス）のリンクならアニメーション発火
  if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../') || href.includes(window.location.host)) {
    e.preventDefault(); // デフォルトの遷移をキャンセル
    document.body.classList.add('is-changing'); // フェードレイヤーを表示

    // フェードインが終わるのを待ってからページ遷移
    setTimeout(() => {
      window.location.href = target.href;
    }, 500); // 0.5秒待つ (CSSのtransition 0.4s + 0.1sの余裕)
  }
});