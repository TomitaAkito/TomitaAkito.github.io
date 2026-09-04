(function () {
  const profileEl = document.getElementById("profile-content");
  const projectsEl = document.getElementById("project-grid");

  if (!profileEl && !projectsEl) return;

  const GITHUB_USERNAME =
    (projectsEl && projectsEl.dataset.username) ||
    (profileEl && profileEl.dataset.username) ||
    "TomitaAkito";

  const README_URL = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${GITHUB_USERNAME}/main/README.md`;
  const REPOS_API_URL = `https://api.github.com/users/${GITHUB_USERNAME}/repos?sort=updated&per_page=100`;

  async function renderProfile() {
    if (!profileEl) return;
    try {
      const res = await fetch(README_URL);
      if (!res.ok) throw new Error(`README取得に失敗しました (status: ${res.status})`);
      const markdown = await res.text();

      if (window.marked) {
        profileEl.innerHTML = window.marked.parse(markdown);
      } else {
        const pre = document.createElement("pre");
        pre.textContent = markdown;
        profileEl.innerHTML = "";
        profileEl.appendChild(pre);
      }
    } catch (err) {
      profileEl.innerHTML = `<p class="loading-text">プロフィールの読み込みに失敗しました。時間をおいて再度お試しください。</p>`;
      console.error(err);
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  async function renderProjects() {
    if (!projectsEl) return;
    try {
      const res = await fetch(REPOS_API_URL);
      if (!res.ok) throw new Error(`リポジトリ取得に失敗しました (status: ${res.status})`);
      let repos = await res.json();

      const excludeRepos = ['TomitaAkito', 'TomitaAkito.github.io', 'zisaku'];

      repos = repos
        .filter((repo) => !repo.fork)
        .filter((repo) => !excludeRepos.includes(repo.name))
        .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at));

      if (repos.length === 0) {
        projectsEl.innerHTML = `<p class="loading-text">公開リポジトリが見つかりませんでした。</p>`;
        return;
      }

      projectsEl.innerHTML = repos
        .map((repo) => {
          const desc = repo.description
            ? escapeHtml(repo.description)
            : "説明はまだありません。";
          const lang = repo.language ? escapeHtml(repo.language) : "N/A";

          return `
            <a class="project-card" href="${repo.html_url}" target="_blank" rel="noopener noreferrer">
              <div class="project-card-header">
                <span class="project-name">${escapeHtml(repo.name)}</span>
                <svg class="project-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
              </div>
              <p class="project-desc">${desc}</p>
              <div class="project-meta">
                <span><span class="lang-dot"></span>${lang}</span>
                <span>&#9733; ${repo.stargazers_count}</span>
              </div>
            </a>
          `;
        })
        .join("");
    } catch (err) {
      projectsEl.innerHTML = `<p class="loading-text">プロジェクト一覧の読み込みに失敗しました。時間をおいて再度お試しください。</p>`;
      console.error(err);
    }
  }

  renderProfile();
  renderProjects();
})();