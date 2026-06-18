// Pan / zoom / hover enhancement island (SPEC §4.7 — an `on:visible` bootstrap
// that owns a canvas widget and registers cleanup on ctx.signal, the sanctioned
// pattern for "map instances / observers"). Pure progressive enhancement: the
// server-rendered graph is fully usable with this module absent (selection is
// real <a href> navigation). Loaded on first visibility, never eagerly.

export function Devtool$init(_event, ctx) {
  const root = document.querySelector('[data-pz-root]');
  if (!root || root.__pzInit) return; // idempotent — on:visible may re-fire after morph
  root.__pzInit = true;

  const wrap = root.closest('.canvas-wrap') || root.parentElement;
  const pz = root.querySelector('[data-pz]');
  if (!wrap || !pz) return;

  const signal = ctx && ctx.signal;
  const on = (el, ev, fn, opts) =>
    el.addEventListener(ev, fn, signal ? Object.assign({ signal }, opts || {}) : opts);
  const cssEsc = (s) => String(s).replace(/["\\]/g, '\\$&');

  // ---- transform state ----
  let scale = 1,
    tx = 0,
    ty = 0;
  const MIN = 0.35,
    MAX = 2.6;
  pz.style.transformOrigin = '0 0';
  pz.style.willChange = 'transform';
  const apply = () => {
    pz.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`;
  };

  // take layout over from the JS-off CSS centering
  wrap.style.overflow = 'hidden';
  wrap.style.alignItems = 'flex-start';
  wrap.style.justifyContent = 'flex-start';
  wrap.style.cursor = 'grab';

  const graphW = () => pz.scrollWidth || root.offsetWidth || 1;
  const graphH = () => pz.scrollHeight || root.offsetHeight || 1;

  const fit = () => {
    const w = wrap.clientWidth,
      h = wrap.clientHeight;
    const gW = graphW(),
      gH = graphH();
    let s = Math.min(1, (w - 56) / gW, (h - 56) / gH);
    if (!isFinite(s) || s <= 0) s = 1;
    scale = s;
    tx = Math.max(20, (w - gW * scale) / 2);
    ty = Math.max(20, (h - gH * scale) / 2);
    apply();
  };

  const zoomAround = (cx, cy, next) => {
    const n = Math.min(MAX, Math.max(MIN, next));
    const k = n / scale;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    scale = n;
    apply();
  };

  // ---- wheel zoom toward cursor ----
  on(
    wrap,
    'wheel',
    (e) => {
      e.preventDefault();
      const r = wrap.getBoundingClientRect();
      zoomAround(e.clientX - r.left, e.clientY - r.top, scale * Math.exp(-e.deltaY * 0.0015));
    },
    { passive: false },
  );

  // ---- drag to pan (background only; node links keep working) ----
  let dragging = false,
    sx = 0,
    sy = 0,
    stx = 0,
    sty = 0,
    moved = false;
  on(wrap, 'pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.node, .zoom, button, a')) return;
    dragging = true;
    moved = false;
    sx = e.clientX;
    sy = e.clientY;
    stx = tx;
    sty = ty;
    wrap.style.cursor = 'grabbing';
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {}
  });
  on(wrap, 'pointermove', (e) => {
    if (!dragging) return;
    tx = stx + (e.clientX - sx);
    ty = sty + (e.clientY - sy);
    if (Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) > 3) moved = true;
    apply();
  });
  const endDrag = () => {
    dragging = false;
    wrap.style.cursor = 'grab';
  };
  on(wrap, 'pointerup', endDrag);
  on(wrap, 'pointercancel', endDrag);

  // ---- hover highlight (1-hop neighborhood) ----
  let hovered = null;
  const clearHover = () => {
    if (!hovered) return;
    pz.querySelectorAll('.hov').forEach((el) => el.classList.remove('hov'));
    root.classList.remove('hovering');
    hovered = null;
  };
  const setHover = (node) => {
    clearHover();
    hovered = node;
    root.classList.add('hovering');
    node.classList.add('hov');
    const id = node.getAttribute('data-node-id');
    pz.querySelectorAll(`path[data-from="${cssEsc(id)}"], path[data-to="${cssEsc(id)}"]`).forEach(
      (p) => {
        p.classList.add('hov');
        const other =
          p.getAttribute('data-from') === id
            ? p.getAttribute('data-to')
            : p.getAttribute('data-from');
        const n2 = pz.querySelector(`.node[data-node-id="${cssEsc(other)}"]`);
        if (n2) n2.classList.add('hov');
      },
    );
  };
  on(wrap, 'pointerover', (e) => {
    if (dragging) return;
    const node = e.target.closest && e.target.closest('.node[data-node-id]');
    if (node && node !== hovered) setHover(node);
  });
  on(wrap, 'pointerout', (e) => {
    const node = e.target.closest && e.target.closest('.node[data-node-id]');
    if (node && (!e.relatedTarget || !node.contains(e.relatedTarget))) clearHover();
  });

  // ---- zoom buttons + reset ----
  wrap.querySelectorAll('[data-zoom]').forEach((btn) => {
    on(btn, 'click', (e) => {
      e.preventDefault();
      const kind = btn.getAttribute('data-zoom');
      if (kind === 'fit') return fit();
      const r = wrap.getBoundingClientRect();
      zoomAround(r.width / 2, r.height / 2, scale * (kind === 'in' ? 1.25 : 1 / 1.25));
    });
  });
  on(wrap, 'dblclick', (e) => {
    if (!e.target.closest('.node, .zoom')) fit();
  });

  // ---- keyboard a11y: arrows pan, +/- zoom, 0 fits ----
  on(wrap, 'keydown', (e) => {
    const step = 60;
    if (e.key === 'ArrowLeft') {
      tx += step;
      apply();
    } else if (e.key === 'ArrowRight') {
      tx -= step;
      apply();
    } else if (e.key === 'ArrowUp') {
      ty += step;
      apply();
    } else if (e.key === 'ArrowDown') {
      ty -= step;
      apply();
    } else if (e.key === '+' || e.key === '=')
      zoomAround(wrap.clientWidth / 2, wrap.clientHeight / 2, scale * 1.25);
    else if (e.key === '-') zoomAround(wrap.clientWidth / 2, wrap.clientHeight / 2, scale / 1.25);
    else if (e.key === '0') fit();
    else return;
    e.preventDefault();
  });
  wrap.tabIndex = wrap.tabIndex < 0 ? 0 : wrap.tabIndex;

  fit();
  on(window, 'resize', fit);
}
