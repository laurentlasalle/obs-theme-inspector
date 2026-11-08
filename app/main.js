/*
 * OBS Theme Inspector — page core: files, theme compilation with the
 * pending edits, icons, highlight boxes and controls.
 *
 * The Element tab lives in inspector.js; the Variables and Changes tabs in
 * changes.js. They share the `OTI.app` object defined here.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
(function () {
  'use strict';

  const E = window.OTI.engine;
  const Q = window.OTI.qss;
  const M = window.OTI.mock;
  const ED = window.OTI.editor;
  const $ = sel => document.querySelector(sel);

  const STORAGE_KEY = 'oti.userFiles.v1';
  const SETTINGS_KEY = 'oti.settings.v1';
  const EDITS_KEY = 'oti.edits.v1';
  const DEFAULT_THEME = 'com.obsproject.Yami';

  const state = {
    bundle: window.OTI.bundles[0],
    userFiles: new Map(),       // path -> { path, content, origin: 'user' }
    themeSet: null,
    compiled: null,
    css: null,
    gen: null,                  // edited target file and how its lines map to the original
    selected: null,             // element shown in the inspector
    locked: false,
    settings: { themeId: DEFAULT_THEME, fontScale: 10, density: 4, os: 'win', zoom: 1,
                highContrast: false, author: '', panelWidth: null },
    editsByTheme: {},           // theme id -> edits (see editor.js)
    registered: new Set(),      // custom properties registered with CSS.registerProperty
    urlCache: new Map(),        // theme URL -> data URL
    restored: {},               // theme id -> edits restored from the last session (see updateRestoreNotice)
    dirtyTabs: new Set(),       // hidden tabs to render when shown
  };

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */

  function loadStored() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      if (s) Object.assign(state.settings, s);
      const files = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      for (const f of files) state.userFiles.set(f.path, f);
      state.editsByTheme = JSON.parse(localStorage.getItem(EDITS_KEY) || '{}');
    } catch (e) { /* storage unavailable: start fresh */ }
    // Remember what was restored, to say so until the first new change.
    state.restored = {};
    for (const [id, ed] of Object.entries(state.editsByTheme)) {
      if (editCount(ed)) state.restored[id] = editsSnapshot(ed);
    }
  }

  function editsSnapshot(ed) {
    return JSON.stringify([ed.decls, ed.added, ed.rules, ed.vars]);
  }

  /** Banner shown while the current theme still holds the changes restored from the last session. */
  function updateRestoreNotice() {
    const notice = $('#restore-notice');
    const id = state.settings.themeId;
    const ed = state.editsByTheme[id];
    if (state.restored[id] && (!ed || editsSnapshot(ed) !== state.restored[id])) delete state.restored[id];
    if (!state.restored[id]) { notice.hidden = true; notice.textContent = ''; return; }
    const n = editCount(ed);
    notice.textContent = '';
    notice.append(
      el('span', {}, `${n} change${n === 1 ? '' : 's'} restored from your last session.`),
      el('span', { class: 'actions' },
        el('button', { type: 'button', class: 'mini danger', onclick: () => revertAll() }, 'Revert all'),
        el('button', { type: 'button', class: 'mini', onclick: () => {
          delete state.restored[id];
          updateRestoreNotice();
        } }, 'Dismiss')));
    notice.hidden = false;
  }

  /** Drops every change made to the current theme, after confirmation. */
  function revertAll() {
    if (!confirm('Revert every change made to this theme?')) return;
    Object.assign(edits(), { decls: [], added: [], rules: [], vars: [] });
    applyTheme();
  }

  function saveStored() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.userFiles.values()]));
      localStorage.setItem(EDITS_KEY, JSON.stringify(state.editsByTheme));
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
    // Parentheses and quotes escaped too: the URL is read back from CSS values.
    return 'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(content).replace(/[()'!*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
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
  /* Themes                                                              */

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
    for (const base of themes.filter(t => t.isBaseTheme)) {
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
    if (!state.themeSet.themes.has(state.settings.themeId)) state.settings.themeId = DEFAULT_THEME;
    select.value = state.settings.themeId;
  }

  function currentTheme() {
    return state.themeSet.themes.get(state.settings.themeId);
  }

  /* ------------------------------------------------------------------ */
  /* Edits of the current theme                                          */

  function edits() {
    const id = state.settings.themeId;
    if (!state.editsByTheme[id]) state.editsByTheme[id] = ED.emptyEdits(id);
    const ed = state.editsByTheme[id];
    const theme = currentTheme();
    // The target follows the theme: the user's own file, or a new variant.
    if (theme && (!ed.target || (theme.file.origin === 'user') !== (ed.target.kind === 'user'))) {
      ed.target = ED.defaultTarget(theme, state.settings.author);
    }
    return ed;
  }

  function editCount(ed = edits()) {
    return ed.decls.length + ed.added.length + ed.rules.length + ed.vars.length;
  }

  /** Forgets the edits aimed at a file whose content changed or was removed. */
  function dropEditsFor(path) {
    for (const [id, ed] of Object.entries(state.editsByTheme)) {
      if (ed.target && ed.target.kind === 'user' && ed.target.path === path) delete state.editsByTheme[id];
    }
  }

  /** Builds the edited target file, or the untouched one when nothing changed. */
  function generateTarget() {
    const theme = currentTheme();
    const ed = edits();
    const target = ed.target;
    const path = ED.targetPath(target);
    const originalText = target.kind === 'user' ? theme.file.text : ED.newVariantText(target);
    const targetVars = new Map(target.kind === 'user'
      ? E.parseVars(originalText, state.settings.os, [], path).map(v => [v.name, v]) : []);
    // The target's own rules, as written in the original file.
    const ownRules = new Map(Q.parseSheet(originalText).map(r => [ED.ruleKey(path, r.line, r.selectorText), r]));
    const ruleInfo = key => {
      const [file, line, ...rest] = key.split('|');
      return { file, line: +line, ruleText: rest.join('|') };
    };
    const hasEdits = editCount(ed) > 0;
    const out = hasEdits
      ? ED.generate(ed, { originalText, ownRules, ruleInfo, targetVars })
      : { text: originalText, appended: [], appendBlock: '', varLines: [] };
    const diff = ED.diffLines(originalText, out.text);
    return Object.assign(out, { target, path, originalText, diff, lineMap: ED.lineMap(diff), ownRules,
                                hasEdits, ruleInfo, targetVars });
  }

  /**
   * Tells where a compiled rule comes from, for editing:
   *   parent   a rule of a file above the target (edits become overriding rules)
   *   own      a rule written in the target file
   *   override a rule added by the tool to override a parent rule
   *   rule     a new rule added by the user
   */
  function identifyRule(r) {
    const g = state.gen;
    if (!g || r.file !== g.path) return { kind: 'parent', key: ED.ruleKey(r.file, r.line, r.ruleText) };
    const orig = g.lineMap.get(r.line);
    if (orig != null) {
      const key = ED.ruleKey(g.path, orig, r.ruleText);
      if (g.ownRules.has(key)) return { kind: 'own', key, rule: g.ownRules.get(key) };
    }
    const a = g.appended.find(x => r.line > x.line && r.line < x.line + x.lines);
    if (a) return Object.assign({ kind: a.ref.kind }, a.ref);
    return { kind: 'unknown' };
  }

  /* ------------------------------------------------------------------ */
  /* Compilation                                                         */

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

  /**
   * Compiles the theme with its edits and restyles the mock-up.
   * `live` skips re-rendering the panels (used while a value is being typed).
   */
  function applyTheme(live) {
    const s = state.settings;
    let compiled;
    try {
      state.gen = generateTarget();
      const g = state.gen;
      const options = { fontScale: s.fontScale, density: s.density, os: s.os, highContrast: s.highContrast };
      if (g.hasEdits && g.target.kind === 'user') options.textOverrides = new Map([[g.path, g.text]]);
      if (g.hasEdits && g.target.kind === 'new') options.extraSource = { path: g.path, text: g.text };
      compiled = E.compileTheme(state.themeSet, s.themeId, options);
    } catch (e) {
      console.error(e);
      app.showProblems([{ file: '', msg: e.message, level: 'error' }]);
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
    const n = editCount();
    $('#change-count').textContent = n ? ` (${n})` : '';
    updateRestoreNotice();

    refreshStage();
    requestAnimationFrame(() => {
      if (state.selected) select(state.selected);
      if (!live) app.renderAll();
    });
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

  /** `root` and the elements under it that match `selector`. */
  function within(root, selector) {
    const out = [...root.querySelectorAll(selector)];
    if (root.matches(selector)) out.unshift(root);
    return out;
  }

  /** Applies icons and images under `root` from the computed style of each element. */
  function applyIcons(root) {
    // Source icons are properties of the main window (qproperty-gameCapIcon …).
    const mainWindow = $('#stage [data-t~="QMainWindow"]');
    const windowStyle = mainWindow ? getComputedStyle(mainWindow) : null;
    const dark = !!(state.compiled && state.compiled.theme.dark);
    for (const node of within(root, '[data-icon-default], [data-icon-qp]')) {
      const cs = getComputedStyle(node);
      const url = cssUrl(cs.getPropertyValue('--qp-icon')) || cssUrl(cs.getPropertyValue('--q-icon')) ||
                  (node.dataset.iconQp && windowStyle &&
                   cssUrl(windowStyle.getPropertyValue('--qp-' + node.dataset.iconQp.toLowerCase()))) ||
                  (dark && node.dataset.iconDark && resolveUrl(node.dataset.iconDark)) ||
                  resolveUrl(node.dataset.iconDefault);
      const size = sizeOf(cs.getPropertyValue('--q-icon-size'), +node.dataset.iconSize);
      setIcon(node.querySelector(':scope > .q-icon'), url, size);
    }
    for (const node of within(root, '[data-icon-from]')) {
      // Dock title buttons take their icon from the dock (titlebar-*-icon).
      const url = cssUrl(getComputedStyle(node.parentElement).getPropertyValue('--q-' + node.dataset.iconFrom));
      const size = sizeOf(getComputedStyle(node).getPropertyValue('--q-icon-size'), +node.dataset.iconSize);
      setIcon(node.querySelector(':scope > .q-icon'), url || resolveUrl(':/res/images/' +
        (node.dataset.iconFrom.includes('close') ? 'close.svg' : 'popout.svg')), size);
    }
    // image: draws a picture over the element (indicators, arrows …).
    for (const node of within(root, '[data-sc], [data-t]')) {
      const url = cssUrl(getComputedStyle(node).getPropertyValue('--q-image'));
      let img = node.querySelector(':scope > .q-image');
      if (!url && !img) continue;
      if (!img) { img = document.createElement('span'); img.className = 'q-image'; node.prepend(img); }
      node.classList.toggle('has-image', !!url);
      img.textContent = url ? ' ' : '';
      img.style.backgroundImage = url ? `url("${url}")` : '';
      img.style.width = img.style.height = url ? '100%' : '';
    }
  }

  function setIcon(span, url, size) {
    if (!span) return;
    span.style.backgroundImage = url ? `url("${url}")` : '';
    span.style.width = span.style.height = size + 'px';
  }

  /**
   * Icons, painted widgets (meters, sliders, scroll bars) depend on the
   * computed style, which changes with :hover, :pressed … Refreshing them is
   * deferred to the next frame and limited to the part of the window that
   * changed: the top-level area (a dock, the preview …) holding `node`, or
   * the whole stage when no node is given.
   */
  const pendingAreas = new Set();
  let refreshFrame = 0;

  function refreshStage(node) {
    const stage = $('#stage');
    const area = node && node.closest && node.closest('.mock-window > *');
    pendingAreas.add(area && stage.contains(area) ? area : stage);
    if (!refreshFrame) refreshFrame = requestAnimationFrame(flushRefresh);
  }

  function flushRefresh() {
    refreshFrame = 0;
    const stage = $('#stage');
    const areas = pendingAreas.has(stage) ? [stage] : [...pendingAreas];
    pendingAreas.clear();
    for (const area of areas) {
      applyIcons(area);
      M.paintAll(area);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Highlight boxes and selection                                       */

  function clearBoxes(kind) {
    for (const b of document.querySelectorAll(kind ? `.hl.${kind}, .hl-label.${kind}` : '.hl, .hl-label')) b.remove();
  }

  function box(node, kind, label) {
    const r = node.getBoundingClientRect();
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

  function ownerWidget(node) {
    let p = node.parentElement;
    while (p && (p.dataset.viewport !== undefined || !p.dataset.t)) p = p.parentElement;
    return p;
  }

  function describe(node) {
    if (node.dataset.sc) {
      const owner = ownerWidget(node);
      return `${owner ? owner.dataset.type : '?'}::${node.dataset.sc}`;
    }
    let s = node.dataset.type;
    if (node.dataset.name) s += '#' + node.dataset.name;
    if (node.dataset.clsProp) s += '.' + node.dataset.clsProp.split(' ').join('.');
    return s;
  }

  function inspectable(target) {
    return target && target.closest && target.closest('#stage [data-sc], #stage [data-t]');
  }

  function select(node, lock) {
    const changed = node !== state.selected;
    state.selected = node;
    if (lock !== undefined) state.locked = lock;
    clearBoxes('hover');
    clearBoxes('locked');
    if (node && document.contains(node)) box(node, state.locked ? 'locked' : 'hover', describe(node));
    if (changed || lock !== undefined) app.renderInspector();
  }

  /** The elements of the mock-up a compiled rule targets. */
  function rulesTargets(rule) {
    try {
      return [...$('#stage').querySelectorAll(rule.css)];
    } catch (e) {
      return []; // a selector the browser rejects
    }
  }

  function highlight(nodes, persistent) {
    clearBoxes('rule');
    for (const node of nodes) box(node, 'rule');
    if (!persistent) setTimeout(() => clearBoxes('rule'), 2500);
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
    const rootHoldsThemes = root => wanted.some(e => e.path.split('/').length === 2 && e.path.startsWith(root + '/') &&
                                                   /\.(obt|ovt|oha)$/i.test(e.path));
    for (const e of wanted) {
      let path = e.path;
      const root = path.split('/')[0];
      if (path.includes('/') && rootHoldsThemes(root)) path = path.slice(root.length + 1);
      const content = await readFile(e.file);
      const previous = state.userFiles.get(path);
      // Edits made against an older version of this file would no longer line up.
      if (previous && previous.content !== content) dropEditsFor(path);
      state.userFiles.set(path, { path, content, origin: 'user' });
    }
    rebuildThemeSet();
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
      if (Object.values(state.editsByTheme).some(ed => ed.target && ed.target.kind === 'user' && editCount(ed)) &&
          !confirm('Your pending changes to these files will be lost. Remove your files anyway?')) return;
      for (const path of state.userFiles.keys()) dropEditsFor(path);
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
      const entries = [...(e.dataTransfer.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
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
    zoom.addEventListener('change', () => { s.zoom = +zoom.value; setZoom(); saveStored(); select(state.selected); });
    $('#theme').addEventListener('change', e => { s.themeId = e.target.value; applyTheme(); });

    for (const btn of document.querySelectorAll('.tabs button')) {
      btn.addEventListener('click', () => app.showTab(btn.dataset.tab));
    }

    // Resizable panel; its width is kept with the settings, a double click restores the default.
    const splitter = $('.splitter');
    const setWidth = w => {
      if (w) document.documentElement.style.setProperty('--panel-width',
        Math.max(280, Math.min(window.innerWidth - 300, w)) + 'px');
      else document.documentElement.style.removeProperty('--panel-width');
    };
    setWidth(state.settings.panelWidth);
    splitter.title = 'Drag to resize; double-click to restore the default width';
    splitter.addEventListener('dblclick', () => { state.settings.panelWidth = null; setWidth(null); saveStored(); });
    splitter.addEventListener('pointerdown', e => {
      splitter.setPointerCapture(e.pointerId);
      const move = ev => {
        state.settings.panelWidth = Math.max(280, Math.min(window.innerWidth - 300, window.innerWidth - ev.clientX));
        setWidth(state.settings.panelWidth);
      };
      const up = () => { splitter.removeEventListener('pointermove', move); splitter.removeEventListener('pointerup', up); saveStored(); };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });
  }

  function setupStage() {
    const stage = $('#stage');
    const win = M.build();
    stage.appendChild(win);
    M.wire(win, node => { refreshStage(node); app.renderInspector(); });
    new ResizeObserver(() => refreshStage()).observe(win);

    // Hover and press change styles: refresh the area left and the area entered.
    stage.addEventListener('mouseover', e => {
      refreshStage(e.target);
      if (e.relatedTarget) refreshStage(e.relatedTarget);
      if (state.locked) return;
      const t = inspectable(e.target);
      if (t && t !== state.selected) select(t);
    });
    stage.addEventListener('mouseout', e => { if (!stage.contains(e.relatedTarget)) refreshStage(e.target); });
    stage.addEventListener('mousedown', e => refreshStage(e.target));
    stage.addEventListener('mouseup', e => refreshStage(e.target));
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
  /* Shared helpers                                                      */

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null && c !== false) e.append(c);
    return e;
  }

  function showTab(id) {
    for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === id);
    for (const t of document.querySelectorAll('.tab-body')) t.hidden = t.id !== id;
    if (state.dirtyTabs.delete(id)) TAB_RENDERERS[id]();
  }

  // The Variables and Changes tabs are long to build: a hidden one is only
  // marked, and built when it is shown.
  const TAB_RENDERERS = {
    'tab-vars': () => app.renderVariables(),
    'tab-changes': () => app.renderChanges(),
  };

  function renderAll() {
    app.renderInspector();
    for (const [id, render] of Object.entries(TAB_RENDERERS)) {
      if ($('#' + id).hidden) state.dirtyTabs.add(id); else render();
    }
    app.renderProblems();
  }

  const app = {
    state, $, el, E, Q, M, ED,
    applyTheme, revertAll, edits, editCount, identifyRule, currentTheme, resolveUrl, saveStored,
    select, box, clearBoxes, describe, ownerWidget, rulesTargets, highlight, refreshStage, showTab,
    // Filled in by inspector.js and changes.js.
    renderInspector() {}, renderVariables() {}, renderChanges() {}, renderProblems() {}, showProblems() {},
    renderAll,
  };
  window.OTI.app = app;

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
