/*
 * OBS Theme Inspector — page logic: files, theme compilation, icons and
 * the inspector panel.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
(function () {
  'use strict';

  const E = window.OTI.engine;
  const Q = window.OTI.qss;
  const M = window.OTI.mock;
  const $ = sel => document.querySelector(sel);

  const STORAGE_KEY = 'oti.userFiles.v1';
  const SETTINGS_KEY = 'oti.settings.v1';

  const state = {
    bundle: window.OTI.bundles[0],
    userFiles: new Map(),       // path -> { path, text | dataUrl, origin: 'user' }
    themeSet: null,
    compiled: null,
    css: null,
    selected: null,             // element shown in the inspector
    locked: false,
    settings: { themeId: 'com.obsproject.Yami.Classic', fontScale: 10, density: 4, os: 'win', zoom: 1, highContrast: false },
    registered: new Set(),
    urlCache: new Map(),
  };

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */

  function loadStored() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (s) Object.assign(state.settings, s);
      const files = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      for (const f of files) state.userFiles.set(f.path, f);
    } catch (e) { /* storage unavailable: start fresh */ }
  }

  function saveStored() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.userFiles.values()]));
    } catch (e) { /* quota or file:// restrictions: keep working without saving */ }
  }

  /* ------------------------------------------------------------------ */
  /* URL resolution for theme:, :/res/images and relative paths          */

  function toDataUrl(path, content) {
    if (content.startsWith('data:')) return content;
    if (content.startsWith('base64:')) {
      const ext = path.split('.').pop().toLowerCase();
      return `data:image/${ext === 'svg' ? 'svg+xml' : ext};base64,${content.slice(7)}`;
    }
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(content);
  }

  function lookupTheme(rel) {
    // OBS searches its own themes folder first, then the user's.
    if (state.bundle.themes[rel] != null) return toDataUrl(rel, state.bundle.themes[rel]);
    const user = state.userFiles.get(rel);
    if (user) return toDataUrl(rel, user.content);
    // Files added one by one have no folder: fall back on the file name.
    const base = rel.split('/').pop();
    for (const f of state.userFiles.values()) {
      if (!f.path.includes('/') && f.path === base) return toDataUrl(f.path, f.content);
    }
    return null;
  }

  function resolveUrl(url) {
    if (state.urlCache.has(url)) return state.urlCache.get(url);
    let out = null;
    let m;
    if ((m = /^theme:(.+)$/.exec(url))) out = lookupTheme(m[1].replace(/^\/+/, ''));
    else if ((m = /^:?\/?(res|settings)\/(images\/.+)$/.exec(url))) {
      const c = state.bundle.images[m[2].slice('images/'.length)];
      out = c != null ? toDataUrl(m[2], c) : null;
    } else if ((m = /^\.?\/?(.+\.(svg|png))$/i.exec(url))) out = lookupTheme(m[1]);
    else if (/^data:/.test(url)) out = url;
    state.urlCache.set(url, out);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Theme compilation and application                                   */

  function allThemeFiles() {
    const files = [];
    for (const [path, text] of Object.entries(state.bundle.themes)) {
      if (/\.(obt|ovt|oha)$/i.test(path)) files.push({ path, text, origin: 'core' });
    }
    for (const f of state.userFiles.values()) {
      if (!/\.(obt|ovt|oha)$/i.test(f.path)) continue;
      // A copy of a core theme (e.g. the whole OBS themes folder) is not worth a warning.
      if (state.bundle.themes[f.path] === f.content) continue;
      files.push({ path: f.path, text: f.content, origin: 'user' });
    }
    return files;
  }

  function rebuildThemeSet() {
    state.urlCache.clear();
    state.themeSet = E.buildThemeSet(allThemeFiles());
    fillThemeSelect();
  }

  function fillThemeSelect() {
    const select = $('#theme');
    select.textContent = '';
    const themes = [...state.themeSet.themes.values()].filter(t => t.isVisible && !t.isHighContrast);
    const bases = themes.filter(t => t.isBaseTheme);
    for (const base of bases) {
      const group = document.createElement('optgroup');
      group.label = base.name;
      const own = document.createElement('option');
      own.value = base.id;
      own.textContent = `${base.name} (base)`;
      group.appendChild(own);
      for (const t of themes.filter(v => !v.isBaseTheme && v.parent === base.id)) {
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.dependencies.length > 1
          ? `${t.name}  (extends ${state.themeSet.themes.get(t.extends).name})` : t.name;
        if (t.file.origin === 'user') o.textContent += '  ★';
        group.appendChild(o);
      }
      select.appendChild(group);
    }
    if (!state.themeSet.themes.has(state.settings.themeId)) state.settings.themeId = 'com.obsproject.Yami.Classic';
    select.value = state.settings.themeId;
  }

  function registerCustomProps(names) {
    if (!window.CSS || !CSS.registerProperty) return;
    for (const name of names) {
      if (state.registered.has(name)) continue;
      try {
        // Not inherited: like Qt properties, they belong to the element they are set on.
        CSS.registerProperty({ name, syntax: '*', inherits: false });
      } catch (e) { /* already registered */ }
      state.registered.add(name);
    }
  }

  function applyTheme() {
    const s = state.settings;
    let compiled;
    try {
      compiled = E.compileTheme(state.themeSet, s.themeId, {
        fontScale: s.fontScale, density: s.density, os: s.os, highContrast: s.highContrast,
      });
    } catch (e) {
      showProblems([{ file: '', msg: e.message, level: 'error' }]);
      return;
    }
    const css = Q.compileCss(compiled, resolveUrl);
    registerCustomProps([...css.customProps, '--q-icon', '--q-icon-size', '--q-image',
                         '--q-titlebar-close-icon', '--q-titlebar-normal-icon']);
    state.compiled = compiled;
    state.css = css;

    // Layer order first, then one <style> per theme file (named in the browser's inspector).
    const host = $('#theme-styles');
    host.textContent = '';
    const order = document.createElement('style');
    order.textContent = `@layer qss { @layer ${css.layers.map(l => l.slice(4)).join(', ')}; }\n/*# sourceURL=qt-specificity-layers.css */`;
    host.appendChild(order);
    for (const sheet of css.sheets) {
      const st = document.createElement('style');
      st.dataset.file = sheet.path;
      st.textContent = sheet.css;
      host.appendChild(st);
    }

    // Palette: what Qt uses where no rule applies.
    const pal = E.palette(compiled);
    const stage = $('#stage');
    for (const prop of [...stage.style]) if (prop.startsWith('--pal-')) stage.style.removeProperty(prop);
    for (const [role, color] of Object.entries(pal)) stage.style.setProperty('--pal-' + role, color);

    $('#font-scale').disabled = !compiled.usesFontScale;
    $('#density').disabled = !compiled.usesDensity;
    $('#font-scale-label').classList.toggle('disabled', !compiled.usesFontScale);
    $('#density-label').classList.toggle('disabled', !compiled.usesDensity);

    requestAnimationFrame(() => { applyIcons(); renderInspector(); renderVariables(); renderProblems(); });
    saveStored();
  }

  /* ------------------------------------------------------------------ */
  /* Icons and images (qproperty-icon, titlebar icons, image:)           */

  function cssUrl(value) {
    const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(value || '');
    return m ? m[1] : null;
  }

  function sizeOf(value, fallback) {
    const n = parseFloat(value);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  function applyIcons() {
    const stage = $('#stage');
    for (const el of stage.querySelectorAll('[data-icon-default]')) {
      const cs = getComputedStyle(el);
      const url = cssUrl(cs.getPropertyValue('--qp-icon')) || cssUrl(cs.getPropertyValue('--q-icon')) ||
                  resolveUrl(el.dataset.iconDefault);
      const size = sizeOf(cs.getPropertyValue('--q-icon-size'), +el.dataset.iconSize);
      setIcon(el.querySelector(':scope > .q-icon'), url, size);
    }
    for (const el of stage.querySelectorAll('[data-icon-from]')) {
      // Dock title buttons take their icon from the dock (titlebar-*-icon).
      const owner = el.parentElement;
      const url = cssUrl(getComputedStyle(owner).getPropertyValue('--q-' + el.dataset.iconFrom));
      const size = sizeOf(getComputedStyle(el).getPropertyValue('--q-icon-size'), +el.dataset.iconSize);
      setIcon(el.querySelector(':scope > .q-icon'), url || resolveUrl(':/res/images/' +
        (el.dataset.iconFrom.includes('close') ? 'close.svg' : 'popout.svg')), size);
    }
    for (const el of stage.querySelectorAll('[data-sc], [data-t]')) {
      const url = cssUrl(getComputedStyle(el).getPropertyValue('--q-image'));
      let img = el.querySelector(':scope > .q-image');
      if (!url && !img) continue;
      if (!img) { img = document.createElement('span'); img.className = 'q-image'; el.prepend(img); }
      if (url) {
        img.textContent = ' ';
        img.style.backgroundImage = `url("${url}")`;
        img.style.width = img.style.height = '100%';
      } else {
        img.textContent = '';
        img.style.backgroundImage = '';
      }
    }
  }

  function setIcon(span, url, size) {
    if (!span) return;
    span.style.backgroundImage = url ? `url("${url}")` : '';
    span.style.width = span.style.height = size + 'px';
  }

  let iconFrame = 0;
  function scheduleIcons() {
    cancelAnimationFrame(iconFrame);
    iconFrame = requestAnimationFrame(applyIcons);
  }

  /* ------------------------------------------------------------------ */
  /* Highlight boxes                                                     */

  function clearBoxes(kind) {
    for (const b of document.querySelectorAll(kind ? `.hl.${kind}, .hl-label.${kind}` : '.hl, .hl-label')) b.remove();
  }

  function box(el, kind, label) {
    const r = el.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = 'hl ' + kind;
    Object.assign(b.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    document.body.appendChild(b);
    if (label) {
      const l = document.createElement('div');
      l.className = 'hl-label ' + kind;
      l.textContent = label;
      Object.assign(l.style, { left: r.left + 'px', top: Math.max(0, r.top - 20) + 'px' });
      document.body.appendChild(l);
    }
  }

  function describe(el) {
    if (el.dataset.sc) {
      const owner = ownerWidget(el);
      return `${owner ? owner.dataset.type : '?'}::${el.dataset.sc}`;
    }
    let s = el.dataset.type;
    if (el.dataset.name) s += '#' + el.dataset.name;
    if (el.dataset.clsProp) s += '.' + el.dataset.clsProp.split(' ').join('.');
    return s;
  }

  function ownerWidget(el) {
    let p = el.parentElement;
    while (p && (p.dataset.viewport !== undefined || !p.dataset.t)) p = p.parentElement;
    return p;
  }

  /* ------------------------------------------------------------------ */
  /* Inspector: element, matching rules                                  */

  function inspectable(target) {
    return target && target.closest && target.closest('#stage [data-sc], #stage [data-t]');
  }

  function select(el, lock) {
    state.selected = el;
    if (lock !== undefined) state.locked = lock;
    clearBoxes('hover');
    clearBoxes('locked');
    if (el) box(el, state.locked ? 'locked' : 'hover', describe(el));
    renderInspector();
  }

  function matchingRules(el) {
    if (!state.css) return [];
    const layerIndex = new Map(state.css.layers.map((l, i) => [l, i]));
    const out = [];
    for (const r of state.css.rules) {
      let ok = false;
      try { ok = el.matches(r.css); } catch (e) { ok = false; }
      if (ok) out.push(r);
    }
    out.sort((a, b) => (layerIndex.get(a.layer) - layerIndex.get(b.layer)) || (a.order - b.order));
    return out;
  }

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of children) if (c != null) e.append(c);
    return e;
  }

  const STATE_TOGGLES = ['hover', 'pressed', 'focus', 'checked', 'selected', 'disabled'];

  function renderInspector() {
    const body = $('#tab-element');
    body.textContent = '';
    const target = state.selected;
    if (!target || !document.contains(target)) {
      body.append(el('p', { class: 'hint' },
        'Hover an element of the mock-up to see the rules that style it. ',
        el('kbd', {}, 'Ctrl'), ' + click (', el('kbd', {}, '⌘'), ' + click on a Mac) pins the selection; do it again to release it. ',
        'Right-click › Inspect also works: each theme file appears under its own name in the browser’s Styles pane.'));
      return;
    }

    // Breadcrumb of Qt ancestors.
    const chain = [];
    for (let p = target; p && p.id !== 'stage'; p = p.parentElement) if (p.dataset.t || p.dataset.sc) chain.unshift(p);
    const crumbs = el('div', { class: 'crumbs' });
    chain.forEach((node, i) => {
      if (i) crumbs.append(el('span', { class: 'sep' }, '›'));
      crumbs.append(el('a', { class: node === target ? 'current' : '', onclick: () => select(node, true) }, describe(node)));
    });
    body.append(crumbs);

    const widget = target.dataset.t ? target : ownerWidget(target);
    const facts = el('dl', { class: 'facts' });
    const fact = (k, v) => { if (v) facts.append(el('dt', {}, k), el('dd', {}, v)); };
    if (target.dataset.sc) fact('Sub-control', `::${target.dataset.sc} of ${describe(widget)}`);
    fact('Qt class', widget.dataset.t.split(' ').join(' → '));
    fact('objectName', widget.dataset.name ? '#' + widget.dataset.name : '(none)');
    fact('class property', widget.dataset.clsProp ? widget.dataset.clsProp.split(' ').map(c => '.' + c).join(' ') : '(none)');
    const props = [...widget.attributes].filter(a => a.name.startsWith('data-p-')).map(a => `${a.name.slice(7)}=${a.value}`);
    fact('Properties', props.join('  '));
    body.append(facts);

    // State toggles, to preview :hover, :checked … without the mouse.
    const states = el('div', { class: 'states' });
    for (const s of STATE_TOGGLES) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = M.hasState(target, s);
      cb.addEventListener('change', () => {
        cb.checked ? M.addState(target, s) : M.removeState(target, s);
        scheduleIcons();
        renderInspector();
      });
      states.append(el('label', {}, cb, ':' + s));
    }
    body.append(el('h2', {}, 'Force states'), states);

    // Matching rules, in the order Qt applies them.
    const rules = matchingRules(target);
    body.append(el('h2', {}, `Matching rules (${rules.length}), in application order`));
    if (!rules.length) body.append(el('p', { class: 'hint' }, 'No rule of this theme targets this element: Qt draws it with its own style and the palette.'));
    const winner = new Map();
    rules.forEach((r, ri) => r.decls.forEach((d, di) => { if (d.css.length) winner.set(d.prop.toLowerCase(), `${ri}:${di}`); }));
    for (let ri = rules.length - 1; ri >= 0; ri--) {
      const r = rules[ri];
      const head = el('div', { class: 'rule-head', title: 'Highlight every element this rule targets',
                               onclick: () => highlightRule(r) },
        el('span', {}, el('span', { class: 'rule-sel' }, r.selector), ' ',
           el('span', { class: 'rule-spec' }, `(${r.spec.join(',')})`)),
        el('span', { class: 'rule-src' }, `${r.file}:${r.line}`));
      const decls = el('div', { class: 'decls' });
      r.decls.forEach((d, di) => {
        const overridden = winner.get(d.prop.toLowerCase()) !== `${ri}:${di}`;
        const line = el('div', { class: 'decl' + (overridden ? ' overridden' : '') },
          el('span', { class: 'p' }, d.prop), ': ', el('span', { class: 'v' }, d.value), ';');
        if (d.resolved !== d.value) line.append(' ', el('span', { class: 'r' }, '→ ' + d.resolved));
        for (const n of d.notes) line.append(el('span', { class: 'note' }, n));
        decls.append(line);
      });
      body.append(el('div', { class: 'rule' }, head, decls));
    }
  }

  function highlightRule(rule) {
    clearBoxes('rule');
    const stage = $('#stage');
    for (const node of stage.querySelectorAll('[data-t], [data-sc]')) {
      try { if (node.matches(rule.css)) box(node, 'rule'); } catch (e) { /* ignore */ }
    }
    setTimeout(() => clearBoxes('rule'), 2500);
  }

  /* ------------------------------------------------------------------ */
  /* Variables and problems tabs                                         */

  function renderVariables() {
    const body = $('#tab-vars');
    const filter = ($('#var-filter') && $('#var-filter').value || '').toLowerCase();
    body.querySelectorAll('.var-row').forEach(n => n.remove());
    if (!state.compiled) return;
    const rows = [];
    for (const [name, r] of state.compiled.replacements) {
      if (filter && !name.toLowerCase().includes(filter) && !(r.text || '').toLowerCase().includes(filter)) continue;
      const src = r.source;
      const val = el('span', { class: 'val' });
      if (/^#[0-9a-f]{6}$/i.test(r.text || '')) val.append(el('span', { class: 'swatch', style: `background:${r.text}` }));
      val.append(r.text == null ? '(unresolved)' : r.text);
      rows.push(el('div', { class: 'var-row' }, el('span', { class: 'name' }, '--' + name), val,
        el('span', { class: 'src' }, src.file === 'OBS' ? 'set by OBS (Settings › Appearance)' : `${src.file}:${src.line}`)));
    }
    body.append(...rows);
  }

  function renderProblems() {
    const list = [];
    for (const p of state.themeSet.problems) list.push({ ...p, level: 'warn' });
    if (state.compiled) for (const w of state.compiled.warnings) list.push({ ...w, level: 'warn' });
    if (state.css) {
      const seen = new Set();
      for (const r of state.css.rules) for (const d of r.decls) for (const n of d.notes) {
        const key = `${r.file}:${d.line}:${n}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ file: r.file, line: d.line, msg: n, level: 'warn' });
      }
    }
    showProblems(list);
  }

  function showProblems(list) {
    const body = $('#tab-problems');
    body.textContent = '';
    if (state.compiled) {
      body.append(el('div', { class: 'chain' }, 'Files applied, in order: ' + state.compiled.chain.map(t => t.file.path).join(' → ')));
    }
    if (!list.length) body.append(el('p', { class: 'hint' }, 'No problem found.'));
    for (const p of list) {
      body.append(el('div', { class: 'problem ' + (p.level || 'warn') },
        el('div', { class: 'where' }, p.file ? `${p.file}${p.line ? ':' + p.line : ''}` : ''),
        el('div', { class: 'msg' }, p.msg)));
    }
    $('#problem-count').textContent = list.length ? ` (${list.length})` : '';
  }

  /* ------------------------------------------------------------------ */
  /* Loading the user's files                                            */

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      if (/\.png$/i.test(file.name)) r.readAsDataURL(file); else r.readAsText(file);
    });
  }

  /**
   * Adds files. Paths are made relative to the themes folder: when the
   * chosen folder holds theme files directly, its own name is dropped
   * (".../themes/LJCS/popout.svg" -> "LJCS/popout.svg").
   */
  async function addFiles(entries) {
    const wanted = entries.filter(e => /\.(obt|ovt|oha|svg|png)$/i.test(e.path));
    const roots = new Set(wanted.map(e => e.path.split('/')[0]));
    const rootHoldsThemes = root => wanted.some(e => e.path.split('/').length === 2 && e.path.startsWith(root + '/') &&
                                                   /\.(obt|ovt|oha)$/i.test(e.path));
    for (const e of wanted) {
      let path = e.path;
      const root = path.split('/')[0];
      if (path.includes('/') && roots.has(root) && rootHoldsThemes(root)) path = path.slice(root.length + 1);
      state.userFiles.set(path, { path, content: await readFile(e.file), origin: 'user' });
    }
    rebuildThemeSet();
    // Show the first theme the user brought in.
    // Show one of the user's themes: the most derived one (e.g. "LJCS Classic" over "LJCS").
    const mine = [...state.themeSet.themes.values()].filter(t => t.file.origin === 'user' && t.isVisible && !t.isHighContrast);
    if (mine.length && !mine.some(t => t.id === state.settings.themeId)) {
      mine.sort((a, b) => b.dependencies.length - a.dependencies.length);
      state.settings.themeId = mine[0].id;
    }
    $('#theme').value = state.settings.themeId;
    updateUserFilesLabel();
    applyTheme();
  }

  function updateUserFilesLabel() {
    const themes = [...state.userFiles.keys()].filter(p => /\.(obt|ovt|oha)$/i.test(p));
    const images = state.userFiles.size - themes.length;
    $('#user-files').textContent = state.userFiles.size
      ? `Your files: ${themes.join(', ') || 'no theme'}${images ? ` + ${images} image${images > 1 ? 's' : ''}` : ''}`
      : 'Only the themes bundled with OBS 32.2.1 are loaded.';
    $('#clear-files').hidden = !state.userFiles.size;
  }

  async function walkEntry(entry, prefix, out) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: prefix + entry.name, file });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walkEntry(child, prefix + entry.name + '/', out);
      } while (batch.length);
    }
  }

  function setupFileInputs() {
    $('#add-files').addEventListener('click', () => $('#file-input').click());
    $('#add-folder').addEventListener('click', () => $('#folder-input').click());
    $('#file-input').addEventListener('change', e => {
      addFiles([...e.target.files].map(f => ({ path: f.name, file: f })));
      e.target.value = '';
    });
    $('#folder-input').addEventListener('change', e => {
      addFiles([...e.target.files].map(f => ({ path: f.webkitRelativePath || f.name, file: f })));
      e.target.value = '';
    });
    $('#clear-files').addEventListener('click', () => {
      state.userFiles.clear();
      rebuildThemeSet();
      updateUserFilesLabel();
      applyTheme();
    });

    let depth = 0;
    window.addEventListener('dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('dragging'); } });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
      e.preventDefault();
      depth = 0;
      document.body.classList.remove('dragging');
      const out = [];
      const items = [...(e.dataTransfer.items || [])];
      const entries = items.map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
      if (entries.length) for (const entry of entries) await walkEntry(entry, '', out);
      else for (const f of e.dataTransfer.files) out.push({ path: f.name, file: f });
      addFiles(out);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */

  function setupControls() {
    const s = state.settings;
    const fs = $('#font-scale');
    fs.value = s.fontScale;
    $('#font-scale-value').textContent = s.fontScale;
    fs.addEventListener('input', () => {
      s.fontScale = +fs.value;
      $('#font-scale-value').textContent = fs.value;
      applyTheme();
    });
    const density = $('#density');
    density.value = String(s.density);
    density.addEventListener('change', () => { s.density = +density.value; applyTheme(); });
    const os = $('#os');
    os.value = s.os;
    os.addEventListener('change', () => { s.os = os.value; applyTheme(); });
    const zoom = $('#zoom');
    zoom.value = String(s.zoom);
    const setZoom = () => { $('#stage').style.setProperty('--stage-zoom', s.zoom); };
    setZoom();
    zoom.addEventListener('change', () => { s.zoom = +zoom.value; setZoom(); saveStored(); });
    $('#theme').addEventListener('change', e => { s.themeId = e.target.value; applyTheme(); });

    for (const btn of document.querySelectorAll('.tabs button')) {
      btn.addEventListener('click', () => {
        for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b === btn);
        for (const t of document.querySelectorAll('.tab-body')) t.hidden = t.id !== btn.dataset.tab;
      });
    }
    $('#var-filter').addEventListener('input', renderVariables);

    // Resizable panel.
    const splitter = $('.splitter');
    splitter.addEventListener('pointerdown', e => {
      splitter.setPointerCapture(e.pointerId);
      const move = ev => document.documentElement.style.setProperty('--panel-width',
        Math.max(280, Math.min(window.innerWidth - 300, window.innerWidth - ev.clientX)) + 'px');
      const up = () => { splitter.removeEventListener('pointermove', move); splitter.removeEventListener('pointerup', up); };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });
  }

  function setupStage() {
    const stage = $('#stage');
    const win = M.build();
    stage.appendChild(win);
    M.wire(win, () => { scheduleIcons(); renderInspector(); });

    stage.addEventListener('mouseover', e => {
      scheduleIcons();
      if (state.locked) return;
      const t = inspectable(e.target);
      if (t && t !== state.selected) select(t);
    });
    stage.addEventListener('mouseout', scheduleIcons);
    stage.addEventListener('mousedown', scheduleIcons);
    stage.addEventListener('mouseup', scheduleIcons);
    stage.addEventListener('click', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const t = inspectable(e.target);
      if (state.locked && t === state.selected) select(t, false);
      else select(t, true);
    });
    $('#stage-wrap').addEventListener('scroll', () => select(state.selected));
    window.addEventListener('resize', () => select(state.selected));
    new ResizeObserver(() => { if (state.selected) select(state.selected); }).observe(stage);
  }

  /* ------------------------------------------------------------------ */

  function start() {
    loadStored();
    setupControls();
    setupStage();
    setupFileInputs();
    rebuildThemeSet();
    updateUserFilesLabel();
    applyTheme();
  }

  document.addEventListener('DOMContentLoaded', start);
})();
