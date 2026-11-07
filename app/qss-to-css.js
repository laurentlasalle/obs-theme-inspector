/*
 * OBS Theme Inspector — Qt Style Sheet to CSS translation.
 *
 * The mock-up is plain HTML where every Qt widget is an element carrying:
 *   data-t     its Qt class and all its ancestors ("QPushButton QAbstractButton QWidget")
 *   data-qc    its "class" property, or its Qt class name when it has none
 *   data-name  its objectName
 *   data-s     its states ("checked selected disabled …")
 *   data-p-*   other Qt properties used by attribute selectors
 * Sub-controls (::item, ::title, ::indicator …) are child elements with data-sc.
 *
 * Qt orders rules by CSS2 specificity, then by source order. Translated
 * selectors do not keep that specificity, so every selector is wrapped in
 * :where() (specificity zero) and placed in a cascade layer named after its
 * Qt specificity. Layers are declared in ascending order, which makes the
 * browser apply rules exactly in Qt's order.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* QSS parsing                                                         */

  function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0, quote = null, start = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) { if (ch === quote && text[i - 1] !== '\\') quote = null; continue; }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === sep && depth === 0) { parts.push({ text: text.slice(start, i), start }); start = i + 1; }
    }
    parts.push({ text: text.slice(start), start });
    return parts;
  }

  /**
   * Parses QSS rules. `text` must already have its comments blanked out.
   * Returns [{ selectorText, selectors: [string], line, decls: [{ prop, value, line }] }].
   */
  function parseRules(text, lineOffset, baseOffset = 0) {
    const rules = [];
    let i = 0;
    const lineAt = idx => lineOffset + text.slice(0, idx).split('\n').length - 1;
    // Absolute offsets in the original file, used to write edits back.
    const abs = idx => baseOffset + idx;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const close = text.indexOf('}', open);
      if (close < 0) break;
      const rawSel = text.slice(i, open);
      const selStart = i + rawSel.search(/\S|$/);
      const selectorText = rawSel.trim().replace(/\s+/g, ' ');
      const body = text.slice(open + 1, close);
      const decls = [];
      for (const part of splitTopLevel(body, ';')) {
        const idx = part.text.indexOf(':');
        if (idx < 0) continue;
        const prop = part.text.slice(0, idx).trim();
        const value = part.text.slice(idx + 1).trim();
        if (!prop) continue;
        const partStart = open + 1 + part.start;
        const declPos = partStart + part.text.search(/\S/);
        const rawValue = part.text.slice(idx + 1);
        const valueStart = partStart + idx + 1 + (rawValue.length - rawValue.trimStart().length);
        const valueEnd = partStart + part.text.trimEnd().length;
        const end = partStart + part.text.length; // the ";" (or the "}")
        decls.push({ prop, value, line: lineAt(declPos),
                     start: abs(declPos), valueStart: abs(valueStart), valueEnd: abs(valueEnd), end: abs(end),
                     hasSemicolon: text[end] === ';' });
      }
      if (selectorText && !selectorText.startsWith('@')) {
        rules.push({
          selectorText,
          selectors: splitTopLevel(selectorText, ',').map(p => p.text.trim()).filter(Boolean),
          line: lineAt(selStart),
          decls,
          start: abs(selStart),
          open: abs(open),
          close: abs(close),
        });
      }
      i = close + 1;
    }
    return rules;
  }

  /* ------------------------------------------------------------------ */
  /* Selector translation                                                */

  const cssStr = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

  // Pseudo-states the browser can show by itself. The mock can also force
  // them through data-s, so the inspector can pin a hover or a press.
  const LIVE_STATES = { hover: ':hover', pressed: ':active', focus: ':focus' };
  // States that are always true in the mock (the window is active, nothing is a separate window).
  const ALWAYS_TRUE = new Set(['active']);

  function stateSelector(name, negated) {
    if (ALWAYS_TRUE.has(name)) return negated ? ':not(*)' : '';
    let sel = `[data-s~=${cssStr(name)}]`;
    if (name === 'enabled') sel = ':not([data-s~="disabled"])';
    if (LIVE_STATES[name]) sel = `:is(${LIVE_STATES[name]},${sel})`;
    return negated ? `:not(${sel})` : sel;
  }

  /** Splits one selector into compounds and combinators. */
  function tokenizeSelector(sel) {
    const out = [];
    let i = 0;
    let pendingComb = null;
    while (i < sel.length) {
      if (/\s/.test(sel[i])) { i++; if (!pendingComb) pendingComb = ' '; continue; }
      if (sel[i] === '>') { pendingComb = '>'; i++; continue; }
      const parts = [];
      while (i < sel.length && !/[\s>]/.test(sel[i])) {
        let m;
        const rest = sel.slice(i);
        if ((m = /^\*/.exec(rest))) parts.push({ kind: 'any' });
        else if ((m = /^::([\w-]+)/.exec(rest))) parts.push({ kind: 'sub', name: m[1] });
        else if ((m = /^:(!?)([\w-]+)/.exec(rest))) parts.push({ kind: 'state', name: m[2], neg: !!m[1] });
        else if ((m = /^#([\w-]+)/.exec(rest))) parts.push({ kind: 'id', name: m[1] });
        else if ((m = /^\.([\w-]+)/.exec(rest))) parts.push({ kind: 'class', name: m[1] });
        else if ((m = /^\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*("[^"]*"|'[^']*'|[^\]\s]*)\s*)?\]/.exec(rest))) {
          parts.push({ kind: 'attr', name: m[1], op: m[2] || null, value: m[3] != null ? m[3].replace(/^["']|["']$/g, '') : null });
        } else if ((m = /^[A-Za-z_][\w-]*/.exec(rest))) parts.push({ kind: 'type', name: m[0] });
        else throw new Error(`Unrecognized selector near "${rest}"`);
        i += m[0].length;
        // Attribute selectors may contain spaces inside brackets: handled by the regex above.
      }
      if (out.length) out.push({ comb: pendingComb || ' ' });
      pendingComb = null;
      out.push({ parts });
    }
    return out;
  }

  function specificity(tokens) {
    let a = 0, b = 0, c = 0;
    for (const t of tokens) {
      if (!t.parts) continue;
      for (const p of t.parts) {
        if (p.kind === 'id') a++;
        else if (p.kind === 'class' || p.kind === 'attr' || p.kind === 'state') b++;
        else if (p.kind === 'type' || p.kind === 'sub') c++;
      }
    }
    return [a, b, c];
  }

  function attrSelector(p) {
    const attr = p.name === 'class' ? 'data-qc' : 'data-p-' + p.name.toLowerCase();
    if (!p.op) return `[${attr}]`;
    return `[${attr}${p.op}${cssStr(p.value)}]`;
  }

  /** Translates one Qt selector. Returns { css, spec, subcontrol }. */
  function translateSelector(sel) {
    const tokens = tokenizeSelector(sel);
    let css = '';
    let subcontrol = null;
    tokens.forEach((t, idx) => {
      if (t.comb) { css += t.comb === '>' ? ' > ' : ' '; return; }
      let owner = '';
      let sub = null;
      let subStates = '';
      let hasBase = false;
      for (const p of t.parts) {
        if (p.kind === 'sub') { sub = p.name; continue; }
        if (sub) {
          if (p.kind === 'state') subStates += stateSelector(p.name, p.neg);
          continue;
        }
        switch (p.kind) {
          case 'any': owner += '[data-t]'; hasBase = true; break;
          case 'type': owner += `[data-t~=${cssStr(p.name)}]`; hasBase = true; break;
          case 'id': owner += `[data-name=${cssStr(p.name)}]`; break;
          case 'class': owner += `[data-qc~=${cssStr(p.name)}]`; break;
          case 'attr': owner += attrSelector(p); break;
          case 'state': owner += stateSelector(p.name, p.neg); break;
        }
      }
      if (!hasBase) owner = '[data-t]' + owner;
      if (sub) {
        if (idx !== tokens.length - 1) throw new Error('Sub-control in the middle of a selector (Qt rejects this rule too)');
        subcontrol = sub;
        const sc = `[data-sc=${cssStr(sub)}]${subStates}`;
        // A sub-control is a direct child of its widget, or of its viewport.
        css += `:is(${owner} > ${sc}, ${owner} > [data-viewport] > ${sc})`;
      } else {
        css += owner;
      }
    });
    return { css, spec: specificity(tokens), subcontrol };
  }

  /* ------------------------------------------------------------------ */
  /* Declaration translation                                             */

  // Properties whose syntax and meaning are close enough in CSS.
  const PASSTHROUGH = new Set([
    'background', 'background-color', 'background-image', 'background-repeat', 'background-position',
    'background-clip', 'background-origin', 'background-attachment',
    'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-style', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-width', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-radius', 'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius',
    'border-bottom-right-radius', 'border-image',
    'color', 'font', 'font-family', 'font-size', 'font-style', 'font-weight', 'text-decoration',
    'text-transform', 'text-align',
    'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'outline', 'outline-color', 'outline-style', 'outline-width', 'outline-offset', 'outline-radius',
    'opacity', 'left', 'top', 'right', 'bottom', 'position',
  ]);

  // Qt-only properties, kept as custom properties for the mock's scripts.
  const QT_CUSTOM = {
    'icon-size': '--q-icon-size',
    'image': '--q-image',
    'image-position': '--q-image-position',
    'titlebar-close-icon': '--q-titlebar-close-icon',
    'titlebar-normal-icon': '--q-titlebar-normal-icon',
    'subcontrol-origin': '--q-subcontrol-origin',
    'subcontrol-position': '--q-subcontrol-position',
    'icon': '--q-icon',
    'lineedit-password-character': '--q-lineedit-password-character',
    'messagebox-text-interaction-flags': '--q-messagebox-flags',
    'button-layout': '--q-button-layout',
    'dialogbuttonbox-buttons-have-icons': '--q-dialogbuttonbox-icons',
    'show-decoration-selected': '--q-show-decoration-selected',
    'paint-alternating-row-colors-for-empty-area': '--q-alt-rows-empty',
    'gridline-color': '--q-gridline-color',
  };
  // Inherited in CSS on purpose: items read them from their view.
  const QT_INHERITED = {
    'selection-color': '--q-selection-color',
    'selection-background-color': '--q-selection-background-color',
    'alternate-background-color': '--q-alternate-background-color',
  };

  /** Converts Qt-only value syntax: url(theme:…), palette(role), qlineargradient(). */
  function translateValue(value, ctx) {
    let v = value;
    v = v.replace(/url\(\s*(["']?)([^)"']*)\1\s*\)/g, (m, q, url) => {
      const resolved = ctx.resolveUrl(url.trim());
      if (!resolved) { ctx.note(`Image not found: ${url}`); return 'none'; }
      return `url("${resolved}")`;
    });
    v = v.replace(/palette\(\s*([\w-]+)\s*\)/g, (m, role) => `var(--pal-${role.toLowerCase()})`);
    v = v.replace(/q(linear|radial|conical)gradient\(([^()]*)\)/g, (m, kind, args) => {
      const g = convertGradient(kind, args);
      if (!g) ctx.note(`Gradient not translated: ${m}`);
      return g || 'none';
    });
    return v;
  }

  function convertGradient(kind, args) {
    if (kind !== 'linear') return null;
    const kv = {};
    const stops = [];
    for (const part of args.split(/,(?![^(]*\))/)) {
      const m = /^\s*([\w]+)\s*:\s*(.+?)\s*$/.exec(part);
      if (!m) continue;
      if (m[1] === 'stop') {
        const s = /^([\d.]+)\s+(.+)$/.exec(m[2]);
        if (s) stops.push(`${s[2]} ${parseFloat(s[1]) * 100}%`);
      } else kv[m[1]] = parseFloat(m[2]);
    }
    const dx = (kv.x2 || 0) - (kv.x1 || 0), dy = (kv.y2 || 0) - (kv.y1 || 0);
    const angle = Math.round(Math.atan2(dx, -dy) * 180 / Math.PI);
    return stops.length ? `linear-gradient(${angle}deg, ${stops.join(', ')})` : null;
  }

  /** Returns [{ prop, value }] CSS declarations, or [] with a note when untranslatable. */
  function translateDecl(prop, value, ctx) {
    const p = prop.toLowerCase();
    if (p.startsWith('qproperty-')) {
      const name = '--qp-' + p.slice('qproperty-'.length);
      ctx.customProps.add(name);
      return [{ prop: name, value: translateValue(value, ctx) }];
    }
    if (p === 'spacing') return [{ prop: 'gap', value }, { prop: '--q-spacing', value }];
    if (QT_CUSTOM[p]) { ctx.customProps.add(QT_CUSTOM[p]); return [{ prop: QT_CUSTOM[p], value: translateValue(value, ctx) }]; }
    if (QT_INHERITED[p]) return [{ prop: QT_INHERITED[p], value: translateValue(value, ctx) }];
    if (PASSTHROUGH.has(p)) {
      const v = translateValue(value, ctx);
      if (/var\(--/.test(v)) {
        // A variable OBS could not resolve stays as text: Qt rejects the declaration.
        ctx.note(`Unresolved variable in "${prop}: ${value}": Qt drops this declaration`);
        return [];
      }
      return [{ prop: p, value: v }];
    }
    ctx.note(`Property not translated: ${prop}`);
    return [];
  }

  /* ------------------------------------------------------------------ */
  /* Compiling a whole theme to CSS                                      */

  const layerName = s => `qss.s${s.map(n => String(n).padStart(2, '0')).join('_')}`;

  /**
   * compiled: result of engine.compileTheme(). resolveUrl(url) -> string | null.
   * Returns { sheets: [{ path, css, rules }], layers: [name], rules: [Rule], customProps: Set }.
   * Rule: { file, line, selector (Qt), css, spec, layer, order, decls: [{ prop, value, resolved, css: [] , notes: [] }] }
   */
  function compileCss(compiled, resolveUrl) {
    const E = window.OTI.engine;
    const allRules = [];
    const customProps = new Set();
    const layers = new Set();
    let order = 0;
    const sheets = [];

    compiled.sources.forEach((src, fileIndex) => {
      const clean = E.stripComments(src.text);
      const body = clean.slice(src.offset);
      const lineOffset = clean.slice(0, src.offset).split('\n').length;
      const rules = parseRules(body, lineOffset, src.offset);
      const out = [];
      for (const rule of rules) {
        const decls = rule.decls.map(d => {
          const notes = [];
          const missing = [];
          const resolved = E.substitute(d.value, compiled.replacements, n => missing.push(n));
          const ctx = { resolveUrl, note: msg => notes.push(msg), customProps };
          const css = translateDecl(d.prop, resolved, ctx);
          if (missing.length) notes.unshift(`Unknown variable: --${missing.join(', --')}`);
          return Object.assign({}, d, { resolved, css, notes });
        });
        for (const sel of rule.selectors) {
          let t;
          try {
            t = translateSelector(sel);
          } catch (e) {
            compiled.warnings.push({ file: src.path, line: rule.line, msg: `${e.message} (${sel})` });
            continue;
          }
          const layer = layerName(t.spec);
          layers.add(layer);
          const r = { file: src.path, fileIndex, origin: src.origin, line: rule.line, selector: sel,
                      ruleText: rule.selectorText, source: rule, css: t.css, spec: t.spec, layer,
                      order: order++, subcontrol: t.subcontrol, decls };
          allRules.push(r);
          const body = decls.flatMap(d => d.css).map(c => `  ${c.prop}: ${c.value};`).join('\n');
          if (body) out.push(`@layer ${layer} {\n/* ${src.path}:${rule.line}  ${sel} */\n:where(${t.css}) {\n${body}\n}\n}`);
        }
      }
      sheets.push({ path: src.path, css: out.join('\n') + `\n/*# sourceURL=${src.path.replace(/[^\w./-]/g, '_')} */` });
    });

    const sortedLayers = [...layers].sort();
    return { sheets, layers: sortedLayers, rules: allRules, customProps };
  }

  window.OTI = window.OTI || {};
  window.OTI.qss = { parseRules, translateSelector, translateDecl, compileCss, specificity, tokenizeSelector };
})();
