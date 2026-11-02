(function () {
  'use strict';

  let searchData = null;
  let isLoading = false;
  let selectedIndex = -1;

  const modal = document.getElementById('search-modal');
  if (!modal) return;

  const input = document.getElementById('search-modal-input');
  const clearBtn = document.getElementById('search-modal-clear');
  const closeBtn = document.getElementById('search-modal-close');
  const resultsList = document.getElementById('search-modal-results');
  const emptyState = document.getElementById('search-modal-empty');
  const hintsState = document.getElementById('search-modal-hints');
  const allLink = document.getElementById('search-modal-all-link');

  const pcOpenBtn = document.getElementById('header-search-btn');
  const mobileOpenBtn = document.getElementById('mobile-search-btn');
  const footerOpenBtn = document.getElementById('footer-search-btn');

  // 検索データを読み込む（1度だけFetch）
  async function loadSearchData() {
    if (searchData || isLoading) return;
    isLoading = true;
    try {
      const res = await fetch('/assets/search-data.json');
      if (res.ok) {
        searchData = await res.json();
      }
    } catch (e) {
      console.error('Failed to load search data:', e);
    } finally {
      isLoading = false;
    }
  }

  // モーダルを開く
  function openModal() {
    loadSearchData();
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      input.focus();
      input.select();
    }, 50);

    // すでに入力がある場合は検索実行
    if (input.value.trim()) {
      executeSearch(input.value.trim());
    } else {
      showHints();
    }
  }

  // モーダルを閉じる
  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  // ヒント状態の表示
  function showHints() {
    resultsList.style.display = 'none';
    emptyState.style.display = 'none';
    hintsState.style.display = 'block';
    clearBtn.style.display = 'none';
    selectedIndex = -1;
    if (allLink) {
      allLink.href = '/news.html';
      allLink.textContent = 'News一覧ページへ →';
    }
  }

  // テキストのハイライト処理
  function highlightText(text, terms) {
    if (!text || !terms || terms.length === 0) return escapeHTML(text || '');
    let escaped = escapeHTML(text);
    terms.forEach(term => {
      if (!term) return;
      const regex = new RegExp(`(${escapeRegex(term)})`, 'gi');
      escaped = escaped.replace(regex, '<mark class="search-highlight">$1</mark>');
    });
    return escaped;
  }

  function escapeHTML(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 検索の実行
  function executeSearch(query) {
    if (!query) {
      showHints();
      return;
    }

    clearBtn.style.display = 'block';
    hintsState.style.display = 'none';

    if (allLink) {
      allLink.href = `/news.html?q=${encodeURIComponent(query)}`;
      allLink.textContent = `News一覧で「${query}」を絞り込む →`;
    }

    if (!searchData) {
      // まだデータ読み込み中
      return;
    }

    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = searchData.filter(item => {
      const title = (item.title || '').toLowerCase();
      const content = (item.content || '').toLowerCase();
      const categories = (item.categories || []).join(' ').toLowerCase();
      const date = (item.date || '').toLowerCase();
      const type = (item.type || '').toLowerCase();

      return terms.every(term => 
        title.includes(term) || 
        content.includes(term) || 
        categories.includes(term) ||
        date.includes(term) ||
        type.includes(term)
      );
    });

    renderResults(matches, terms);
  }

  // 結果リストのレンダリング
  function renderResults(items, terms) {
    resultsList.innerHTML = '';
    selectedIndex = -1;

    if (items.length === 0) {
      resultsList.style.display = 'none';
      emptyState.style.display = 'block';
      return;
    }

    emptyState.style.display = 'none';
    resultsList.style.display = 'block';

    items.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'search-result-item';
      li.setAttribute('data-index', index);

      // 種別バッジ（News, Research, Demo, Page）
      const typeStr = item.type || 'Page';
      const typeClass = typeStr.toLowerCase();
      const typeBadge = `<span class="search-type-badge search-type-${typeClass}">${escapeHTML(typeStr)}</span>`;

      // カテゴリ・タグバッジ生成
      const catBadges = (item.categories || []).map(cat => 
        `<span class="news-category" data-cat="${escapeHTML(cat)}">${escapeHTML(cat)}</span>`
      ).join(' ');

      // マッチ抜粋の作成
      let snippet = item.content || '';
      if (terms.length > 0) {
        const firstTerm = terms[0];
        const termPos = snippet.toLowerCase().indexOf(firstTerm);
        if (termPos !== -1) {
          const start = Math.max(0, termPos - 30);
          const end = Math.min(snippet.length, termPos + 70);
          snippet = (start > 0 ? '...' : '') + snippet.substring(start, end) + (end < snippet.length ? '...' : '');
        } else {
          snippet = snippet.substring(0, 90) + (snippet.length > 90 ? '...' : '');
        }
      }

      // 日付の表示（日付がある場合、またはNews/Researchの場合）
      let dateHtml = '';
      if (item.date && item.date !== 'DEMO' && item.date !== 'PAGE') {
        dateHtml = `<span class="search-result-date">${escapeHTML(item.date)}</span>`;
      }

      li.innerHTML = `
        <a href="${item.url}" class="search-result-link">
          <div class="search-result-meta">
            ${typeBadge}
            ${dateHtml}
            <div class="search-result-categories">${catBadges}</div>
          </div>
          <div class="search-result-title">${highlightText(item.title, terms)}</div>
          <div class="search-result-snippet">${highlightText(snippet, terms)}</div>
        </a>
      `;

      li.addEventListener('mouseenter', () => {
        setSelectedIndex(index);
      });

      resultsList.appendChild(li);
    });
  }

  function setSelectedIndex(index) {
    const items = resultsList.querySelectorAll('.search-result-item');
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('is-selected');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('is-selected');
      }
    });
    selectedIndex = index;
  }

  // イベント登録
  if (pcOpenBtn) pcOpenBtn.addEventListener('click', openModal);
  if (mobileOpenBtn) mobileOpenBtn.addEventListener('click', openModal);
  if (footerOpenBtn) footerOpenBtn.addEventListener('click', openModal);

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      input.focus();
      showHints();
    });
  }

  // 入力イベント
  let debounceTimer = null;
  input.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      executeSearch(this.value.trim());
    }, 150);
  });

  // キーボードナビゲーション
  input.addEventListener('keydown', function (e) {
    const items = resultsList.querySelectorAll('.search-result-item');

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        const next = selectedIndex + 1 >= items.length ? 0 : selectedIndex + 1;
        setSelectedIndex(next);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        const prev = selectedIndex - 1 < 0 ? items.length - 1 : selectedIndex - 1;
        setSelectedIndex(prev);
      }
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && items[selectedIndex]) {
        e.preventDefault();
        const link = items[selectedIndex].querySelector('a');
        if (link) link.click();
      } else if (items.length > 0) {
        // 先頭へ
        e.preventDefault();
        const link = items[0].querySelector('a');
        if (link) link.click();
      } else if (input.value.trim()) {
        // News一覧へジャンプ
        window.location.href = `/news.html?q=${encodeURIComponent(input.value.trim())}`;
      }
    }
  });

  // ヒントタグのクリック
  modal.addEventListener('click', (e) => {
    const tagBtn = e.target.closest('.search-hint-tag');
    if (tagBtn) {
      const q = tagBtn.getAttribute('data-query');
      if (q) {
        input.value = q;
        executeSearch(q);
        input.focus();
      }
    }
  });

  // グローバルショートカット (Ctrl+K, Cmd+K, ESC)
  document.addEventListener('keydown', function (e) {
    // Ctrl+K / Cmd+K
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (modal.classList.contains('is-open')) {
        closeModal();
      } else {
        openModal();
      }
    }

    // ESCキーで閉じる
    if (e.key === 'Escape' && modal.classList.contains('is-open')) {
      e.preventDefault();
      closeModal();
    }

    // '/' キー（他のinput要素フォーカス時を除く）
    if (e.key === '/' && !modal.classList.contains('is-open')) {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      if (!isInput) {
        e.preventDefault();
        openModal();
      }
    }
  });

  // ページ初期ロード時にあらかじめバックグラウンドでデータ取得を開始
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(loadSearchData);
  } else {
    setTimeout(loadSearchData, 1000);
  }
})();
