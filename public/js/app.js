// public/js/app.js — CellMart Core
const API = 'https://eudesenrolo-production.up.railway.app/api';


/* ─── Auth State ──────────────────────────────────────────────── */
const Auth = {
  getToken: () => localStorage.getItem('cm_token') || sessionStorage.getItem('cm_token'),
  getUser:  () => { try { return JSON.parse(localStorage.getItem('cm_user')); } catch { return null; } },
  isLoggedIn() {
    // Usa a mesma chave que o getToken()
    const token = localStorage.getItem('cm_token') || sessionStorage.getItem('cm_token');
    
    if (!token) return false;

    try {
        // Verifica expiração se for JWT
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp * 1000 < Date.now()) {
            this.logout();
            return false;
        }
        return true;
    } catch(e) {
        // Se não conseguir ler como JWT, considera válido se o token existir
        return true;
    }
},
  isAdmin:    () => Auth.getUser()?.role === 'admin',

  login(token, user) {
    if (!token) {
        console.error("❌ Tentativa de login sem token");
        return;
    }

    console.log("✅ Salvando token:", token.substring(0, 50) + "...");

    // Salva nas duas storages
    localStorage.setItem('cm_token', token);
    sessionStorage.setItem('cm_token', token);

    if (user) {
        localStorage.setItem('cm_user', JSON.stringify(user));
        sessionStorage.setItem('cm_user', JSON.stringify(user));
    }

    UI.updateNavAuth();
    console.log("✅ Login concluído com sucesso");
},

logout() {
    console.log("🚪 Fazendo logout...");
    localStorage.removeItem('cm_token');
    localStorage.removeItem('cm_user');
    sessionStorage.removeItem('cm_token');
    sessionStorage.removeItem('cm_user');
    
    UI.updateNavAuth();
    window.location.href = '/pages/login.html';
  }
};

/* ─── HTTP Client ─────────────────────────────────────────────── */
const Http = {
  async request(method, url, data = null, multipart = false) {
    const headers = {};
    const token = Auth.getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const opts = { method, headers };
    if (data) {
      if (multipart) {
        opts.body = data; // FormData
      } else {
        headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(data);
      }
    }

    const res = await fetch(API + url, opts);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw { status: res.status, ...json };
    }
    return json;
  },
  get:    (url)          => Http.request('GET', url),
  post:   (url, data)    => Http.request('POST', url, data),
  put:    (url, data)    => Http.request('PUT', url, data),
  delete: (url)          => Http.request('DELETE', url),
  upload: (url, formData)=> Http.request('POST', url, formData, true),
  uploadPut: (url, formData)=> Http.request('PUT', url, formData, true),
};

