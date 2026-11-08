// Zoomable skill graph. Far: category hubs. Mid: skills. Near: level numbers and detail.
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

export const TIER_COLOR = { claim: '#9aa3b2', survey: '#2f6fed', badge: '#1a8f5a', reference: '#1a8f5a', test: '#7a3fe0' };
const STATUS_COLOR = { met: '#1a8f5a', close: '#c98a00', transferable: '#2f6fed', gap: '#c43d3d', missing: '#c43d3d' };

export function createGraph(container, { onSelect } = {}) {
  const svg = svgEl('svg', { role: 'img', 'aria-label': 'Skill graph' });
  const world = svgEl('g', {}, svg);
  container.appendChild(svg);
  let view = { x: 0, y: 0, k: 0.9 };
  let data = null, targetLevel = 0, selected = null;
  let nodeEls = new Map(), labelEls = [], levelEls = [], hubEls = [];

  const size = () => ({ w: svg.clientWidth || 800, h: svg.clientHeight || 600 });
  function apply() {
    world.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    const showSkill = view.k >= 1.1, showLevel = view.k >= 2.2;
    labelEls.forEach((l) => l.setAttribute('display', showSkill ? 'block' : 'none'));
    levelEls.forEach((l) => l.setAttribute('display', showLevel ? 'block' : 'none'));
    nodeEls.forEach((g) => g.setAttribute('opacity', view.k < 0.75 ? 0.35 : 1));
  }
  function center(cx, cy, k) {
    const { w, h } = size();
    return { x: w / 2 - cx * k, y: h / 2 - cy * k, k };
  }
  function animateTo(target) {
    const from = { ...view }, t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 350), e = 1 - (1 - p) ** 3;
      view = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e, k: from.k + (target.k - from.k) * e };
      apply();
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function zoomBy(f, px, py) {
    const { w, h } = size();
    px ??= w / 2; py ??= h / 2;
    const k = Math.max(0.3, Math.min(5, view.k * f));
    view = { x: px - ((px - view.x) / view.k) * k, y: py - ((py - view.y) / view.k) * k, k };
    apply();
  }

  svg.addEventListener('wheel', (e) => { e.preventDefault(); const r = svg.getBoundingClientRect(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  let drag = null;
  svg.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false }; });
  svg.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) { view.x = drag.vx + dx; view.y = drag.vy + dy; apply(); }
  });
  window.addEventListener('pointerup', () => { setTimeout(() => { drag = null; }, 0); });
  const wasDrag = () => drag && drag.moved;

  function layout(nodes, cats) {
    const pos = new Map(), hubs = new Map();
    const R = Math.max(260, 70 * cats.length);
    cats.forEach((c, i) => {
      const a = (2 * Math.PI * i) / cats.length - Math.PI / 2;
      const cx = R * Math.cos(a), cy = R * Math.sin(a);
      hubs.set(c.id, { x: cx, y: cy });
      const ns = nodes.filter((n) => n.cat === c.id).sort((p, q) => q.level - p.level || p.label.localeCompare(q.label));
      const rc = ns.length === 1 ? 0 : 38 + 15 * ns.length;
      ns.forEach((n, j) => {
        const b = (2 * Math.PI * j) / ns.length + a;
        pos.set(n.id, { x: cx + rc * Math.cos(b), y: cy + rc * Math.sin(b) });
      });
    });
    return { pos, hubs };
  }

  function draw() {
    world.replaceChildren();
    nodeEls = new Map(); labelEls = []; levelEls = []; hubEls = [];
    if (!data) return;
    const { pos, hubs } = layout(data.nodes, data.categories);
    const edgesG = svgEl('g', { stroke: '#cfd3dc', 'stroke-width': 1, fill: 'none' }, world);
    for (const e of data.edges) {
      const a = pos.get(e.a), b = pos.get(e.b);
      if (a && b) svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-opacity': 0.25 + 0.5 * e.w }, edgesG);
    }
    for (const c of data.categories) {
      const h = hubs.get(c.id);
      const g = svgEl('g', { style: 'cursor:pointer' }, world);
      svgEl('circle', { cx: h.x, cy: h.y, r: 26, fill: '#eef2fe', stroke: '#c5d6fb' }, g);
      const t = svgEl('text', { x: h.x, y: h.y - 34, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 600, fill: '#1d2330' }, g);
      t.textContent = c.label;
      const s = svgEl('text', { x: h.x, y: h.y + 4, 'text-anchor': 'middle', 'font-size': 11, fill: '#667085' }, g);
      s.textContent = c.avg ? `avg ${c.avg}` : '–';
      g.addEventListener('click', () => { if (!wasDrag()) animateTo(center(h.x, h.y, 2.0)); });
      hubEls.push(g);
    }
    for (const n of data.nodes) {
      const p = pos.get(n.id);
      const g = svgEl('g', { style: 'cursor:pointer', tabindex: 0 }, world);
      const r = 7 + 4 * n.level;
      if (n.required) {
        svgEl('circle', { cx: p.x, cy: p.y, r: 7 + 4 * n.required + 3, fill: 'none', stroke: STATUS_COLOR[n.status] || '#667085', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' }, g);
      }
      let stroke = '#fff', sw = 1.5;
      if (targetLevel && n.level > 0) { stroke = n.level >= targetLevel ? '#1a8f5a' : '#c43d3d'; sw = 3; }
      svgEl('circle', { cx: p.x, cy: p.y, r, fill: n.level ? TIER_COLOR[n.tier] || '#9aa3b2' : '#fff', stroke: n.level ? stroke : '#9aa3b2', 'stroke-width': sw, 'stroke-dasharray': n.level ? '' : '3 3', 'fill-opacity': n.level ? 0.35 + n.level * 0.13 : 1 }, g);
      const lbl = svgEl('text', { x: p.x, y: p.y + r + 13, 'text-anchor': 'middle', 'font-size': 11, fill: '#1d2330', display: 'none' }, g);
      lbl.textContent = n.label; labelEls.push(lbl);
      const lv = svgEl('text', { x: p.x, y: p.y + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#fff', display: 'none' }, g);
      lv.textContent = n.level ? String(n.level) : ''; levelEls.push(lv);
      g.addEventListener('click', () => { if (wasDrag()) return; selected = n.id; onSelect && onSelect(n); animateTo(center(p.x, p.y, Math.max(view.k, 2.4))); });
      nodeEls.set(n.id, g);
    }
    apply();
  }

  return {
    setData(d) { data = d; draw(); const { w, h } = size(); view = { x: w / 2, y: h / 2, k: Math.min(w, h) / 900 * 1.25 }; apply(); },
    setTargetLevel(l) { targetLevel = l; draw(); },
    zoomIn() { zoomBy(1.4); }, zoomOut() { zoomBy(1 / 1.4); },
    reset() { const { w, h } = size(); animateTo({ x: w / 2, y: h / 2, k: Math.min(w, h) / 900 * 1.25 }); },
    get selected() { return selected; },
  };
}
