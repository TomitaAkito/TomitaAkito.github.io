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
});