/* ─── UI Helpers ──────────────────────────────────────────────── */
const UI = {
  /* Toast */
  toast(msg, type = 'info', duration = 3500) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    let c = document.querySelector('.toast-container');
    if (!c) {
      c = document.createElement('div');
      c.className = 'toast-container';
      document.body.appendChild(c);
    }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span class="toast-icon">${icons[type]||icons.info}</span><span>${msg}</span><button class="toast-close">×</button>`;
    t.querySelector('.toast-close').onclick = () => t.remove();
    c.appendChild(t);
    setTimeout(() => t.style.opacity = '0', duration - 400);
    setTimeout(() => t.remove(), duration);
    return t;
  },

  /* Confirm modal */
  confirm(msg, onConfirm, label = 'Confirmar') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-body" style="padding:28px 24px 20px;text-align:center">
          <div style="font-size:2.5rem;margin-bottom:12px">⚠️</div>
          <p style="font-size:.95rem;color:var(--dark-2)">${msg}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cnl">Cancelar</button>
          <button class="btn btn-danger" id="cnf">${label}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#cnl').onclick = () => overlay.remove();
    overlay.querySelector('#cnf').onclick = () => { overlay.remove(); onConfirm(); };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  },

  /* Loading overlay */
  showLoading() {
    let el = document.getElementById('global-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'global-loading';
      el.className = 'loading-overlay';
      el.innerHTML = '<div class="spinner"></div>';
      document.body.appendChild(el);
    }
    el.style.display = 'flex';
  },
  hideLoading() {
    const el = document.getElementById('global-loading');
    if (el) el.style.display = 'none';
  },

  /* Format price */
  formatPrice(v) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
  },

  /* Format date */
  formatDate(str) {
    if (!str) return '';
    const d = new Date(str);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000)    return 'agora';
    if (diff < 3600000)  return `${Math.floor(diff/60000)}min`;
    if (diff < 86400000) return `${Math.floor(diff/3600000)}h`;
    if (diff < 604800000)return `${Math.floor(diff/86400000)}d`;
    return d.toLocaleDateString('pt-BR');
  },

  /* Stars HTML */
  stars(rating, showNum = true) {
    const r = parseFloat(rating) || 0;
    let s = '';
    for (let i = 1; i <= 5; i++) {
      s += i <= Math.round(r) ? '★' : '☆';
    }
    return `<span class="stars">${s}</span>${showNum ? ` <span style="font-size:.8rem;color:var(--mid)">${r.toFixed(1)}</span>` : ''}`;
  },

  /* Condition badge */
  conditionBadge(c) {
    const map = { novo:'Novo', seminovo:'Seminovo', usado:'Usado', pecas:'Peças' };
    return `<span class="condition-badge condition-${c}">${map[c]||c}</span>`;
  },

  /* Build product card HTML */
  productCard(p, showFav = true) {
    const img = p.primary_image
      ? `<img src="${API.replace('/api','')}${p.primary_image}" alt="${p.title}" loading="lazy" class="lazy" onload="this.classList.add('loaded')">`
      : `<div class="no-img">📷</div>`;
    return `
      <div class="product-card${p.featured ? ' featured' : ''}" onclick="window.location.href='/pages/product.html?id=${p.id}'">
        <div class="product-card-img">
          ${img}
          ${showFav ? `<button class="fav-btn${p._fav?' active':''}" onclick="event.stopPropagation();toggleFav('${p.id}',this)" title="Favoritar">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>` : ''}
        </div>
        <div class="product-card-body">
          <div class="product-card-title">${p.title}</div>
          <div class="product-card-price">${UI.formatPrice(p.price)}${p.price_negotiable?'<small> · Negociável</small>':''}</div>
          <div class="product-card-meta">
            ${UI.conditionBadge(p.condition)}
            ${p.city ? `<span>📍 ${p.city}${p.state?', '+p.state:''}</span>` : ''}
          </div>
        </div>
      </div>`;
  },

  /* Skeleton cards */
  skeletonCards(n = 8) {
    return Array(n).fill(0).map(() => `
      <div class="product-card">
        <div class="product-card-img skeleton" style="padding-top:70%"></div>
        <div class="product-card-body">
          <div class="skeleton" style="height:14px;margin-bottom:8px;border-radius:4px"></div>
          <div class="skeleton" style="height:14px;width:60%;margin-bottom:8px;border-radius:4px"></div>
          <div class="skeleton" style="height:12px;width:40%;border-radius:4px"></div>
        </div>
      </div>`).join('');
  },

  /* Update header auth state */
  updateNavAuth() {
    const user = Auth.getUser();
    const loginEl  = document.getElementById('nav-login');
    const userEl   = document.getElementById('nav-user');
    const adminEl  = document.getElementById('nav-admin');
    const nameEl   = document.getElementById('nav-user-name');

    if (user) {
      if (loginEl)  loginEl.classList.add('hidden');
      if (userEl)   userEl.classList.remove('hidden');
      if (nameEl)   nameEl.textContent = user.name.split(' ')[0];
      if (adminEl && user.role === 'admin') adminEl.classList.remove('hidden');
      else if (adminEl) adminEl.classList.add('hidden');
    } else {
      if (loginEl)  loginEl.classList.remove('hidden');
      if (userEl)   userEl.classList.add('hidden');
      if (adminEl)  adminEl.classList.add('hidden');
    }
  },

  /* Handle form errors from API */
  showFormErrors(errors, formEl) {
    formEl.querySelectorAll('.form-error').forEach(el => el.remove());
    formEl.querySelectorAll('.form-control').forEach(el => el.classList.remove('error'));
    if (!errors) return;
    const arr = Array.isArray(errors) ? errors : [errors];
    arr.forEach(e => {
      const msg = typeof e === 'string' ? e : e.msg || e.message;
      const el = document.createElement('div');
      el.className = 'form-error';
      el.textContent = msg;
      const last = formEl.querySelector('.form-group:last-of-type');
      if (last) last.appendChild(el);
    });
  }
};

/* ─── Lazy Images Observer ────────────────────────────────────── */
const lazyObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      if (img.dataset.src) { img.src = img.dataset.src; }
      img.classList.add('loaded');
      lazyObserver.unobserve(img);
    }
  });
});

/* ─── Favorites (global) ──────────────────────────────────────── */
async function toggleFav(productId, btn) {
  if (!Auth.isLoggedIn()) {
    openLoginModal();
    return;
  }
  try {
    const { favorited } = await Http.post(`/products/${productId}/favorite`);
    btn.classList.toggle('active', favorited);
    UI.toast(favorited ? '💛 Adicionado aos favoritos' : 'Removido dos favoritos', 'info', 2000);
  } catch (err) {
    UI.toast(err.error || 'Erro', 'error');
  }
}

/* ─── Search Autocomplete ─────────────────────────────────────── */
function initAutocomplete(inputEl, listEl, onSelect) {
  let debounce;
  inputEl.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = inputEl.value.trim();
    if (q.length < 2) { listEl.innerHTML = ''; listEl.classList.add('hidden'); return; }
    debounce = setTimeout(async () => {
      try {
        const results = await Http.get(`/products/autocomplete?q=${encodeURIComponent(q)}`);
        if (!results.length) { listEl.innerHTML = ''; listEl.classList.add('hidden'); return; }
        listEl.innerHTML = results.map(r =>
          `<li onclick="selectSuggestion('${r.replace(/'/g,"\\'")}')">🔍 ${r}</li>`
        ).join('');
        listEl.classList.remove('hidden');
        window._autocompleteInput = inputEl;
        window._autocompleteSelect = onSelect;
      } catch { }
    }, 250);
  });
  document.addEventListener('click', e => {
    if (!listEl.contains(e.target) && e.target !== inputEl) {
      listEl.innerHTML = '';
      listEl.classList.add('hidden');
    }
  });
}
function selectSuggestion(val) {
  if (window._autocompleteInput) window._autocompleteInput.value = val;
  document.querySelectorAll('.autocomplete-list').forEach(el => { el.innerHTML=''; el.classList.add('hidden'); });
  if (window._autocompleteSelect) window._autocompleteSelect(val);
}

