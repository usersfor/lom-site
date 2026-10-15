﻿﻿﻿﻿﻿/* =========================================================
   诡秘之主 · Lord of the Mysteries
   Haven Constructions 质感复刻（修复版）

   黑屏修复：
   - ScrollGallery 初始 scale 0.95 + inset 5%（不是 0.85 + 30%）
   - 图片容器都有 background:var(--bg-3) 兜底色
   - hero 2s fallback timer 防止 boot 断裂永久黑屏
   - img 标签加 is-loaded class 触发 opacity

   诡秘之主风格文字动画：
   - 中文标题 → char-by-char stagger translateY 入场（无辉光）
   - 正文段落 → clip-path 从右到左"灰雾散开"揭幕
   - section-tag → letter-spacing 从 0.5em 收缩到 0.22em
   ========================================================= */

import { initPath01Scene } from './scene-path01.js';

(function () {
  'use strict';

  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

  /* ---------- 1. PRELOADER (Cookie 24h) ---------- */
  function initPreloader() {
    const el = $('#preloader');
    if (!el) return;

    const visited = document.cookie.match(/lom_visited=1/);
    if (visited) { el.remove(); boot(); return; }

    // Phase 0: 字符入场 + 进度条填充
    const chars = $$('.preloader__char', el);
    const bar = $('.preloader__bar span', el);
    gsap.to(chars, { y: 0, opacity: 1, duration: 0.8, ease: 'expo.out', stagger: 0.08 });
    gsap.to(bar, { width: '100%', duration: 1.6, ease: 'power2.inOut', delay: 0.4 });

    // Phase 1 + 2: 先收住内部 → 再窗帘揭开
    setTimeout(() => {
      // Phase 1: 内部元素先 scale+opacity 收住
      gsap.to(chars, { y: -10, opacity: 0, duration: 0.4, ease: 'power2.in' });
      gsap.to('.preloader__bar', { opacity: 0, duration: 0.4 });

      setTimeout(() => {
        // Phase 2: 窗帘揭开（CSS transition 0.85s）
        el.classList.add('is-curtain');
        document.cookie = 'lom_visited=1;max-age=86400;path=/';
        setTimeout(() => { el.remove(); boot(); }, 880);
      }, 400);
    }, 2000);
  }

  /* ---------- 2. LENIS ---------- */
  function initLenis() {
    if (typeof Lenis === 'undefined') return null;
    const lenis = new Lenis({
      duration: 1.35,
      easing: (t) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    document.documentElement.classList.add('has-lenis');
    return lenis;
  }

  /* ---------- 3. CUSTOM CURSOR ---------- */
  function initCursor() {
    const cursor = $('#cursor');
    if (!cursor) { return null; }
    if (matchMedia('(max-width: 1024px)').matches) { cursor.remove(); return null; }

    const dot = $('.cursor__dot', cursor);
    const ring = $('.cursor__ring', cursor);
    const label = $('.cursor__label', cursor);

    let mx = window.innerWidth / 2, my = window.innerHeight / 2;
    let rx = mx, ry = my;

    window.addEventListener('mousemove', (e) => { mx = e.clientX; my = e.clientY; });

    gsap.ticker.add(() => {
      rx += (mx - rx) * 0.18;
      ry += (my - ry) * 0.18;
      dot.style.setProperty('--mx', (mx - 3) + 'px');
      dot.style.setProperty('--my', (my - 3) + 'px');
      ring.style.setProperty('--rx', (rx - 18) + 'px');
      ring.style.setProperty('--ry', (ry - 18) + 'px');
    });

    const hoverables = 'a, button, [data-cursor], .path-row, .bento-card, .btn, .menu-panel__list a, .feature-card';
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest(hoverables);
      if (!t) { cursor.classList.remove('is-hover', 'is-label'); return; }
      cursor.classList.add('is-hover');
      const lbl = t.dataset.cursor;
      if (lbl) { label.textContent = lbl; cursor.classList.add('is-label'); }
      else { cursor.classList.remove('is-label'); }
    });

    return cursor;
  }

  /* ---------- 4. NAV + MENU ---------- */
  function initNav(lenis) {
    const nav = $('#nav');
    ScrollTrigger.create({
      start: 'top 80',
      onUpdate: (self) => nav.classList.toggle('is-scrolled', self.progress > 0.1),
    });

    const toggle = $('#menuToggle');
    const panel = $('#menuPanel');
    toggle?.addEventListener('click', () => {
      panel?.classList.toggle('is-open');
      if (lenis) panel.classList.contains('is-open') ? lenis.stop() : lenis.start();
    });
    $$('.menu-panel__list a').forEach(a => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        if (href.startsWith('#')) {
          e.preventDefault();
          const target = $(href);
          panel?.classList.remove('is-open');
          lenis?.start();
          if (target && lenis) lenis.scrollTo(target, { offset: -40, duration: 1.2 });
          else target?.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });

    $('.footer__back')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (lenis) lenis.scrollTo(0, { duration: 1.5 });
      else window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* =========================================================
     5. SPLIT TITLE —— char-by-char + 金色辉光（诡秘之主风格）
     HTML 结构：
       <h2 class="split-title">
         <span>隐藏完整文本</span>
         <span>选择你的非凡之路</span>  ← JS 会把这个 span 拆成 .char-span
       </h2>
     ========================================================= */
  function initSplitTitles() {
    $$('.split-title').forEach(title => {
      // 找到所有可见的 child span（跳过第一个隐藏层）
      const textSpans = [...title.children].slice(1);
      if (!textSpans.length) return;

      // 把每个文本 span 拆成 char-span
      textSpans.forEach(span => {
        const text = span.textContent;
        span.innerHTML = '';
        [...text].forEach((ch, i) => {
          const c = document.createElement('span');
          c.className = 'char-span';
          c.textContent = ch === ' ' ? '\u00A0' : ch;
          span.appendChild(c);
        });
      });

      const chars = $$('.char-span', title);
      if (!chars.length) return;

      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: title,
          start: 'top 85%',
          once: true,
        }
      });

      tl.to(chars, {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: 'expo.out',
        stagger: 0.035,
      });
    });
  }

  /* =========================================================
     5b. SECTION TAG — letter-spacing 呼吸收缩
     ========================================================= */

  /* ---------- 5.5 KINETIC TEXT —— 鼠标靠近时每个字向外散开(复刻 magicui KineticText)
     依赖 initSplitTitles 先把字拆成 .char-span,所以顺序必须在它之后。
     HTML 加 data-kinetic="true" 开启。
  */
  function initKineticTitles() {
    $$('[data-kinetic]').forEach((el) => {
      const chars = $$('.char-span', el);
      if (!chars.length) return;

      const pointer = { x: 0, y: 0, active: false };

      // 每个字当前显示的 transform 值 (lerp 目标),初始 (0,0)
      const state = chars.map(() => ({ tx: 0, ty: 0, rot: 0, blur: 0 }));

      const RADIUS   = 220;    // 鼠标影响范围 (px)
      const MAX_TX   = 14;     // 最大水平位移
      const MAX_TY   = 14;
      const MAX_ROT  = 9;      // 最大旋转 (°)
      const MAX_BLUR = 1.8;    // 最大 blur (px)
      const LERP     = 0.14;   // 平滑系数 (越小越丝滑、响应越慢)

      const syncPointer = (e) => {
        const r = el.getBoundingClientRect();
        const cx = e.clientX - (r.left + r.width / 2);
        const cy = e.clientY - (r.top  + r.height / 2);
        const diag = Math.hypot(r.width, r.height) * 0.5;
        pointer.x = cx / diag;   // -1~1
        pointer.y = cy / diag;
        pointer.active = true;
      };

      el.addEventListener('mousemove', syncPointer);
      el.addEventListener('mouseenter', syncPointer);
      el.addEventListener('mouseleave', () => { pointer.active = false; });

      function tick() {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top  + r.height / 2;

        chars.forEach((ch, i) => {
          const cr = ch.getBoundingClientRect();
          const chx = cr.left + cr.width / 2;
          const chy = cr.top  + cr.height / 2;

          let tx = 0, ty = 0, rot = 0, blur = 0;

          if (pointer.active) {
            const mx = cx + pointer.x * r.width  * 0.5;
            const my = cy + pointer.y * r.height * 0.5;
            const dx = chx - mx;
            const dy = chy - my;
            const dist = Math.hypot(dx, dy);

            if (dist < RADIUS) {
              // smoothstep 衰减:鼠标越近越强、到半径归零
              const t = 1 - dist / RADIUS;
              const f = t * t * (3 - 2 * t);

              const ux = dist > 0 ? dx / dist : 0;
              const uy = dist > 0 ? dy / dist : 0;

              tx   = ux * MAX_TX   * f;
              ty   = uy * MAX_TY   * f;
              rot  = ux * MAX_ROT  * f;   // 水平方向 → 旋转
              blur = MAX_BLUR * f;
            }
          }

          const s = state[i];
          s.tx   += (tx   - s.tx)   * LERP;
          s.ty   += (ty   - s.ty)   * LERP;
          s.rot  += (rot  - s.rot)  * LERP;
          s.blur += (blur - s.blur) * LERP;

          ch.style.transform = `translate3d(${s.tx.toFixed(2)}px, ${s.ty.toFixed(2)}px, 0) rotate(${s.rot.toFixed(2)}deg)`;
          ch.style.filter = `blur(${s.blur.toFixed(2)}px)`;
        });

        raf = requestAnimationFrame(tick);
      }
      let raf = requestAnimationFrame(tick);

      // section 滚出视口时停掉 rAF,节约 GPU
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            if (!raf) raf = requestAnimationFrame(tick);
          } else {
            if (raf) cancelAnimationFrame(raf);
            raf = null;
            chars.forEach((ch, i) => {
              state[i].tx = state[i].ty = state[i].rot = state[i].blur = 0;
              ch.style.transform = 'translate3d(0,0,0) rotate(0deg)';
              ch.style.filter = 'blur(0px)';
            });
          }
        });
      }, { threshold: 0.05 });
      io.observe(el);
    });
  }

  function initSectionTags() {
    $$('.section-tag').forEach(tag => {
      gsap.to(tag, {
        letterSpacing: '0.22em',
        duration: 1.2,
        ease: 'expo.out',
        scrollTrigger: {
          trigger: tag,
          start: 'top 85%',
          once: true,
        }
      });
    });
  }

  /* =========================================================
     5c. 正文段落 —— 灰雾 clip-path 揭幕
     给 .hero__desc, .story__lede, .story-card__desc, .path-row__info p
     自动加上 reveal-paragraph 包装
     ========================================================= */
  function initParagraphReveal() {
    const targets = [
      '.story__lede',
      '.story-card__desc',
      '.path-row__info p',
      '.cta__sub',
    ];
    $$(targets.join(',')).forEach(p => {
      if (p.classList.contains('reveal-paragraph')) return;
      const text = p.textContent;
      p.innerHTML = '';
      p.classList.add('reveal-paragraph');
      const inner = document.createElement('span');
      inner.className = 'reveal-paragraph__mask';
      inner.textContent = text;
      p.appendChild(inner);

      ScrollTrigger.create({
        trigger: p,
        start: 'top 88%',
        once: true,
        onEnter: () => {
          gsap.to(inner, {
            y: 0,
            duration: 1.0,
            ease: 'expo.out',
          });
        }
      });
    });
  }

  /* =========================================================
     6. SCROLL GALLERY —— 图片 reveal（修复版）
     - 初始 scale 0.95（不是 0.85）—— 首屏仍可见
     - 初始 inset 5%（不是 30%）—— 首屏只裁一小圈
     - img.onload → 加 is-loaded class 触发 opacity
     ========================================================= */
  function initScrollGallery() {
    const containers = $$('.scroll-gallery-images');
    containers.forEach(wrap => {
      // ← Hero 图片由 initHero 独立控制（进场 zoom + 滚动视差），这里跳过
      if (wrap.closest('.hero')) return;

      const item = wrap.querySelector('.scroll-gallery-img-item');
      const img = wrap.querySelector('.scroll-gallery-img img');
      if (!item || !img) return;

      // 图片加载完成后显示（兜底 opacity:0）
      const markLoaded = () => img.classList.add('is-loaded');
      if (img.complete && img.naturalWidth > 0) markLoaded();
      else img.addEventListener('load', markLoaded, { once: true });
      img.addEventListener('error', markLoaded, { once: true });  // 即使失败也显示容器背景

      // 初始状态（保证 progress=0 时图片仍可见，不全黑）
      gsap.set(wrap, { scale: 0.95 });
      gsap.set(item, { clipPath: 'inset(5%)', webkitClipPath: 'inset(5%)' });
      gsap.set(img, { scale: 1.0 });

      // 滚动驱动：0.95 → 1.08，inset 5% → 0%，img scale 1.0 → 1.15
      ScrollTrigger.create({
        trigger: wrap.closest('section, article, .hero__media, .path-row__img-wrap') || wrap,
        start: 'top bottom+=50',
        end: 'bottom top-=50',
        scrub: 1,
        ease: 'none',
        onUpdate: (self) => {
          const p = self.progress; // 0 → 1
          // 修复后的值范围：从"基本可见"到"完全展开"
          const s = 0.95 + p * 0.13;       // 0.95 → 1.08
          const insetV = 5 * (1 - p);      // 5% → 0%（渐进完全显示）
          wrap.style.transform = `scale(${s})`;
          const css = `inset(${insetV.toFixed(2)}%)`;
          item.style.clipPath = css;
          item.style.webkitClipPath = css;
          const innerScale = 1.0 + p * 0.15;  // 1.0 → 1.15 反向 parallax
          img.style.transform = `scale(${innerScale})`;
        }
      });
    });
  }

  /* ---------- 7. HERO entrance —— 已简化：Hero 只剩仪式阵 + Three.js 镜子 ---------- */
  function initHero() {
    // 仪式阵描边动画保留（initFooterOrnament 风格独立处理）
  }

  /* ---------- 8. ANIMATED LIST —— 垂直无限滚动的活动通知
     复刻 magicui AnimatedList:首项在底部做 leaving 滑出,
     同时把首项 appendChild 到末尾(无限循环);新首项做 entering 滑入。
     依赖 GSAP 缓动,IntersectionObserver 控制进入视口才启动。*/
  function initAnimatedList() {
    const section = document.querySelector('#feature');
    const list = document.querySelector('[data-feed-list]');
    if (!list) return;

    const items = [...list.querySelectorAll('[data-role="item"]')];
    if (items.length < 2) return;

    // 初始全部标记为 idle
    items.forEach(it => it.dataset.state = 'idle');

    const INTERVAL = 3800;  // 每 3.8s 滚动一张
    const DURATION = 700;   // 单张进出动画时长(ms)
    let running = false;
    let timer = null;

    function step() {
      if (!running) return;
      const first = list.firstElementChild;
      if (!first) return;

      // 1) 首项 leaving:向下滑出 + 淡出
      first.dataset.state = 'leaving';
      gsap.to(first, {
        y: 22,
        opacity: 0,
        filter: 'blur(6px)',
        duration: DURATION / 1000,
        ease: 'power2.in',
        onComplete: () => {
          // 2) 把它 append 到末尾,重置位置
          gsap.set(first, { y: -22, opacity: 0, filter: 'blur(6px)' });
          list.appendChild(first);
          first.dataset.state = 'entering';

          // 3) 新首项:entering → idle(从上方滑入)
          const newFirst = list.firstElementChild;
          newFirst.dataset.state = 'entering';
          gsap.fromTo(newFirst,
            { y: -22, opacity: 0, filter: 'blur(6px)' },
            { y: 0, opacity: 1, filter: 'blur(0px)',
              duration: DURATION / 1000, ease: 'expo.out',
              onComplete: () => { newFirst.dataset.state = 'idle'; }
            }
          );
        },
      });
    }

    function start() {
      if (running) return;
      running = true;
      step();
      timer = setInterval(step, INTERVAL);
    }
    function stop() {
      if (!running) return;
      running = false;
      if (timer) { clearInterval(timer); timer = null; }
    }

    // 滚入视口启动,滚出暂停(省 CPU)
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) start();
        else stop();
      });
    }, { threshold: 0.15 });
    io.observe(section);
  }

  /* ---------- 8.6 COUNT-UP 数字滚动 ---------- */
  function initCountUp() {
    const els = $$('.count-up');
    if (!els.length) return;

    els.forEach(el => {
      const target = parseInt(el.dataset.target, 10);
      if (isNaN(target)) return;

      ScrollTrigger.create({
        trigger: el,
        start: 'top 85%',
        once: true,
        onEnter: () => {
          const state = { val: 0 };
          gsap.to(state, {
            val: target,
            duration: 2.2,
            ease: 'power2.out',
            onUpdate: () => {
              const v = Math.round(state.val);
              if (v >= 10000) {
                el.textContent = (v / 10000).toFixed(1) + '万';
              } else {
                el.textContent = v.toLocaleString('en-US');
              }
            },
          });
        },
      });
    });
  }

  /* ---------- 8.7 WAVE DIVIDERS 波浪分割线 ---------- */
  function initWaveDividers() {
    const waves = $$('.wave-divider');
    if (!waves.length) return;

    // wave 与下一个 section 的映射
    // path-story 波浪现在直接接 CTA(section 03 已删)
    const nextSectionMap = {
      'path-story':  '#download',
      'feature-cta': '#download',
      'cta-footer':  'footer',
    };

    waves.forEach(wave => {
      const id = wave.dataset.wave;
      const triggerSel = nextSectionMap[id];
      const trigger = triggerSel ? document.querySelector(triggerSel) : null;
      if (!trigger) return;

      const svg = $('svg', wave);
      if (!svg) return;

      // 1. 从下往上升起（核心动效）
      gsap.to(wave, {
        y: 0,
        ease: 'none',
        scrollTrigger: {
          trigger,
          start: 'top 100%',
          end: 'top 45%',
          scrub: 1,
        },
      });

      // 2. 活水感 · 横向循环（3 个周期平铺，滚 33.333% 正好接上下一段）
      gsap.set(svg, { transformOrigin: 'center bottom' });
      gsap.fromTo(svg,
        { xPercent: 0 },
        { xPercent: -33.333, duration: 14, ease: 'none', repeat: -1 }
      );

      // 3. 水面呼吸（微弱 scaleY 循环）
      gsap.fromTo(svg,
        { scaleY: 0.96 },
        { scaleY: 1.04, duration: 4.5, ease: 'sine.inOut', repeat: -1, yoyo: true }
      );
    });
  }

  /* ---------- 8.8 SIGIL STROKE 仪式阵描边动画 ---------- */
  function initSigilStroke() {
    const sigil = $('.hero__sigil');
    if (!sigil) return;
    const paths = $$('.sigil-path', sigil);
    if (!paths.length) return;

    // 每条 path 先测实际长度（getTotalLength），然后独立滚动描边
    // 滚动范围：Hero 区上半段（scroll 0 → Hero height 的 40%）
    const hero = $('.hero');
    const heroH = hero ? hero.offsetHeight : 800;
    const totalScroll = heroH * 0.5;  // Hero 区只需要滚一半就画完

    // 每条 path 按顺序延迟出场（stagger 描出效果）
    paths.forEach((path, i) => {
      const len = Math.max(path.getTotalLength(), 100);
      gsap.set(path, {
        attr: { 'stroke-dasharray': len, 'stroke-dashoffset': len },
      });
    });

    // 整体进度条：ScrollTrigger scrub hero 区上半段
    let progress = { v: 0 };
    gsap.to(progress, {
      v: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: hero,
        start: 'top top',
        end: `+=${totalScroll}`,
        scrub: 1,
      },
      onUpdate: () => {
        const t = progress.v;
        const n = paths.length;
        paths.forEach((path, i) => {
          // 每条 path 在 t∈[i/n - 0.15, i/n + 0.15] 区间里从 1→0
          const local = (t * n - i);           // -i/n → ...
          const clamped = Math.max(0, Math.min(1, local * 1.2 + 0.5));  // 扩大区间让重叠
          const len = Math.max(path.getTotalLength(), 100);
          path.setAttribute('stroke-dashoffset', len * (1 - clamped));
        });
      },
    });

    // 仪式阵整体微微呼吸（scale 1 + rotate 0）
    gsap.fromTo(sigil,
      { rotate: -2, scale: 0.98 },
      { rotate: 2, scale: 1.02, duration: 8, ease: 'sine.inOut', repeat: -1, yoyo: true }
    );
  }

  /* ---------- 8.9 FOOTER ORNAMENT 装饰波浪描边 ---------- */
  function initFooterOrnament() {
    const ornament = $('.footer__ornament');
    if (!ornament) return;
    const path = $('.footer-ornament-path', ornament);
    if (!path) return;

    const len = Math.max(path.getTotalLength(), 100);
    gsap.set(path, {
      attr: { 'stroke-dasharray': len, 'stroke-dashoffset': len },
    });

    ScrollTrigger.create({
      trigger: ornament,
      start: 'top 100%',
      once: true,
      onEnter: () => {
        gsap.to(path, {
          attr: { 'stroke-dashoffset': 0 },
          duration: 2.2,
          ease: 'power2.out',
        });
      },
    });

    // 描完后微弱左右游走（呼应波浪分割线的活水感）
    gsap.fromTo(ornament,
      { xPercent: -3 },
      { xPercent: 3, duration: 10, ease: 'sine.inOut', repeat: -1, yoyo: true }
    );
  }

  /* ---------- 9. PATH ITEM —— 大图 scroll faster than sticky text ---------- */
  function initPathItems() {
    // path-item 的 SVG 装饰和文字动画现在全部由 initPathFrames 统一驱动
    // 这里只保留进场前的初始状态设置
    const items = $$('.path-item');
    if (!items.length) return;

    items.forEach(item => {
      const portrait = $('.path-item__portrait', item);
      const text  = $('.path-item__text',  item);
      if (!portrait || !text) return;

      // 初始隐藏（进场参数和 initPathFrames 里的平滑插值对齐）
      gsap.set(portrait, { scale: 0.7, y: 80, opacity: 0 });
      gsap.set(text,     { opacity: 0, y: 50 });
    });
  }

  /* ---------- 9.4b PATH section —— path-item 肖像/文字滚动动画 ---------- */
  /* 背景图片序列已删:由 Three.js 镜子内部贴图驱动,此函数只负责 path-item 进场/视差 */
  function initPathFrames() {
    const section = $('#path');
    if (!section) return;

    const items = $$('.path-item', section);
    if (items.length === 0) return;

    const ANIM_STOP = 0.72;  // path-item 肖像图/文字动画在此进度后冻结

    // section 整体 scrub → 驱动 path-item 进场/视差
    ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: 'bottom top',
      scrub: true,
      onUpdate: (self) => {
        const p = self.progress;

        // path-item 肖像图 + 文字（平滑插值,ANIM_STOP 前动后冻）
        const activeP = Math.min(p, ANIM_STOP);
        items.forEach((item, i) => {
          const portrait = $('.path-item__portrait', item);
          const text  = $('.path-item__text',  item);
          if (!portrait || !text) return;

          const itemStart = (i / items.length) * ANIM_STOP;
          const itemEnd   = ((i + 1) / items.length) * ANIM_STOP;
          let ip = (activeP - itemStart) / (itemEnd - itemStart);
          ip = Math.max(-0.25, Math.min(1.25, ip));

          const enterP = Math.max(-0.25, Math.min(0.25, ip));
          const enterNorm = (enterP + 0.25) / 0.5;
          const scrollP = Math.max(0, Math.min(1, (ip - 0.25) / 1.0));

          gsap.set(portrait, {
            opacity: enterNorm,
            scale: 0.7 + 0.3 * enterNorm,
            y: 80 * (1 - enterNorm),
            yPercent: 22 * scrollP,
            rotation: 6 * scrollP,
          });

          const textEnterNorm = Math.max(0, Math.min(1, (enterP + 0.15) / 0.3));
          const textScrollP = Math.max(0, Math.min(1, scrollP));
          gsap.set(text, {
            opacity: textEnterNorm,
            y: 50 * (1 - textEnterNorm) - 25 * textScrollP,
          });
        });
      },
    });
  }
  function initFeatureHover() {
    $$('.feature-card').forEach(card => {
      const img = $('img', card);
      if (!img) return;
      card.addEventListener('mouseenter', () => {
        gsap.to(img, { scale: 1.08, filter: 'brightness(1.08)', duration: 0.5, ease: 'power2.out' });
      });
      card.addEventListener('mouseleave', () => {
        gsap.to(img, { scale: 1.0, filter: 'brightness(1)', duration: 0.5, ease: 'power2.out' });
      });
    });
  }

  /* ---------- 10. 初始状态 ---------- */
  function initInitialHidden() {
    // Hero 已简化（仪式阵 + Three.js 镜子），这里无需要初始隐藏的元素
  }

  /* ---------- 10.1 THEME TOGGLE ---------- */
  function initThemeToggle() {
    const btn = $('#themeToggle');
    if (!btn) return;

    // 初始化：从 localStorage 读偏好，否则跟随系统
    const stored = localStorage.getItem('lom_theme');
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const initialTheme = stored || (prefersLight ? 'light' : 'dark');

    if (initialTheme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }

    btn.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      const next = isLight ? 'dark' : 'light';

      // 小旋转动画（纯 JS 触发）
      btn.animate(
        [{ transform: 'rotate(180deg) scale(1.1)' }, { transform: 'rotate(360deg) scale(1)' }],
        { duration: 500, easing: 'cubic-bezier(0.14, 0.9, 0.34, 0.94)' }
      );

      if (next === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }

      localStorage.setItem('lom_theme', next);
    });
  }

  /* ---------- 10.15 联系卡片:二维码弹窗 + 复制 QQ 群号 ---------- */
  function initContactCards(lenis) {
    const modal = $('#qrModal');
    if (!modal) return;
    const img = $('#qrModalImg', modal);
    const fallback = $('#qrModalFallback', modal);
    const kicker = $('#qrModalKicker', modal);
    const title = $('#qrModalTitle', modal);
    const hint = $('#qrModalHint', modal);
    const copyBtn = $('#qrModalCopy', modal);
    const copyValue = $('#qrModalCopyValue', modal);
    const toast = $('#contactToast');

    const QQ_GROUP = '666487283';

    // QQ / 微信两种卡片的弹窗内容配置
    // 二维码素材:public/image/qq-qr.jpg、public/image/wechat-qr.jpg
    const QR_PRESETS = {
      qq: {
        src: '/image/qq.png',
        kicker: '扫码加群',
        title: 'QQ 群 · 白银城持镜',
        hint: '打开手机 QQ「扫一扫」，或直接搜索群号',
        fallback: '二维码加载中<br>可先在 QQ 搜索群号<br><b>666487283</b>',
        showCopy: true,
      },
      wechat: {
        src: '/image/wx.png',
        kicker: '扫码添加',
        title: '官方微信 · 接待号',
        hint: '打开微信「扫一扫」添加，24 小时内通过',
        fallback: '二维码加载中<br>请稍后刷新页面再试',
        showCopy: false,
      },
    };

    let toastTimer = null;
    function showToast(msg) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add('is-show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('is-show'), 2200);
    }

    function openModal(type) {
      const cfg = QR_PRESETS[type];
      if (!cfg) return;

      kicker.textContent = cfg.kicker;
      title.textContent = cfg.title;
      hint.textContent = cfg.hint;
      copyBtn.hidden = !cfg.showCopy;
      copyValue.textContent = '666487283';

      // 重置图片与兜底文案;图片加载失败时展示兜底,避免破图
      fallback.hidden = true;
      fallback.innerHTML = cfg.fallback;
      img.hidden = false;
      img.onerror = () => {
        img.hidden = true;
        fallback.hidden = false;
      };
      img.src = cfg.src;

      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      lenis?.stop();
    }

    function closeModal() {
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      lenis?.start();
    }

    // QQ / 微信卡片点击
    $$('[data-qr]').forEach((card) => {
      card.addEventListener('click', () => openModal(card.dataset.qr));
    });

    // 点遮罩或关闭按钮
    modal.addEventListener('click', (e) => {
      if (e.target.closest('[data-qr-close]')) closeModal();
    });

    // Esc 关闭
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
    });

    // 复制群号(Clipboard API 与 execCommand 两级降级,任一成功即可)
    copyBtn.addEventListener('click', async () => {
      let ok = false;

      // 1) 现代 Clipboard API(需要安全上下文 + 用户点击手势)
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(QQ_GROUP);
          ok = true;
        }
      } catch {
        ok = false; // 权限被拒等情况,继续走降级
      }

      // 2) 降级:临时输入框 + execCommand('copy')
      if (!ok) {
        const input = document.createElement('input');
        input.value = QQ_GROUP;
        input.setAttribute('readonly', '');
        input.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
        document.body.appendChild(input);
        try {
          input.focus();
          input.select();
          input.setSelectionRange(0, input.value.length);
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
        input.remove();
      }

      showToast(ok ? '群号 666487283 已复制，去 QQ 粘贴搜索' : '复制失败，请手动输入群号 666487283');
    });
  }

  /* ---------- 10.2 THREE.JS SCENE — PATH 01 ---------- */
  let heroMirrorScene = null;
  function initHeroMirror() {
    const hero = document.querySelector('#hero');
    const path = document.querySelector('#path');
    if (!hero) return;

    heroMirrorScene = initPath01Scene();

    // 1) hero→path 连续滚动:驱动镜子的旋转 + 下沉
    ScrollTrigger.create({
      trigger: hero,
      start: 'top top',
      endTrigger: path,
      end: 'bottom bottom',
      scrub: true,
      onUpdate: (self) => {
        if (!heroMirrorScene) return;
        heroMirrorScene.update(self.progress);
      },
    });

    // 2) path section 专属滚动:驱动平面 mesh 的图片快速切换 + 视频淡入
    //    完全复刻 02 阶段 GSAP initPathFrames 的时间轴(FAST_END=0.4,ANIM_STOP=0.6)
    if (path) {
      ScrollTrigger.create({
        trigger: path,
        start: 'top top',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          if (!heroMirrorScene) return;
          heroMirrorScene.updatePathProgress(self.progress);
        },
      });
    }

    // 3) storyProgress:镜面破碎前移 + 慢动作
    //    trigger 绑定 path section 本身,start 从 path 滚过 65% 就启动(前移),
    //    end 到波浪滚出视口(窗口从 ~15vh 拉到 ~45vh = 视觉慢放 3 倍)
    const pathSec = document.querySelector('.path');
    const lastWave2 = document.querySelector('.wave-divider[data-wave="path-story"]');
    if (pathSec && lastWave2) {
      ScrollTrigger.create({
        trigger: pathSec,
        start: '65% bottom',   // path 滚过 65% → 立即启动
        endTrigger: lastWave2,
        end:   'bottom -10%',  // 波浪滚出视口 → 碎完
        scrub: true,
        onUpdate: (self) => {
          if (!heroMirrorScene) return;
          heroMirrorScene.updateStoryProgress(self.progress);
        },
      });
    } else if (lastWave2) {
      ScrollTrigger.create({
        trigger: lastWave2,
        start: 'top 110%',
        end:   'bottom -10%',
        scrub: true,
        onUpdate: (self) => {
          if (!heroMirrorScene) return;
          heroMirrorScene.updateStoryProgress(self.progress);
        },
      });
    }
  }

  /* ---------- BOOT ---------- */
  function boot() {
    gsap.registerPlugin(ScrollTrigger);
    initInitialHidden();

    const lenis = initLenis();

    // ↓ 波浪分割线最先启动 —— 活水循环 + 呼吸是独立 rAF，不阻塞后续动画
    initWaveDividers();
    initSigilStroke();      // Hero 仪式阵 stroke-dasharray 滚动描边
    initFooterOrnament();   // Footer 顶部装饰波浪描边

    ScrollTrigger.refresh();

    initCursor();
    initNav(lenis);
    initSectionTags();      // letter-spacing 呼吸
    initSplitTitles();      // char-by-char + 金色辉光
    initKineticTitles();    // 鼠标靠近时 char 向外散开(magicui KineticText 复刻)
    initParagraphReveal();  // 灰雾 clip-path 揭幕
    initScrollGallery();    // 图片 reveal（修复初始值）
    initHero();             // hero 入场 + fallback
    initAnimatedList();
    initCountUp();
    initPathItems();
    initPathFrames();
    initFeatureHover();
    initThemeToggle();
    initContactCards(lenis); // 联系卡片:二维码弹窗 + 复制群号
    initHeroMirror();

    window.addEventListener('resize', () => ScrollTrigger.refresh());
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initPreloader();
  } else {
    window.addEventListener('DOMContentLoaded', initPreloader);
  }

})();
