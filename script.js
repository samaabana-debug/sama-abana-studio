/* ==========================================================================
   Motion Design by Sama Abana — interactions
   Sans dépendance obligatoire : si GSAP ou Lottie ne se chargent pas, le site
   reste lisible et utilisable.
   ========================================================================== */
(() => {
  'use strict';

  const API_BASE = (document.querySelector('meta[name="api-base"]')?.content || '').replace(/\/$/, '');
  // Mode démo (page hébergée sans serveur) : rien n'est envoyé, on le dit clairement.
  const DEMO = document.querySelector('meta[name="demo-mode"]')?.content === 'true';
  const WHATSAPP = '237656294043';
  const EMAIL = 'Samaabana@gmail.com';
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const CATEGORY_LABELS = {
    '2d_animation': 'Animation 2D',
    '3d_animation': 'Animation 3D',
    'ui_ux_motion': 'UI/UX motion',
    'vfx_compositing': 'VFX & compositing',
  };

  // Copie des projets de départ : utilisée si l'API n'est pas joignable (ouverture du fichier en local).
  const FALLBACK_PROJECTS = [
    { slug: 'nk-beauty-spot', title: 'NK Beauty — spot publicitaire 60\u00a0s', client: 'NK Beauty', category: '2d_animation', is_featured: true,
      description: "Publicité motion design pour un salon de beauté : fil d'or qui dessine le logo, transitions en perspective, quatre services animés et carte de contact. Livrée en 9:16, 4:5 et 1:1.",
      cover_image_url: 'media/nk-spot.jpg', video_preview_url: 'media/nk-spot-preview.mp4', video_full_url: 'media/nk-spot.mp4', aspect_ratio: '9:16' },
    { slug: 'nk-beauty-logo', title: 'NK Beauty — révélation du logo', client: 'NK Beauty', category: '2d_animation',
      description: "Une mèche de cheveux tracée en lumière dorée devient l'arche du salon, puis le logo apparaît.",
      cover_image_url: 'media/nk-logo.jpg', video_preview_url: 'media/nk-logo-preview.mp4', video_full_url: 'media/nk-logo.mp4', aspect_ratio: '9:16' },
    { slug: 'nk-beauty-transitions', title: 'NK Beauty — transitions en perspective', client: 'NK Beauty', category: '3d_animation',
      description: 'Panneaux vidéo qui pivotent en 3D sur fond noir pour enchaîner les espaces du salon.',
      cover_image_url: 'media/nk-transitions.jpg', video_preview_url: 'media/nk-transitions-preview.mp4', video_full_url: 'media/nk-transitions.mp4', aspect_ratio: '9:16' },
    { slug: 'nk-beauty-services', title: 'NK Beauty — séquence services', client: 'NK Beauty', category: '2d_animation',
      description: 'Quatre écrans de services avec typographie animée et illustrations tracées à la main : onglerie, tresses, pose lace, makeup.',
      cover_image_url: 'media/nk-services.jpg', video_preview_url: 'media/nk-services-preview.mp4', video_full_url: 'media/nk-services.mp4', aspect_ratio: '9:16' },
  ];
  const SHOWREEL = {
    title: 'Showreel', meta: 'Motion Design by Sama Abana', description: '',
    video_full_url: 'media/nk-spot.mp4', cover_image_url: 'media/nk-spot.jpg', aspect_ratio: '9:16',
  };

  /* ======================================================================
     1. Fond animé du hero — WebGL (repli Canvas 2D)
     Des trajectoires de mouvement, comme des courbes d'animation, qui
     s'écartent au passage du curseur.
     ====================================================================== */
  function heroCanvas() {
    const canvas = $('.hero__canvas');
    if (!canvas) return;
    const hero = $('.hero');
    const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, s: 0, ts: 0 };
    let visible = true, raf = 0, start = performance.now();

    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    const scale = () => Math.min(window.devicePixelRatio || 1, 1.5) * (window.innerWidth < 700 ? 0.75 : 0.6);

    if (!gl) return heroCanvas2D(canvas);

    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `
      precision mediump float;
      uniform vec2 uRes; uniform float uTime; uniform vec2 uMouse; uniform float uMs;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
      void main(){
        vec2 p = (gl_FragCoord.xy - .5*uRes) / uRes.y;
        vec2 m = (uMouse - .5*uRes) / uRes.y;
        float t = uTime * .05;
        vec3 col = vec3(.039);
        for (int i = 0; i < 16; i++) {
          float fi = float(i);
          float off = (fi - 7.5) * .062 - .06;
          float y = off + .16 * sin(p.x * 1.45 + t * 2.2 + fi * .33) + .12 * (noise(vec2(p.x * 1.1 + t * 1.5, fi * .9)) - .5);
          float dx = p.x - m.x, dy = y - m.y;
          y += sign(dy) * .11 * uMs * exp(-dx*dx*9.) * exp(-dy*dy*22.);
          float d = abs(p.y - y);
          float line = smoothstep(.0045, .0, d);
          float tr = fract(p.x * .22 - t * 2.6 - fi * .173);
          float headL = pow(tr, 6.) * smoothstep(1., .985, tr);
          bool amber = (i == 6 || i == 11);
          vec3 c = amber ? vec3(1., .71, .28) : vec3(.62, .6, .57);
          float base = amber ? .28 : .085;
          float fadeX = smoothstep(-1.1, .6, p.x);
          col += c * line * (base + 1.4 * headL) * fadeX;
          col += c * smoothstep(.03, .0, d) * headL * .10 * fadeX;
        }
        vec2 uv = gl_FragCoord.xy / uRes;
        col *= mix(.55, 1., smoothstep(.0, .55, uv.y));
        col *= 1. - .35 * smoothstep(.45, 1.1, length(uv - vec2(.6, .5)));
        col += (hash(gl_FragCoord.xy + fract(uTime) * 91.) - .5) * .022;
        gl_FragColor = vec4(col, 1.);
      }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    } catch (e) { console.warn('WebGL indisponible, repli 2D', e); return heroCanvas2D(canvas); }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = { res: gl.getUniformLocation(prog, 'uRes'), time: gl.getUniformLocation(prog, 'uTime'),
      mouse: gl.getUniformLocation(prog, 'uMouse'), ms: gl.getUniformLocation(prog, 'uMs') };

    function resize() {
      const s = scale(), w = Math.round(canvas.clientWidth * s), h = Math.round(canvas.clientHeight * s);
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    }
    function draw(now) {
      resize();
      mouse.x += (mouse.tx - mouse.x) * .08; mouse.y += (mouse.ty - mouse.y) * .08; mouse.s += (mouse.ts - mouse.s) * .05;
      const s = scale(), t = reduceMotion ? 40 : (now - start) / 1000;
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.time, t);
      gl.uniform2f(u.mouse, mouse.x * s, canvas.height - mouse.y * s);
      gl.uniform1f(u.ms, mouse.s);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function loop(now) { draw(now); if (visible && !reduceMotion) raf = requestAnimationFrame(loop); }

    hero.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      mouse.tx = e.clientX - r.left; mouse.ty = e.clientY - r.top; mouse.ts = 1;
      if (mouse.x < -999) { mouse.x = mouse.tx; mouse.y = mouse.ty; }
      if (reduceMotion) draw(performance.now());
    });
    hero.addEventListener('pointerleave', () => { mouse.ts = 0; });
    new IntersectionObserver(([en]) => {
      visible = en.isIntersecting;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(loop);
    }).observe(hero);
    document.addEventListener('visibilitychange', () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && visible) raf = requestAnimationFrame(loop);
    });
    addEventListener('resize', () => draw(performance.now()));
    raf = requestAnimationFrame(loop);
  }

  function heroCanvas2D(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const paint = (t) => {
      const w = canvas.width = canvas.clientWidth, h = canvas.height = canvas.clientHeight;
      ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 16; i++) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 8) {
          const px = (x - w / 2) / h;
          const y = h / 2 - h * (((i - 7.5) * .062 - .06) + .16 * Math.sin(px * 1.45 + t * .11 + i * .33));
          x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.strokeStyle = (i === 6 || i === 11) ? 'rgba(255,181,71,.35)' : 'rgba(158,153,146,.12)';
        ctx.lineWidth = 1; ctx.stroke();
      }
    };
    paint(0); addEventListener('resize', () => paint(0));
  }

  /* ======================================================================
     2. Ouverture — le seul moment chorégraphié de la page
     ====================================================================== */
  function intro() {
    const root = document.documentElement;
    if (!root.classList.contains('intro')) return;
    if (!window.gsap) { root.classList.remove('intro'); return; }
    const lines = $$('.hero .line__inner');
    // On retire d'abord la classe CSS, puis GSAP pose l'état de départ (sinon il cumule les deux décalages).
    root.classList.remove('intro');
    gsap.set(lines, { y: 0, yPercent: 105 });
    gsap.set('.hero__foot', { opacity: 0, y: 24 });
    gsap.set('.timeline', { yPercent: 100 });
    gsap.timeline({ defaults: { ease: 'expo.out' } })
      .to(lines, { yPercent: 0, duration: 1.35, stagger: .11, ease: 'back.out(1.15)' }, .15)
      .to('.hero__foot', { opacity: 1, y: 0, duration: 1.1 }, .75)
      .to('.timeline', { yPercent: 0, duration: .9 }, .9);
  }

  /* ======================================================================
     3. En-tête, menu mobile, section active
     ====================================================================== */
  function header() {
    const head = $('.site-header');
    const toggle = $('.menu-toggle');
    const nav = $('#nav');
    let last = scrollY;
    const onScroll = () => {
      const y = scrollY;
      head.classList.toggle('is-scrolled', y > 24);
      const menuOpen = toggle.getAttribute('aria-expanded') === 'true';
      head.classList.toggle('is-hidden', !menuOpen && y > 420 && y > last + 4);
      if (y < last - 4) head.classList.remove('is-hidden');
      last = y;
    };
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const setMenu = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      document.body.classList.toggle('is-locked', open);
    };
    toggle.addEventListener('click', () => setMenu(toggle.getAttribute('aria-expanded') !== 'true'));
    $$('a', nav).forEach((a) => a.addEventListener('click', () => setMenu(false)));
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('is-open')) { setMenu(false); toggle.focus(); } });

    const links = new Map($$('a', nav).map((a) => [a.getAttribute('href').slice(1), a]));
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        links.forEach((a, id) => a.setAttribute('aria-current', String(id === en.target.id)));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main section[id]').forEach((s) => io.observe(s));
  }

  /* ======================================================================
     4. Timeline de défilement (timecode HH:MM:SS:II à 25 i/s, sur 60 s)
     ====================================================================== */
  function timeline() {
    const bar = $('.timeline');
    const tc = $('.timeline__tc', bar), label = $('.timeline__label', bar);
    const head = $('.timeline__head', bar), played = $('.timeline__played', bar);
    const keysEl = $('.timeline__keys', bar);
    const sections = $$('[data-section]');
    const FPS = 25, DURATION = 60;
    let marks = [];

    sections.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'timeline__key';
      b.setAttribute('aria-label', `Aller à : ${s.dataset.section}`);
      b.innerHTML = `<span class="tip">${s.dataset.section}</span>`;
      b.addEventListener('click', () => s.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }));
      keysEl.appendChild(b);
    });
    const keys = $$('.timeline__key', keysEl);

    const pad = (n) => String(n).padStart(2, '0');
    function measure() {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      marks = sections.map((s) => clamp((s.getBoundingClientRect().top + scrollY - offset) / max, 0, 1));
      keys.forEach((k, i) => { k.style.left = `${marks[i] * 100}%`; });
      update();
    }
    function update() {
      const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const p = clamp(scrollY / max, 0, 1);
      const frames = Math.round(p * DURATION * FPS);
      const s = Math.floor(frames / FPS), f = frames % FPS;
      tc.textContent = `00:${pad(Math.floor(s / 60))}:${pad(s % 60)}:${pad(f)}`;
      head.style.left = `${p * 100}%`;
      played.style.transform = `scaleX(${p})`;
      let cur = 0;
      marks.forEach((m, i) => { const on = p >= m - 0.002; keys[i].classList.toggle('is-passed', on); if (on) cur = i; });
      label.textContent = sections[cur]?.dataset.section || '';
    }
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', measure);
    addEventListener('load', measure);
    document.addEventListener('projects:rendered', measure);
    measure();
  }

  /* ======================================================================
     5. Lecteur vidéo (showreel + projets)
     ====================================================================== */
  const player = (() => {
    const dlg = $('#player');
    const video = $('.player__video', dlg), image = $('.player__image', dlg);
    const title = $('#player-title'), meta = $('#player-meta'), desc = $('#player-desc'), cta = $('#player-cta');
    let lastFocus = null;

    function open(item) {
      lastFocus = document.activeElement;
      const photo = item.media_type === 'image' && image;
      const [w, hgt] = String(item.aspect_ratio || '9:16').split(':').map(Number);
      const ratio = w > 0 && hgt > 0 ? `${w} / ${hgt}` : '9 / 16';
      title.textContent = item.title;
      meta.textContent = item.meta || [CATEGORY_LABELS[item.category], item.client].filter(Boolean).join(', ');
      desc.textContent = item.description || '';
      cta.dataset.category = item.category || '';
      cta.textContent = item.category ? 'Demander un projet similaire' : 'Demander un devis';
      dlg.classList.toggle('is-wide', w > hgt);
      video.hidden = Boolean(photo);
      if (image) image.hidden = !photo;
      if (photo) {
        image.style.aspectRatio = ratio;
        image.alt = item.title;
        image.src = item.video_full_url || item.cover_image_url;
      } else {
        video.style.aspectRatio = ratio;
        video.poster = item.cover_image_url || '';
        video.src = item.video_full_url;
      }
      if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
      document.body.classList.add('is-locked');
      if (!photo) video.play().catch(() => { /* lecture bloquée : l'utilisateur appuiera sur Lecture */ });
    }
    function close() {
      video.pause(); video.removeAttribute('src'); video.load();
      if (dlg.open) dlg.close();
    }
    dlg.addEventListener('close', () => {
      image?.removeAttribute('src');
      video.pause(); video.removeAttribute('src');
      document.body.classList.remove('is-locked');
      lastFocus?.focus?.();
    });
    $('.player__close', dlg).addEventListener('click', close);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    cta.addEventListener('click', (e) => {
      e.preventDefault();
      const cat = cta.dataset.category;
      close();
      if (cat) preselectType(cat);
      $('#devis').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
      setTimeout(() => $('#f-name').focus({ preventScroll: true }), reduceMotion ? 0 : 700);
    });
    return { open };
  })();

  $$('[data-showreel]').forEach((b) => b.addEventListener('click', () => player.open(SHOWREEL)));

  /* ======================================================================
     6. Portfolio — chargement depuis l'API, filtres, aperçus vidéo
     ====================================================================== */
  async function portfolio() {
    const grid = $('#grid'), empty = $('#empty');
    let projects;
    try {
      if (DEMO) throw new Error('demo');
      const res = await fetch(`${API_BASE}/api/projects`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(res.status);
      projects = await res.json();
    } catch {
      projects = FALLBACK_PROJECTS;
    }

    // compteurs des filtres
    const counts = projects.reduce((acc, p) => (acc[p.category] = (acc[p.category] || 0) + 1, acc), { all: projects.length });
    $$('[data-count]').forEach((el) => { el.textContent = counts[el.dataset.count] || '0'; });

    grid.innerHTML = '';
    projects.forEach((p, i) => grid.appendChild(card(p, i === 0 && p.is_featured)));
    const cards = $$('.card', grid);
    setupPreviews(cards);
    document.dispatchEvent(new Event('projects:rendered'));

    // filtres
    const chips = $$('.chip');
    chips.forEach((chip) => chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      chips.forEach((c) => { const on = c === chip; c.classList.toggle('is-active', on); c.setAttribute('aria-pressed', String(on)); });
      const shown = cards.filter((c) => {
        const ok = f === 'all' || c.dataset.category === f;
        c.hidden = !ok;
        return ok;
      });
      empty.hidden = shown.length > 0;
      if (!shown.length) {
        $('[data-empty-label]', empty).textContent = CATEGORY_LABELS[f];
        $('[data-empty-cta]', empty).dataset.category = f;
      }
      if (window.gsap && !reduceMotion && shown.length) {
        gsap.fromTo(shown, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: .6, stagger: .05, ease: 'expo.out', overwrite: true });
      }
      document.dispatchEvent(new Event('projects:rendered'));
    }));
    $('[data-empty-cta]', empty).addEventListener('click', (e) => preselectType(e.currentTarget.dataset.category));
  }

  function card(p, featured) {
    const el = document.createElement('article');
    el.className = 'card' + (featured ? ' card--featured' : '');
    el.dataset.category = p.category;
    const label = CATEGORY_LABELS[p.category] || p.category_label || '';
    const photo = p.media_type === 'image';
    // Les formats autres que 9:16 restent entiers dans la carte, sur un fond flouté de la même image.
    const fit = (p.aspect_ratio || '9:16') !== '9:16';
    el.innerHTML = `
      <div class="card__media"${fit ? ' data-fit="contain"' : ''}>
        ${fit ? `<img class="card__backdrop" src="${esc(p.cover_image_url)}" alt="" aria-hidden="true" loading="lazy" decoding="async">` : ''}
        <img class="card__cover" src="${esc(p.cover_image_url)}" alt="" loading="lazy" decoding="async" width="720" height="1280">
        ${p.video_preview_url && !photo ? `<video muted loop playsinline preload="none">
          ${/\.mp4$/i.test(p.video_preview_url) ? `<source data-src="${esc(p.video_preview_url.replace(/\.mp4$/i, '.webm'))}" type="video/webm">` : ''}
          <source data-src="${esc(p.video_preview_url)}" type="video/mp4"></video>` : ''}
        <button class="card__open" type="button" data-cursor="play"${photo ? ' data-cursor-label="Voir"' : ''} aria-label="${photo ? 'Voir la photo' : 'Lire la vidéo'} : ${esc(p.title)}"></button>
      </div>
      <div class="card__body">
        <h3 class="card__title">${esc(p.title)}</h3>
        <p class="card__meta">${esc(label)}${p.client ? `, ${esc(p.client)}` : ''}</p>
        ${featured ? `${p.description ? `<p class="card__desc">${esc(p.description)}</p>` : ''}<button class="btn btn--ghost card__cta" type="button" data-cursor="link">${photo ? 'Voir en grand' : 'Regarder le film'}</button>` : ''}
      </div>`;
    const open = () => player.open(p);
    $('.card__open', el).addEventListener('click', open);
    $('.card__cta', el)?.addEventListener('click', open);
    return el;
  }

  function setupPreviews(cards) {
    if (reduceMotion) return;
    // WebM (VP9) en priorité, MP4 en secours : le navigateur prend la première source qu'il sait lire.
    const load = (v) => {
      if (!v || v.dataset.loaded) return;
      $$('source[data-src]', v).forEach((s) => { s.src = s.dataset.src; });
      v.dataset.loaded = '1';
      v.load();
    };
    const play = (c) => { const v = $('video', c); if (!v) return; load(v); v.play().then(() => c.classList.add('is-playing')).catch(() => {}); };
    const stop = (c) => { const v = $('video', c); if (!v) return; v.pause(); c.classList.remove('is-playing'); };

    if (finePointer) {
      // bureau : l'aperçu se charge à l'approche et se lit au survol
      const io = new IntersectionObserver((entries) => entries.forEach((en) => {
        if (en.isIntersecting) { $('video', en.target)?.setAttribute('preload', 'metadata'); io.unobserve(en.target); }
      }), { rootMargin: '200px' });
      cards.forEach((c) => {
        io.observe(c);
        const media = $('.card__media', c);
        media.addEventListener('pointerenter', () => play(c));
        media.addEventListener('pointerleave', () => stop(c));
        $('.card__open', c).addEventListener('focus', () => play(c));
        $('.card__open', c).addEventListener('blur', () => stop(c));
      });
    } else {
      // mobile : lecture automatique silencieuse quand la carte est bien visible
      const io = new IntersectionObserver((entries) => entries.forEach((en) => {
        en.intersectionRatio > 0.6 ? play(en.target) : stop(en.target);
      }), { threshold: [0, 0.6, 1] });
      cards.forEach((c) => io.observe(c));
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ======================================================================
     7. Méthode — la tête de lecture parcourt les quatre étapes
     ====================================================================== */
  function method() {
    const track = $('#track');
    const steps = $$('.step', track);
    const set = (p) => {
      track.style.setProperty('--p', p.toFixed(4));
      steps.forEach((s, i) => s.classList.toggle('is-on', p >= (i / steps.length) + 0.02 || p >= 0.999));
    };
    if (reduceMotion || !window.gsap || !window.ScrollTrigger) { set(1); return; }
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.create({
      trigger: track, start: 'top 75%', end: 'bottom 45%', scrub: .6,
      onUpdate: (st) => set(st.progress),
    });
    set(0);
  }

  /* ======================================================================
     8. Curseur personnalisé + boutons magnétiques
     ====================================================================== */
  function cursor() {
    if (!finePointer) return;
    const root = document.documentElement;
    const dot = $('.cursor__dot'), ring = $('.cursor__ring');
    let x = innerWidth / 2, y = innerHeight / 2, rx = x, ry = y, shown = false;
    root.classList.add('has-cursor', 'cursor-hidden');

    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      x = e.clientX; y = e.clientY;
      if (!shown) { shown = true; rx = x; ry = y; root.classList.remove('cursor-hidden'); }
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { shown = false; root.classList.add('cursor-hidden'); });

    (function loop() {
      rx += (x - rx) * (reduceMotion ? 1 : .2); ry += (y - ry) * (reduceMotion ? 1 : .2);
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      requestAnimationFrame(loop);
    })();

    const state = (cls) => { root.classList.remove('cursor-link', 'cursor-play', 'cursor-text'); if (cls) root.classList.add(cls); };
    const cursorLabel = $('.cursor__label');
    document.addEventListener('pointerover', (e) => {
      const t = e.target;
      const playEl = t.closest('[data-cursor="play"]');
      if (playEl) { if (cursorLabel) cursorLabel.textContent = playEl.dataset.cursorLabel || 'Lire'; state('cursor-play'); }
      else if (t.closest('input, textarea, select')) state('cursor-text');
      else if (t.closest('a, button, label')) state('cursor-link');
      else state(null);
    });

    // effet magnétique sur les actions principales
    $$('.play, .btn--key, .header-wa').forEach((el) => {
      if (reduceMotion) return;
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        const mx = (e.clientX - r.left - r.width / 2) * .22, my = (e.clientY - r.top - r.height / 2) * .3;
        el.style.transform = `translate(${mx}px, ${my}px)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  /* ======================================================================
     9. Formulaire de devis → POST /api/quotes
     ====================================================================== */
  function preselectType(cat) {
    const sel = $('#f-type');
    if (cat && [...sel.options].some((o) => o.value === cat)) sel.value = cat;
  }

  function quoteForm() {
    const form = $('#quote-form');
    const alertBox = $('#form-alert');
    const submit = $('#submit');
    const success = $('#success');
    let lottieAnim = null;

    const MESSAGES = {
      full_name: { valueMissing: 'Indiquez votre nom.', tooShort: 'Votre nom doit compter au moins 2 caractères.' },
      email: { valueMissing: 'Indiquez votre adresse e-mail.', typeMismatch: 'Adresse e-mail invalide. Exemple : nom@gmail.com' },
      phone: { pattern: 'Numéro invalide. Exemple : +237 6 56 29 40 43' },
      project_type: { valueMissing: 'Choisissez un type de projet.' },
      budget_range: { valueMissing: 'Choisissez une fourchette de budget.' },
      brief_description: { valueMissing: 'Décrivez votre projet en quelques lignes.', tooShort: 'Ajoutez quelques détails : 20 caractères minimum.' },
    };

    const setError = (name, msg) => {
      const field = form.elements[name]?.closest('.field');
      const out = $(`#e-${name}`);
      if (!field || !out) return;
      field.classList.toggle('has-error', Boolean(msg));
      out.textContent = msg || '';
      form.elements[name].setAttribute('aria-invalid', msg ? 'true' : 'false');
      if (msg) form.elements[name].setAttribute('aria-describedby', `e-${name}`);
    };
    const phoneOk = (v) => !v.trim() || /^\+?\d{8,15}$/.test(v.replace(/[\s.\-()]/g, ''));

    function validate(name) {
      const el = form.elements[name];
      if (!el || !MESSAGES[name]) return true;
      let msg = '';
      const v = el.validity;
      if (name === 'phone' && !phoneOk(el.value)) msg = MESSAGES.phone.pattern;
      else if (v.valueMissing || (el.required && !el.value.trim())) msg = MESSAGES[name].valueMissing;
      else if (v.typeMismatch) msg = MESSAGES[name].typeMismatch;
      else if (v.tooShort || (el.minLength > 0 && el.value.trim().length < el.minLength)) msg = MESSAGES[name].tooShort;
      setError(name, msg);
      return !msg;
    }

    Object.keys(MESSAGES).forEach((name) => {
      const el = form.elements[name];
      el.addEventListener('blur', () => { if (el.value) validate(name); });
      el.addEventListener('input', () => { if (el.closest('.field').classList.contains('has-error')) validate(name); });
      el.addEventListener('change', () => validate(name));
    });

    function whatsappLink(data) {
      const lines = [
        `Bonjour Sama, je souhaite un devis.`,
        data.full_name && `Nom : ${data.full_name}`,
        data.project_type && `Projet : ${CATEGORY_LABELS[data.project_type]}`,
        data.budget_range && `Budget : ${data.budget_range}`,
        data.brief_description && `\n${data.brief_description}`,
      ].filter(Boolean);
      return `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(lines.join('\n'))}`;
    }
    function showAlert(html) { alertBox.innerHTML = html; alertBox.hidden = false; }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alertBox.hidden = true;
      const names = Object.keys(MESSAGES);
      const results = names.map(validate);
      if (results.includes(false)) {
        form.elements[names[results.indexOf(false)]].focus();
        return;
      }
      const data = Object.fromEntries(new FormData(form));
      if (!data.phone?.trim()) delete data.phone;
      if (DEMO) {
        showAlert(`Version de démonstration : ce formulaire n'envoie rien. Sur le site en ligne, la demande part à ${EMAIL}. Vous pouvez <a href="${whatsappLink(data)}" target="_blank" rel="noopener">envoyer cette demande sur WhatsApp</a>, le message est déjà rédigé.`);
        return;
      }

      submit.disabled = true;
      $('.btn__label', submit).textContent = 'Envoi en cours…';
      try {
        const res = await fetch(`${API_BASE}/api/quotes`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(data),
        });
        if (res.status === 201) return done(data);
        const body = await res.json().catch(() => ({}));
        if (res.status === 422 && Array.isArray(body.detail)) {
          body.detail.forEach((err) => {
            const field = err.loc?.[err.loc.length - 1];
            const m = MESSAGES[field];
            if (!m) return;
            let msg;
            if (field === 'email') msg = m.typeMismatch;
            else if (err.type === 'string_too_short') msg = m.tooShort || m.valueMissing;
            else if (err.type === 'value_error') msg = (err.msg || '').replace(/^Value error, /, '');
            else msg = m.valueMissing || m.pattern;
            setError(field, msg);
          });
          showAlert('Vérifiez les champs signalés en rouge.');
        } else {
          showAlert(`${esc(body.detail || 'Envoi impossible pour le moment.')} Vous pouvez <a href="${whatsappLink(data)}" target="_blank" rel="noopener">envoyer votre demande sur WhatsApp</a>, le message est déjà rédigé.`);
        }
      } catch {
        showAlert(`Envoi impossible : le serveur ne répond pas. <a href="${whatsappLink(data)}" target="_blank" rel="noopener">Envoyez votre demande sur WhatsApp</a> (message déjà rédigé) ou écrivez à <a href="mailto:${EMAIL}">${EMAIL}</a>.`);
      } finally {
        submit.disabled = false;
        $('.btn__label', submit).textContent = 'Envoyer la demande';
      }
    });

    function done(data) {
      const first = (data.full_name || '').trim().split(/\s+/)[0];
      $('#success-text').textContent = `Merci ${first}. Sama Abana vous répond par e-mail ou sur WhatsApp.`;
      form.hidden = true;
      success.hidden = false;
      success.focus();
      if (window.lottie) {
        lottieAnim?.destroy();
        lottieAnim = lottie.loadAnimation({
          container: $('#success-anim'), renderer: 'svg', loop: false, autoplay: !reduceMotion, path: 'assets/lottie/success.json',
        });
        if (reduceMotion) lottieAnim.addEventListener('DOMLoaded', () => lottieAnim.goToAndStop(lottieAnim.totalFrames - 1, true));
      }
      document.dispatchEvent(new Event('projects:rendered'));
    }

    $('#new-quote').addEventListener('click', () => {
      form.reset();
      Object.keys(MESSAGES).forEach((n) => setError(n, ''));
      success.hidden = true;
      form.hidden = false;
      $('#f-name').focus();
    });
  }

  /* ======================================================================
     Démarrage
     ====================================================================== */
  function init() {
    $('#year').textContent = new Date().getFullYear();
    intro();
    heroCanvas();
    header();
    timeline();
    portfolio();
    method();
    cursor();
    quoteForm();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