/* ─── Carousel ────────────────────────────────────────────────── */
function initCarousel(el) {
  const track   = el.querySelector('.carousel-track');
  const slides  = el.querySelectorAll('.carousel-slide');
  const dots    = el.querySelectorAll('.carousel-dot');
  const countEl = el.querySelector('.carousel-count');
  let current = 0;

  function go(n) {
    current = ((n % slides.length) + slides.length) % slides.length;
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
    if (countEl) countEl.textContent = `${current+1}/${slides.length}`;
  }

  el.querySelector('.carousel-btn.prev')?.addEventListener('click', () => go(current - 1));
  el.querySelector('.carousel-btn.next')?.addEventListener('click', () => go(current + 1));
  dots.forEach((d, i) => d.addEventListener('click', () => go(i)));

  // Touch swipe
  let startX;
  track.addEventListener('touchstart', e => startX = e.touches[0].clientX);
  track.addEventListener('touchend',   e => {
    const dx = e.changedTouches[0].clientX - startX;
    if (Math.abs(dx) > 40) go(current + (dx < 0 ? 1 : -1));
  });

  go(0);
}

/* ─── Pagination ──────────────────────────────────────────────── */
function renderPagination(container, current, total, onChange) {
  if (total <= 1) { container.innerHTML = ''; return; }
  let html = `<button class="page-btn" onclick="(${onChange})(${current-1})" ${current<=1?'disabled':''}>‹</button>`;
  for (let i = 1; i <= total; i++) {
    if (total > 7 && Math.abs(i - current) > 2 && i !== 1 && i !== total) {
      if (i === 2 || i === total - 1) html += '<span style="padding:0 4px;color:var(--mid)">…</span>';
      continue;
    }
    html += `<button class="page-btn${i===current?' active':''}" onclick="(${onChange})(${i})">${i}</button>`;
  }
  html += `<button class="page-btn" onclick="(${onChange})(${current+1})" ${current>=total?'disabled':''}>›</button>`;
  container.innerHTML = html;
}

