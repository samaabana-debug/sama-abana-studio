/* Espace admin — Motion Design by Sama Abana
   Les fichiers partent directement du téléphone vers Cloudinary (par morceaux de 6 Mo,
   avec reprise automatique), puis le projet est enregistré dans la base du site.
   Tout le texte venant de la base est inséré avec textContent : jamais de HTML. */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const KEY = 'sama-admin-token';
  const CATEGORIES = {
    '2d_animation': 'Animation 2D',
    '3d_animation': 'Animation 3D',
    'ui_ux_motion': 'UI/UX motion',
    'vfx_compositing': 'VFX & compositing',
  };
  const RATIOS = {
    '9:16': 'Vertical 9:16 (Reels, TikTok, Stories)',
    '4:5': 'Portrait 4:5 (publication Instagram)',
    '1:1': 'Carré 1:1',
    '16:9': 'Horizontal 16:9 (YouTube, écran)',
  };
  const STATUS = { pending: 'Nouveau', in_review: 'En cours', approved: 'Accepté', rejected: 'Refusé' };
  const ICON = {
    up: 'M12 19V5m0 0-6 6m6-6 6 6',
    down: 'M12 5v14m0 0-6-6m6 6 6-6',
    eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z',
    edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
    video: 'M4 6h11v12H4zM15 10l5-3v10l-5-3',
    image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9.5a1.5 1.5 0 1 0 0-.01',
    wa: 'M4 20l1.3-4A8 8 0 1 1 8 18.7L4 20Z',
    mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  };

  /* ------------------------------------------------------------ outils */
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
    return el;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', ICON[name]);
    svg.append(path);
    return svg;
  }
  const store = {
    get() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || ''; } catch { return ''; } },
    set(v, remember) {
      try { (remember ? localStorage : sessionStorage).setItem(KEY, v); (remember ? sessionStorage : localStorage).removeItem(KEY); } catch { /* navigation privée */ }
    },
    clear() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* rien */ } },
  };
  const mb = (bytes) => (bytes / 1048576).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' Mo';
  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function nearestRatio(w, hgt) {
    if (!w || !hgt) return '9:16';
    const r = w / hgt;
    return Object.keys(RATIOS).reduce((best, a) => {
      const [x, y] = a.split(':').map(Number);
      return Math.abs(Math.log(r / (x / y))) < best.d ? { a, d: Math.abs(Math.log(r / (x / y))) } : best;
    }, { a: '9:16', d: Infinity }).a;
  }

  let toastTimer = 0;
  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('is-error', isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3500);
  }

  function confirmBox(title, text, okLabel = 'Confirmer') {
    const dlg = $('#confirm');
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = okLabel;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  /* ------------------------------------------------------------ API du site */
  let token = store.get();
  class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        headers: { 'X-Admin-Token': token, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        cache: 'no-store',
      });
    } catch {
      throw new ApiError('Connexion impossible. Vérifie ta connexion internet puis réessaie.', 0);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* réponse vide */ }
    if (!res.ok) {
      const d = data?.detail;
      const msg = typeof d === 'string' ? d : Array.isArray(d) ? d.map((e) => e.msg).join(' ') : `Erreur ${res.status}`;
      throw new ApiError(msg, res.status);
    }
    return data;
  }

  // Une erreur pendant l'utilisation : mot de passe changé → retour à la connexion.
  function fail(err) {
    if (err.status === 401) { logout('Ton mot de passe a changé ou a expiré. Reconnecte-toi.'); return; }
    toast(err.message || 'Une erreur est survenue.', true);
  }

  /* ------------------------------------------------------------ connexion */
  const state = { projects: [], quotes: [], status: null, maintenance: null, tab: 'works' };

  function show(view) {
    $('#boot').hidden = true;
    $('#login').hidden = view !== 'login';
    $('#app').hidden = view !== 'app';
    $('#logout').hidden = view !== 'app';
  }

  function logout(message) {
    token = '';
    store.clear();
    show('login');
    const err = $('#login-error');
    err.textContent = message || '';
    err.hidden = !message;
    $('#pw').value = '';
  }

  $('#pw-toggle').addEventListener('click', (e) => {
    const input = $('#pw'), on = input.type === 'password';
    input.type = on ? 'text' : 'password';
    e.currentTarget.textContent = on ? 'Masquer' : 'Afficher';
    e.currentTarget.setAttribute('aria-pressed', String(on));
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#login-error'), btn = $('#login-btn');
    const value = $('#pw').value.trim();
    err.hidden = true;
    if (!value) { err.textContent = 'Colle ton mot de passe administrateur.'; err.hidden = false; return; }
    token = value;
    btn.disabled = true; btn.textContent = 'Connexion…';
    try {
      state.status = await api('/api/admin/status');
      store.set(value, $('#remember').checked);
      await enter();
    } catch (ex) {
      token = '';
      err.textContent = ex.status === 401 ? 'Mot de passe incorrect. Vérifie que tu as tout copié, sans espace.' : ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = 'Se connecter';
    }
  });

  $('#logout').addEventListener('click', () => logout());

  async function enter() {
    show('app');
    renderBanner();
    await Promise.all([loadProjects(), loadQuotes(), loadMaintenance()]);
    renderSettings();
  }

  async function boot() {
    if (!token) { show('login'); return; }
    try {
      state.status = await api('/api/admin/status');
      await enter();
    } catch (err) {
      if (err.status === 401) logout(); else { show('login'); const e = $('#login-error'); e.textContent = err.message; e.hidden = false; }
    }
  }

  /* ------------------------------------------------------------ onglets */
  document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.tab)));
  function selectTab(name) {
    state.tab = name;
    document.querySelectorAll('.tab-btn').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    ['works', 'quotes', 'site'].forEach((t) => { $(`#tab-${t}`).hidden = t !== name; });
    if (name === 'quotes') loadQuotes().catch(fail);
    if (name === 'site') Promise.all([refreshStatus(), loadMaintenance()]).then(renderSettings).catch(fail);
  }

  async function refreshStatus() { state.status = await api('/api/admin/status'); renderBanner(); }

  function renderBanner() {
    const s = state.status, b = $('#banner');
    b.replaceChildren();
    const add = $('#add-btn');
    if (s && !s.storage_ready) {
      b.append(h('strong', { text: 'Stockage des vidéos pas encore activé. ' }),
        s.storage_error || 'Ajoute la clé CLOUDINARY_URL dans Render > Environment pour pouvoir envoyer des fichiers.');
      b.hidden = false;
      add.disabled = true;
    } else {
      b.hidden = true;
      add.disabled = false;
    }
  }

  /* ------------------------------------------------------------ travaux */
  async function loadProjects() {
    state.projects = await api('/api/admin/projects');
    renderProjects();
  }

  function renderProjects() {
    const list = $('#works');
    list.replaceChildren(...state.projects.map((p, i) => workItem(p, i)));
    $('#works-empty').hidden = state.projects.length > 0;
    $('#count-works').textContent = state.projects.length ? String(state.projects.length) : '';
  }

  function workItem(p, i) {
    const last = i === state.projects.length - 1;
    const badges = [];
    if (p.is_featured) badges.push(h('span', { class: 'badge badge--key', text: 'À la une' }));
    badges.push(p.is_published ? h('span', { class: 'badge badge--ok', text: 'En ligne' }) : h('span', { class: 'badge', text: 'Masqué' }));
    badges.push(h('span', { class: 'badge', text: p.aspect_ratio }));
    const act = (label, iconName, onclick, extra = {}) =>
      h('button', { class: 'act' + (extra.cls ? ' ' + extra.cls : ''), type: 'button', 'aria-label': extra.aria || label, disabled: extra.disabled, onclick },
        icon(iconName), extra.iconOnly ? null : label);
    return h('li', { class: 'work' + (p.is_published ? '' : ' is-hidden') },
      h('div', { class: 'work__thumb-wrap' },
        h('img', { class: 'work__thumb', src: p.cover_image_url, alt: '', loading: 'lazy', decoding: 'async' }),
        h('span', { class: 'work__kind', title: p.media_type === 'image' ? 'Photo' : 'Vidéo' }, icon(p.media_type === 'image' ? 'image' : 'video'))),
      h('div', { class: 'work__info' },
        h('h3', { class: 'work__title', text: p.title }),
        h('p', { class: 'work__meta', text: [CATEGORIES[p.category] || p.category_label, p.client].filter(Boolean).join(' · ') }),
        h('div', { class: 'badges' }, badges)),
      h('div', { class: 'work__actions' },
        act('Monter', 'up', () => move(i, -1), { disabled: i === 0, aria: `Monter « ${p.title} »` }),
        act('Descendre', 'down', () => move(i, 1), { disabled: last, aria: `Descendre « ${p.title} »` }),
        act(p.is_published ? 'Masquer' : 'Afficher', p.is_published ? 'eyeOff' : 'eye', () => patch(p, { is_published: !p.is_published },
          p.is_published ? 'Masqué : il n\'apparaît plus sur le site.' : 'Visible sur le site.')),
        act('À la une', 'star', () => patch(p, { is_featured: !p.is_featured }, p.is_featured ? 'Retiré de la une.' : 'Mis à la une, en premier sur le site.'),
          { cls: p.is_featured ? 'is-on' : '' }),
        act('Modifier', 'edit', () => editor.open(p), {})));
  }

  async function move(i, delta) {
    const list = state.projects.slice();
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    state.projects = list;
    renderProjects();
    try {
      state.projects = await api('/api/admin/projects/reorder', { method: 'POST', body: { slugs: list.map((p) => p.slug) } });
      renderProjects();
    } catch (err) { fail(err); loadProjects().catch(() => {}); }
  }

  async function patch(p, changes, message) {
    try {
      await api(`/api/admin/projects/${encodeURIComponent(p.slug)}`, { method: 'PATCH', body: changes });
      await loadProjects();
      if (message) toast(message);
    } catch (err) { fail(err); }
  }

  /* ------------------------------------------------------------ envoi vers Cloudinary */
  // Envoie un fichier en morceaux de 6 Mo ; chaque morceau est réessayé jusqu'à 4 fois.
  function createUpload(file, kind, onProgress) {
    let xhr = null, aborted = false;

    function sendPart(params, blob, range, report) {
      return new Promise((resolve, reject) => {
        xhr = new XMLHttpRequest();
        xhr.open('POST', params.upload_url);
        if (range) {
          xhr.setRequestHeader('X-Unique-Upload-Id', range.id);
          xhr.setRequestHeader('Content-Range', `bytes ${range.start}-${range.end}/${range.total}`);
        }
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) report(e.loaded); };
        xhr.onload = () => {
          let data = null;
          try { data = JSON.parse(xhr.responseText); } catch { /* pas du JSON */ }
          if (xhr.status >= 200 && xhr.status < 300 && data) resolve(data);
          else {
            const e = new Error(data?.error?.message || `Erreur ${xhr.status}`);
            e.status = xhr.status;
            reject(e);
          }
        };
        xhr.onerror = () => { const e = new Error('network'); e.status = 0; reject(e); };
        xhr.ontimeout = xhr.onerror;
        xhr.onabort = () => { const e = new Error('aborted'); e.aborted = true; reject(e); };
        const fd = new FormData();
        Object.entries(params.fields).forEach(([k, v]) => fd.append(k, v));
        fd.append('file', blob, file.name || (kind === 'video' ? 'video.mp4' : 'photo.jpg'));
        xhr.send(fd);
      });
    }

    async function withRetry(fn, getParams) {
      for (let attempt = 0; ; attempt++) {
        try { return await fn(); } catch (err) {
          if (aborted || err.aborted) throw err;
          const stale = /stale|expired/i.test(err.message);
          if (stale && attempt < 2) { await getParams(true); continue; }
          const retryable = err.status === 0 || err.status >= 500 || err.status === 429;
          if (!retryable || attempt >= 4) throw err;
          await sleep(2000 * 2 ** attempt);
        }
      }
    }

    const promise = (async () => {
      let params = null;
      const getParams = async (fresh) => {
        if (!params || fresh) params = await api('/api/admin/upload-params', { method: 'POST', body: { kind } });
        return params;
      };
      await getParams();
      if (file.size > params.max_bytes) {
        throw new Error(`Fichier trop lourd (${mb(file.size)}). Maximum : ${mb(params.max_bytes)}.`);
      }
      const size = params.chunk_size;
      if (file.size <= size) {
        return withRetry(() => sendPart(params, file, null, (n) => onProgress(n / file.size)), getParams);
      }
      const id = `sa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      let result = null;
      for (let start = 0; start < file.size; start += size) {
        const end = Math.min(start + size, file.size);
        result = await withRetry(() => sendPart(params, file.slice(start, end), { id, start, end: end - 1, total: file.size },
          (n) => onProgress((start + n) / file.size)), getParams);
      }
      return result;
    })();

    return { promise, abort() { aborted = true; xhr?.abort(); } };
  }

  // Une photo trop lourde est réduite sur le téléphone avant l'envoi (3000 px, JPEG).
  async function shrinkImage(file, maxBytes) {
    if (file.size <= maxBytes || !/^image\/(jpe?g|png|webp)$/i.test(file.type)) return file;
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.9, 0.8, 0.7]) {
        const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
        if (blob && blob.size <= maxBytes) return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
      }
    } catch { /* format illisible : on garde l'original */ } finally { URL.revokeObjectURL(url); }
    return file;
  }

  function kindOf(file) {
    if (/^video\//i.test(file.type)) return 'video';
    if (/^image\//i.test(file.type)) return 'image';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp', 'mpeg', 'mpg'].includes(ext)) return 'video';
    if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif', 'gif'].includes(ext)) return 'image';
    return '';
  }

  /* ------------------------------------------------------------ formulaire ajout / modification */
  const editor = (() => {
    const dlg = $('#editor'), form = $('#editor-form');
    const f = {
      title: $('#f-title'), client: $('#f-client'), category: $('#f-category'), ratio: $('#f-ratio'),
      desc: $('#f-desc'), published: $('#f-published'), featured: $('#f-featured'),
    };
    const pv = { box: $('#preview'), video: $('#pv-video'), image: $('#pv-image'), note: $('#pv-note') };
    const prog = { box: $('#progress'), fill: $('#progress-fill'), text: $('#progress-text'), retry: $('#retry'), change: $('#change-file') };
    const saveBtn = $('#save-btn'), errBox = $('#editor-error');
    let mode = 'add', current = null, file = null, kind = '', upload = null, uploaded = null;
    let objectUrl = '', duration = 0, publishWhenReady = false, wakeLock = null, saving = false;

    Object.entries(CATEGORIES).forEach(([v, l]) => f.category.append(h('option', { value: v, text: l })));
    Object.entries(RATIOS).forEach(([v, l]) => f.ratio.append(h('option', { value: v, text: l })));

    $('#pick').addEventListener('click', () => $('#file').click());
    prog.change.addEventListener('click', () => $('#file').click());
    $('#file').addEventListener('change', (e) => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) chooseFile(fl); });
    prog.retry.addEventListener('click', () => file && startUpload());
    dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => requestClose()));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });

    const range = $('#cover-range');
    range.addEventListener('input', () => {
      $('#cover-time').textContent = clock(Number(range.value));
      try { pv.video.currentTime = Number(range.value); } catch { /* pas encore prêt */ }
    });

    function setError(msg) { errBox.textContent = msg || ''; errBox.hidden = !msg; }

    function reset() {
      upload?.abort();
      upload = null; uploaded = null; file = null; kind = ''; duration = 0; publishWhenReady = false; saving = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = '';
      pv.video.removeAttribute('src'); pv.video.load();
      pv.image.removeAttribute('src');
      pv.box.hidden = true; pv.video.hidden = true; pv.image.hidden = true; pv.note.hidden = true;
      $('#cover').hidden = true; prog.box.hidden = true; prog.retry.hidden = true; prog.change.hidden = true;
      prog.box.classList.remove('is-done', 'is-error');
      $('#pick').hidden = mode !== 'add';
      $('#current-cover').hidden = mode !== 'edit';
      form.reset();
      setError('');
      releaseWake();
    }

    function open(project) {
      mode = project ? 'edit' : 'add';
      current = project || null;
      reset();
      $('#editor-title').textContent = project ? 'Modifier le travail' : 'Ajouter un travail';
      saveBtn.textContent = project ? 'Enregistrer' : 'Publier';
      $('#delete-btn').hidden = !project;
      if (project) {
        f.title.value = project.title;
        f.client.value = project.client || '';
        f.category.value = project.category;
        f.ratio.value = project.aspect_ratio in RATIOS ? project.aspect_ratio : '9:16';
        f.desc.value = project.description || '';
        f.published.checked = project.is_published;
        f.featured.checked = project.is_featured;
        $('#current-cover').src = project.cover_image_url;
      } else {
        f.published.checked = true;
        f.ratio.value = '9:16';
      }
      dlg.showModal();
      if (!project) $('#pick').focus();
    }

    async function chooseFile(picked) {
      setError('');
      const k = kindOf(picked);
      if (!k) { setError('Ce fichier n\'est ni une vidéo ni une photo. Choisis un fichier MP4, MOV, JPG ou PNG.'); return; }
      const limit = (state.status?.max_mb?.[k] || (k === 'video' ? 100 : 10)) * 1048576;
      let chosen = k === 'image' ? await shrinkImage(picked, limit) : picked;
      if (chosen.size > limit) {
        setError(k === 'video'
          ? `Vidéo trop lourde (${mb(chosen.size)}). Maximum 100 Mo : exporte-la en 1080p (CapCut, Premiere, After Effects…) puis réessaie.`
          : `Photo trop lourde (${mb(chosen.size)}). Maximum 10 Mo : exporte-la en JPG puis réessaie.`);
        return;
      }
      if (uploaded) discard(uploaded);
      upload?.abort();
      upload = null; uploaded = null;
      file = chosen; kind = k; duration = 0;
      showPreview();
      startUpload();
    }

    function showPreview() {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = URL.createObjectURL(file);
      $('#pick').hidden = true;
      pv.box.hidden = false;
      pv.note.hidden = true;
      $('#cover').hidden = true;
      if (kind === 'video') {
        pv.image.hidden = true; pv.video.hidden = false;
        pv.video.onloadedmetadata = () => {
          duration = pv.video.duration || 0;
          f.ratio.value = nearestRatio(pv.video.videoWidth, pv.video.videoHeight);
          if (duration > 0) {
            range.max = String(Math.max(0.1, duration - 0.1));
            range.value = String(Math.round(duration * 0.33 * 10) / 10);
            $('#cover-time').textContent = clock(Number(range.value));
            $('#cover').hidden = false;
            try { pv.video.currentTime = Number(range.value); } catch { /* rien */ }
          }
        };
        pv.video.onerror = () => {
          pv.note.textContent = 'Aperçu impossible sur ce téléphone, mais l\'envoi continue normalement.';
          pv.note.hidden = false;
        };
        pv.video.src = objectUrl;
      } else {
        pv.video.hidden = true; pv.image.hidden = false;
        pv.image.onload = () => { f.ratio.value = nearestRatio(pv.image.naturalWidth, pv.image.naturalHeight); };
        pv.image.onerror = () => { pv.note.textContent = 'Aperçu impossible, mais l\'envoi continue normalement.'; pv.note.hidden = false; };
        pv.image.src = objectUrl;
      }
    }

    function progress(ratio, text, cls) {
      prog.box.hidden = false;
      prog.box.classList.toggle('is-done', cls === 'done');
      prog.box.classList.toggle('is-error', cls === 'error');
      prog.fill.style.width = `${Math.round(ratio * 100)}%`;
      prog.text.textContent = text;
    }

    async function startUpload() {
      prog.retry.hidden = true;
      prog.change.hidden = true;
      setError('');
      const label = kind === 'video' ? 'vidéo' : 'photo';
      progress(0, `Envoi de la ${label}… 0 % (${mb(file.size)}). Garde cette page ouverte.`);
      updateSave();
      grabWake();
      const job = createUpload(file, kind, (r) => {
        progress(Math.min(r, 0.99), `Envoi de la ${label}… ${Math.floor(Math.min(r, 0.99) * 100)} % (${mb(file.size)}). Garde cette page ouverte.`);
      });
      upload = job;
      try {
        const res = await job.promise;
        if (upload !== job) return;
        if (!res?.public_id) throw new Error('Réponse inattendue du stockage.');
        uploaded = { kind, public_id: res.public_id, width: res.width, height: res.height, duration: res.duration };
        upload = null;
        if (!duration && res.duration) duration = res.duration;
        if (res.width && res.height && pv.video.hidden && pv.image.naturalWidth === 0) f.ratio.value = nearestRatio(res.width, res.height);
        progress(1, kind === 'video' ? 'Vidéo envoyée. Il ne reste qu\'à publier.' : 'Photo envoyée. Il ne reste qu\'à publier.', 'done');
        prog.change.hidden = false;
        releaseWake();
        updateSave();
        if (publishWhenReady) save();
      } catch (err) {
        if (upload !== job || err.aborted) return;
        upload = null;
        releaseWake();
        publishWhenReady = false;
        const msg = err.status === 0 ? 'Connexion coupée pendant l\'envoi.'
          : err.status === 401 ? 'Mot de passe expiré : reconnecte-toi.'
          : /format/i.test(err.message) ? 'Format de fichier non accepté. Utilise MP4, MOV, JPG ou PNG.'
          : /too large|size/i.test(err.message) ? 'Fichier trop lourd pour le stockage gratuit (100 Mo pour une vidéo, 10 Mo pour une photo).'
          : err.message;
        progress(1, `Échec de l'envoi : ${msg}`, 'error');
        prog.retry.hidden = false;
        prog.change.hidden = false;
        updateSave();
      }
    }

    function updateSave() {
      if (mode === 'edit') { saveBtn.disabled = saving; saveBtn.textContent = saving ? 'Enregistrement…' : 'Enregistrer'; return; }
      saveBtn.disabled = saving;
      saveBtn.textContent = saving ? 'Publication…' : (upload && publishWhenReady ? 'Publié dès la fin de l\'envoi…' : 'Publier');
    }

    function values() {
      return {
        title: f.title.value.trim(), client: f.client.value.trim(), category: f.category.value,
        description: f.desc.value.trim(), aspect_ratio: f.ratio.value,
        is_published: f.published.checked, is_featured: f.featured.checked,
      };
    }

    function validate(v) {
      if (mode === 'add' && !file) return 'Choisis d\'abord une vidéo ou une photo.';
      if (v.title.length < 2) { f.title.focus(); return 'Donne un titre à ton travail (au moins 2 caractères).'; }
      if (!v.category) { f.category.focus(); return 'Choisis une catégorie.'; }
      return '';
    }

    form.addEventListener('submit', (e) => { e.preventDefault(); save(); });

    async function save() {
      if (saving) return;
      const v = values();
      const problem = validate(v);
      if (problem) { setError(problem); publishWhenReady = false; updateSave(); return; }
      setError('');
      if (mode === 'add' && !uploaded) {
        if (upload) { publishWhenReady = true; updateSave(); return; }
        setError('L\'envoi du fichier a échoué. Touche « Réessayer ».');
        return;
      }
      saving = true; updateSave();
      try {
        if (mode === 'add') {
          await api('/api/admin/media-projects', {
            method: 'POST',
            body: {
              ...v, client: v.client || null, kind: uploaded.kind, public_id: uploaded.public_id,
              width: uploaded.width || null, height: uploaded.height || null,
              cover_time: kind === 'video' ? Number(range.value) || (duration ? duration * 0.33 : 0) : 0,
            },
          });
          uploaded = null; // appartient maintenant au projet
          toast(v.is_published ? 'Publié ! Ton travail est en ligne sur le site.' : 'Enregistré (masqué pour l\'instant).');
        } else {
          await api(`/api/admin/projects/${encodeURIComponent(current.slug)}`, { method: 'PATCH', body: { ...v, client: v.client || null } });
          toast('Modifications enregistrées.');
        }
        closeNow();
        await loadProjects();
      } catch (err) {
        if (err.status === 401) { closeNow(); fail(err); return; }
        setError(err.message);
      } finally {
        saving = false; publishWhenReady = false; updateSave();
      }
    }

    $('#delete-btn').addEventListener('click', async () => {
      if (!current) return;
      const ok = await confirmBox(`Supprimer « ${current.title} » ?`,
        'Il disparaît du site et son fichier est effacé du stockage. C\'est définitif.', 'Supprimer');
      if (!ok) return;
      try {
        await api(`/api/admin/projects/${encodeURIComponent(current.slug)}`, { method: 'DELETE' });
        closeNow();
        toast('Travail supprimé.');
        await loadProjects();
      } catch (err) { fail(err); }
    });

    function discard(up) {
      api('/api/admin/media/discard', { method: 'POST', body: { kind: up.kind, public_id: up.public_id } }).catch(() => {});
    }

    async function requestClose() {
      if (saving) return;
      const busy = mode === 'add' && (upload || uploaded);
      if (busy && !(await confirmBox('Abandonner ce travail ?', 'Le fichier envoyé ne sera pas publié.', 'Abandonner'))) return;
      if (mode === 'add' && uploaded) discard(uploaded);
      closeNow();
    }

    function closeNow() {
      uploaded = null;
      reset();
      if (dlg.open) dlg.close();
    }

    async function grabWake() {
      try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
    }
    function releaseWake() { wakeLock?.release?.().catch(() => {}); wakeLock = null; }

    addEventListener('beforeunload', (e) => { if (upload) { e.preventDefault(); e.returnValue = ''; } });

    return { open };
  })();

  $('#add-btn').addEventListener('click', () => {
    if (state.status && !state.status.storage_ready) { toast('Active d\'abord le stockage (voir Réglages).', true); return; }
    editor.open(null);
  });

  /* ------------------------------------------------------------ devis */
  async function loadQuotes() {
    state.quotes = await api('/api/admin/quotes');
    renderQuotes();
  }

  function waNumber(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (d.length === 9 && /^[62]/.test(d)) d = '237' + d; // numéro camerounais saisi sans indicatif
    return d.length >= 8 ? d : '';
  }

  function renderQuotes() {
    const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const list = $('#quotes');
    list.replaceChildren(...state.quotes.map((q) => {
      const wa = waNumber(q.phone);
      const hello = `Bonjour ${q.full_name}, merci pour votre demande de devis sur Motion Design by Sama Abana.`;
      const select = h('select', { class: 'input', 'aria-label': `Statut de la demande ${q.id}` },
        Object.entries(STATUS).map(([v, l]) => h('option', { value: v, text: l, selected: q.status === v })));
      select.addEventListener('change', async () => {
        try {
          await api(`/api/admin/quotes/${q.id}`, { method: 'PATCH', body: { status: select.value } });
          q.status = select.value;
          renderQuotes();
          toast(`Demande #${q.id} : ${STATUS[q.status]}.`);
        } catch (err) { fail(err); select.value = q.status; }
      });
      const brief = h('p', { class: 'quote__brief' + (q.brief_description.length > 260 ? ' is-clamped' : ''), text: q.brief_description });
      const more = q.brief_description.length > 260
        ? h('button', { class: 'link small', type: 'button', text: 'Lire tout', onclick: (e) => { brief.classList.remove('is-clamped'); e.currentTarget.remove(); } })
        : null;
      return h('li', { class: 'quote' + (q.status === 'pending' ? ' is-new' : '') },
        h('div', { class: 'quote__head' },
          h('h3', { class: 'quote__name', text: `#${q.id} · ${q.full_name}` }),
          h('span', { class: 'quote__date', text: fmt.format(new Date(q.created_at)) })),
        h('div', { class: 'badges' },
          q.status === 'pending' ? h('span', { class: 'badge badge--key', text: 'Nouveau' }) : null,
          h('span', { class: 'badge', text: CATEGORIES[q.project_type] || q.project_type }),
          h('span', { class: 'badge', text: q.budget_range })),
        brief, more,
        h('p', { class: 'quote__contact', text: [q.email, q.phone].filter(Boolean).join(' · ') }),
        h('div', { class: 'quote__actions' },
          wa ? h('a', { class: 'act', href: `https://wa.me/${wa}?text=${encodeURIComponent(hello)}`, target: '_blank', rel: 'noopener' }, icon('wa'), 'WhatsApp') : null,
          h('a', { class: 'act', href: `mailto:${q.email}?subject=${encodeURIComponent('Votre demande de devis — Motion Design by Sama Abana')}&body=${encodeURIComponent(hello + '\n\n')}` }, icon('mail'), 'E-mail'),
          select));
    }));
    $('#quotes-empty').hidden = state.quotes.length > 0;
    const pending = state.quotes.filter((q) => q.status === 'pending').length;
    const c = $('#count-quotes');
    c.textContent = String(pending);
    c.hidden = pending === 0;
  }

  /* ------------------------------------------------------------ mode maintenance */
  async function loadMaintenance() {
    state.maintenance = await api('/api/admin/maintenance');
    renderMaintBanner();
  }

  function renderMaintBanner() {
    const m = state.maintenance, b = $('#maint-banner');
    b.hidden = !m?.enabled;
    if (!m?.enabled) return;
    const reopen = h('button', { class: 'act act--key', type: 'button', text: 'Rouvrir le site' });
    reopen.addEventListener('click', () => setMaintenance(false));
    b.replaceChildren(h('span', {}, h('strong', { text: 'Ton site est fermé. ' }), 'Tes visiteurs voient la page de maintenance.'), reopen);
  }

  async function setMaintenance(enabled, texts = {}) {
    const m = state.maintenance || {};
    const body = { enabled, title: texts.title ?? m.title ?? '', message: texts.message ?? m.message ?? '', return_date: texts.return_date ?? m.return_date ?? '' };
    try {
      state.maintenance = await api('/api/admin/maintenance', { method: 'PUT', body });
      renderMaintBanner();
      if (state.tab === 'site') renderSettings();
      return true;
    } catch (err) { fail(err); return false; }
  }

  function maintenanceCard() {
    const m = state.maintenance || { enabled: false, title: '', message: '', return_date: '' };
    const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const field = (label, el) => h('label', { class: 'mfield' }, h('span', { text: label }), el);
    const title = h('input', { class: 'input', maxlength: '120', placeholder: 'Le studio fait peau neuve.' });
    const message = h('textarea', { class: 'input', rows: '3', maxlength: '600' });
    const date = h('input', { class: 'input', maxlength: '60', placeholder: 'Ex. : lundi 20 octobre (facultatif)' });
    title.value = m.title || ''; message.value = m.message || ''; date.value = m.return_date || '';
    const texts = () => ({ title: title.value.trim(), message: message.value.trim(), return_date: date.value.trim() });
    const btn = (label, cls, onclick) => h('button', { class: cls, type: 'button', text: label, onclick });

    const preview = btn('Aperçu de la page', 'act', () => window.open('/?apercu-maintenance', '_blank'));
    const actions = [];
    if (!m.enabled) {
      actions.push(btn('Fermer le site', 'btn btn--danger btn--block', async () => {
        const ok = await confirmBox('Fermer le site ?', 'Tes visiteurs verront la page de maintenance jusqu\'à ce que tu le rouvres. Ton espace admin reste accessible.', 'Fermer le site');
        if (ok && await setMaintenance(true, texts())) toast('Site fermé : tes visiteurs voient la page de maintenance.');
      }), preview);
    } else {
      actions.push(btn('Rouvrir le site', 'btn btn--key btn--block', async () => {
        if (await setMaintenance(false, texts())) toast('Site rouvert : tout le monde le voit de nouveau.');
      }),
      btn('Enregistrer le texte', 'act', async () => {
        if (await setMaintenance(true, texts())) toast('Texte de la page de maintenance enregistré.');
      }),
      preview,
      btn('Voir le site (toi seul)', 'act', async () => {
        const w = window.open('', '_blank'); // ouvert tout de suite, sinon le téléphone bloque la fenêtre
        try { await api('/api/admin/preview-access', { method: 'POST' }); if (w) w.location = '/'; else location.href = '/'; }
        catch (err) { w?.close(); fail(err); }
      }));
    }
    const status = m.enabled
      ? `Site fermé${m.since ? ' depuis le ' + fmt.format(new Date(m.since)) : ''}. Tes visiteurs voient la page de maintenance ; toi, tu gardes l'accès à ton admin.`
      : 'Ton site est ouvert à tous. Ferme-le le temps d\'une refonte, de tes congés ou d\'une pause : tes visiteurs verront une page d\'attente avec ton WhatsApp, et ton admin reste accessible.';
    return h('li', { class: 'setting setting--maint' + (m.enabled ? ' is-closed' : '') },
      h('span', { class: 'setting__dot ' + (m.enabled ? 'is-warn' : 'is-ok'), 'aria-hidden': 'true' }),
      h('div', {},
        h('h3', { text: 'Mode maintenance' }),
        h('p', { text: status }),
        field('Titre de la page', title),
        field('Message', message),
        field('Réouverture prévue', date),
        h('div', { class: 'maint-actions' }, actions)));
  }

  /* ------------------------------------------------------------ réglages */
  function renderSettings() {
    const s = state.status || {};
    const row = (ok, title, text, action) => h('li', { class: 'setting' },
      h('span', { class: 'setting__dot' + (ok ? ' is-ok' : ''), 'aria-hidden': 'true' }),
      h('div', {}, h('h3', { text: title }), h('p', { text }), action || null));
    const testBtn = h('button', { class: 'act', type: 'button', text: 'Envoyer un e-mail de test' });
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true; testBtn.textContent = 'Envoi…';
      try {
        const r = await api('/api/admin/email-test');
        toast(r.ok ? `E-mail de test envoyé à ${r.to}. Regarde ta boîte (et les spams).` : `Échec : ${r.error}`, !r.ok);
      } catch (err) { fail(err); } finally { testBtn.disabled = false; testBtn.textContent = 'Envoyer un e-mail de test'; }
    });
    $('#settings').replaceChildren(
      maintenanceCard(),
      row(s.storage_ready, 'Stockage des vidéos et photos',
        s.storage_ready ? `Actif : Cloudinary (${s.cloud_name}). Vidéo 100 Mo max, photo 10 Mo max.`
          : (s.storage_error || 'Pas encore activé : ajoute CLOUDINARY_URL dans Render > Environment.')),
      row(Boolean(s.email_provider), 'E-mails des demandes de devis',
        s.email_provider ? `Actif : chaque demande arrive à ${s.notify_email}.` : 'Pas activé : ajoute RESEND_API_KEY dans Render > Environment.',
        s.email_provider ? testBtn : null),
      row(true, 'Portfolio', `${s.projects ?? state.projects.length} travaux enregistrés, ${s.quotes_pending ?? 0} devis en attente.`));
  }

  boot();
})();