/* ─── Notification Polling ────────────────────────────────────── */
async function pollNotifications() {
    if (!Auth.isLoggedIn()) return;

    try {
        const token = Auth.getToken();
        if (!token) return;

        const [notif, msgs] = await Promise.all([
            Http.get('/notifications'),
            Http.get('/messages/unread/count')
        ]);

        const total = (notif?.unread || 0) + (msgs?.count || 0);
        const badge = document.getElementById('notif-badge');
        const msgBadge = document.getElementById('msg-badge');

        if (badge) {
            badge.textContent = notif.unread || 0;
            badge.classList.toggle('hidden', (notif.unread || 0) === 0);
        }
        if (msgBadge) {
            msgBadge.textContent = msgs.count || 0;
            msgBadge.classList.toggle('hidden', (msgs.count || 0) === 0);
        }
    } catch (err) {
        console.warn("Erro ao buscar notificações:", err);
        // Não faz logout em caso de erro temporário
    }
}

/* ─── Modal: Login ────────────────────────────────────────────── */
function openLoginModal() {
  if (document.getElementById('login-modal')) return;
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.id = 'login-modal';
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Entrar na Eudesenrolo</h3>
        <button class="modal-close" onclick="document.getElementById('login-modal').remove()">×</button>
      </div>
      <div class="modal-body">
        <form id="quick-login-form">
          <div class="form-group">
            <label class="form-label">E-mail <span class="req">*</span></label>
            <input type="email" name="email" class="form-control" placeholder="seu@email.com" required>
          </div>
          <div class="form-group">
            <label class="form-label">Senha <span class="req">*</span></label>
            <input type="password" name="password" class="form-control" placeholder="••••••" required>
          </div>
          <div id="quick-login-error" class="alert alert-error hidden"></div>
          <button type="submit" class="btn btn-primary btn-full btn-lg">Entrar</button>
        </form>
        <p style="text-align:center;margin-top:16px;font-size:.875rem;color:var(--mid)">
          Não tem conta? <a href="/pages/register.html" style="color:var(--brand);font-weight:600">Cadastre-se</a>
        </p>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };

  modal.querySelector('#quick-login-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const errEl = modal.querySelector('#quick-login-error');
    try {
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Entrando…';
      const { token, user } = await Http.post('/auth/login', { email: fd.get('email'), password: fd.get('password') });
      Auth.login(token, user);
      modal.remove();
      UI.toast(`Bem-vindo, ${user.name.split(' ')[0]}! 👋`, 'success');
      setTimeout(() => location.reload(), 500);
    } catch (err) {
      errEl.textContent = err.error || 'Credenciais inválidas';
      errEl.classList.remove('hidden');
      e.target.querySelector('button[type=submit]').disabled = false;
      e.target.querySelector('button[type=submit]').textContent = 'Entrar';
    }
  };
}

/* ─── Init on DOMContentLoaded ────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
    UI.updateNavAuth();

    // Espera um pouco para garantir que o Auth está pronto
    setTimeout(() => {
        if (Auth.isLoggedIn()) {
            pollNotifications();
            setInterval(pollNotifications, 30000);
        }
    }, 800);

    // Hamburger
    const hamburger = document.querySelector('.hamburger');
    const mobileNav = document.querySelector('.mobile-nav');
    if (hamburger && mobileNav) {
        hamburger.addEventListener('click', () => {
            hamburger.classList.toggle('open');
            mobileNav.classList.toggle('open');
        });
    }

  // Header search
  const headerSearch = document.getElementById('header-search');
  const headerList   = document.getElementById('header-autocomplete');
  if (headerSearch && headerList) {
    initAutocomplete(headerSearch, headerList, (val) => {
      window.location.href = `/pages/search.html?q=${encodeURIComponent(val)}`;
    });
    document.getElementById('header-search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = headerSearch.value.trim();
      if (q) window.location.href = `/pages/search.html?q=${encodeURIComponent(q)}`;
    });
  }

  // Start notification polling
  if (Auth.isLoggedIn()) {
    pollNotifications();
    setInterval(pollNotifications, 30000);
  }

  // Carousels
  document.querySelectorAll('.carousel').forEach(initCarousel);
});
