/*
 * OBS Theme Inspector — the Variables, Changes and Problems tabs.
 *
 * The Changes tab is the only way out for edits: nothing is ever written
 * to the user's files. It shows where the changes go, lists them, and
 * gives three outputs: the edited file, a block to append, and a
 * comparison in the style of GitHub.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
(function () {
  'use strict';

  const app = window.OTI.app;
  const { state, el, $, ED } = app;
  const CONTEXT = 3;

  /* ------------------------------------------------------------------ */
  /* Variables                                                           */

  function setVar(name, original, value, live) {
    const ed = app.edits();
    let v = ed.vars.find(x => x.name === name);
    if (!v) {
      if (value === original) return;
      v = { name, original };
      ed.vars.push(v);
    }
    v.value = value;
    if (v.value === v.original) ed.vars.splice(ed.vars.indexOf(v), 1);
    app.applyTheme(live);
  }

  function renderVariables() {
    const body = $('#tab-vars');
    if (state.typing && body.contains(document.activeElement)) return;
    const filterInput = $('#var-filter');
    const filter = (filterInput.value || '').toLowerCase();
    body.querySelectorAll('.var-row, .var-hint').forEach(n => n.remove());
    if (!state.compiled) return;
    const ed = app.edits();
    body.append(el('p', { class: 'hint var-hint' }, 'Click a value to change the variable everywhere it is used. ',
      'The change goes to the @OBSThemeVars block of ', el('code', {}, state.gen.path), '.'));
    for (const [name, r] of state.compiled.replacements) {
      const src = r.source;
      const text = (src.text || '').trim();
      if (filter && !name.toLowerCase().includes(filter) && !(r.text || '').toLowerCase().includes(filter) &&
          !text.toLowerCase().includes(filter)) continue;
      const edit = ed.vars.find(x => x.name === name);
      const val = el('span', { class: 'val' });
      if (/^#[0-9a-f]{6}$/i.test(r.text || '')) val.append(el('span', { class: 'swatch', style: `background:${r.text}` }));
      const editable = src.file !== 'OBS';
      const shown = edit ? edit.value : text || r.text;
      const valueSpan = el('span', { class: editable ? 'editable' : '', title: editable ? 'Click to edit' : '' }, shown);
      if (editable) {
        valueSpan.addEventListener('click', () => {
          const original = edit ? edit.original : text;
          const input = el('input', { class: 'inline-edit', type: 'text', spellcheck: 'false' });
          input.value = shown;
          input.style.width = Math.max(8, shown.length + 2) + 'ch';
          valueSpan.replaceWith(input);
          input.focus();
          input.select();
          state.typing = true;
          let done = false, timer = 0;
          const finish = (value, cancelled) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            state.typing = false;
            input.blur();
            setVar(name, original, cancelled ? shown : value.trim(), false);
          };
          input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => setVar(name, original, input.value.trim(), true), 150);
          });
          input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
            if (e.key === 'Escape') { e.preventDefault(); finish(shown, true); }
          });
          input.addEventListener('blur', () => finish(input.value));
        });
      }
      val.append(valueSpan);
      if (r.text != null && r.text !== shown) val.append(' ', el('span', { class: 'r' }, '→ ' + r.text));
      if (edit) val.append(' ', el('button', { type: 'button', class: 'revert', title: 'Revert',
        onclick: () => setVar(name, edit.original, edit.original, false) }, '↺'));
      body.append(el('div', { class: 'var-row' + (edit ? ' edited' : '') },
        el('span', { class: 'name' }, '--' + name), val,
        el('span', { class: 'src' }, src.file === 'OBS' ? 'set by OBS (Settings › Appearance)' : `${src.file}:${src.line}`)));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Changes                                                             */

  function download(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      // Older browsers, or pages opened from disk where the clipboard API is refused.
      const area = el('textarea', { style: 'position:fixed;left:-9999px' });
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    const label = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => { button.textContent = label; }, 1200);
  }

  function describeRule(key) {
    const info = state.gen.ruleInfo(key);
    return `${info.file}:${info.line}  ${info.ruleText}`;
  }

  /** "Yami Classic" rather than "Classic": variants are named under their base theme in OBS. */
  function fullName(theme) {
    if (theme.isBaseTheme || !theme.parent) return theme.name;
    const base = state.themeSet.themes.get(theme.parent);
    return base ? `${base.name} ${theme.name}` : theme.name;
  }

  function renderTarget(body) {
    const g = state.gen;
    const theme = app.currentTheme();
    const t = g.target;
    const sec = el('section', { class: 'target' });
    if (t.kind === 'user') {
      sec.append(el('h2', {}, 'Changes go to'),
        el('p', {}, el('code', {}, g.path), ' (your file).'),
        el('p', { class: 'hint' }, 'Rules written in this file are changed where they are. ',
          'A change to a rule of a parent theme (', theme.dependencies.map(id => app.state.themeSet.themes.get(id).file.path).join(', '),
          ') is added at the end of this file as a rule with the same selectors: same specificity, later in the chain, so it wins. ',
          'Your file itself is never modified: copy or download the result below.'));
    } else {
      sec.append(el('h2', {}, 'Changes go to a new variant'),
        el('p', { class: 'hint' }, `${fullName(theme)} comes with OBS, and OBS replaces its files at every update. `,
          'Your changes go to a new variant that extends it and only holds the differences. ',
          'Put the downloaded file in your OBS themes folder, then pick it in Settings › Appearance.'));
      const field = (label, key, hint) => {
        const input = el('input', { type: 'text', spellcheck: 'false' });
        input.value = t[key] || '';
        input.addEventListener('change', () => {
          t[key] = input.value.trim();
          if (key === 'author') state.settings.author = t.author;
          app.applyTheme();
        });
        return el('label', { class: 'field' }, el('span', {}, label), input, hint ? el('small', {}, hint) : null);
      };
      sec.append(el('div', { class: 'fields' },
        field('Name', 'name', 'Shown under the base theme in Settings › Appearance'),
        field('ID', 'id', 'Must be unique among your themes'),
        field('File name', 'filename'),
        field('Author', 'author')));
    }
    body.append(sec);
  }

  function renderList(body) {
    const ed = app.edits();
    const items = [];
    const revert = fn => el('button', { type: 'button', class: 'revert', title: 'Revert', onclick: () => { fn(); app.applyTheme(); } }, '↺');
    for (const e of ed.decls) {
      const what = e.disabled ? `disabled ${e.prop}: ${e.value ?? e.original};`
        : `${e.prop}: ${e.original};  →  ${e.value};`;
      items.push(el('li', {}, el('div', { class: 'where' }, describeRule(e.ruleKey)), el('code', {}, what),
        revert(() => { ed.decls = ed.decls.filter(x => x !== e); })));
    }
    for (const a of ed.added) {
      items.push(el('li', {}, el('div', { class: 'where' }, describeRule(a.ruleKey)), el('code', {}, `+ ${a.prop}: ${a.value};`),
        revert(() => { ed.added = ed.added.filter(x => x !== a); })));
    }
    for (const r of ed.rules) {
      items.push(el('li', {}, el('div', { class: 'where' }, 'New rule'),
        el('code', {}, `${r.selector} { ${r.decls.map(d => `${d.prop}: ${d.value};`).join(' ')} }`),
        revert(() => { ed.rules = ed.rules.filter(x => x !== r); })));
    }
    for (const v of ed.vars) {
      items.push(el('li', {}, el('div', { class: 'where' }, 'Variable'), el('code', {}, `--${v.name}: ${v.original};  →  ${v.value};`),
        revert(() => { ed.vars = ed.vars.filter(x => x !== v); })));
    }
    const head = el('div', { class: 'rules-head' }, el('h2', {}, `Changes (${items.length})`));
    if (items.length) {
      head.append(el('button', { type: 'button', class: 'mini danger', onclick: () => {
        if (!confirm('Revert every change made to this theme?')) return;
        Object.assign(ed, { decls: [], added: [], rules: [], vars: [] });
        app.applyTheme();
      } }, 'Revert all'));
    }
    body.append(head);
    if (!items.length) {
      body.append(el('p', { class: 'hint' }, 'No change yet. Click a value in the Element or Variables tab to change it.'));
      return false;
    }
    body.append(el('ul', { class: 'change-list' }, ...items));
    return true;
  }

  function renderOutputs(body) {
    const g = state.gen;
    const s = state.settings;
    const modes = g.target.kind === 'new'
      ? [['file', 'New file'], ['diff', 'Comparison']]
      : [['file', 'Edited file'], ['append', 'Block to append'], ['diff', 'Comparison']];
    if (!modes.some(m => m[0] === s.output)) s.output = modes[0][0];

    const seg = el('div', { class: 'segmented' });
    for (const [id, label] of modes) {
      seg.append(el('button', { type: 'button', class: s.output === id ? 'active' : '',
                                onclick: () => { s.output = id; renderChanges(); } }, label));
    }
    body.append(el('h2', {}, 'Result'), seg);

    const bar = el('div', { class: 'out-bar' });
    body.append(bar);

    if (s.output === 'file') {
      const copyBtn = el('button', { type: 'button', class: 'mini' }, 'Copy');
      copyBtn.addEventListener('click', () => copy(g.text, copyBtn));
      bar.append(copyBtn, el('button', { type: 'button', class: 'mini', onclick: () => download(g.path.split('/').pop(), g.text) },
        `Download ${g.path.split('/').pop()}`));
      body.append(el('p', { class: 'hint' }, g.target.kind === 'new'
        ? 'The complete new variant.' : `The complete ${g.path}, with your changes applied.`));
      body.append(numbered(g.text));
    } else if (s.output === 'append') {
      const copyBtn = el('button', { type: 'button', class: 'mini' }, 'Copy');
      copyBtn.addEventListener('click', () => copy(g.appendBlock, copyBtn));
      bar.append(copyBtn);
      body.append(el('p', { class: 'hint' }, `Paste this at the end of ${g.path}. `,
        'Every change is written as a rule that repeats the original selectors, so it wins over the original, ',
        'and deleting the block undoes everything.'));
      body.append(g.appendBlock ? numbered(g.appendBlock) : el('p', { class: 'hint' }, 'No rule to append.'));
      if (g.varLines.length) {
        const copyVars = el('button', { type: 'button', class: 'mini' }, 'Copy');
        copyVars.addEventListener('click', () => copy(g.varLines.join('\n') + '\n', copyVars));
        body.append(el('h2', {}, 'Variables'),
          el('p', { class: 'hint' }, 'OBS only reads the first @OBSThemeVars block of a file, so variables cannot be appended. ',
            `Replace these lines in the @OBSThemeVars block at the top of ${g.path}, or add the ones it does not have.`),
          el('div', { class: 'out-bar' }, copyVars), numbered(g.varLines.join('\n')));
      }
    } else {
      const patch = unifiedPatch(g);
      const copyBtn = el('button', { type: 'button', class: 'mini' }, 'Copy as patch');
      copyBtn.addEventListener('click', () => copy(patch, copyBtn));
      const split = el('label', {}, el('input', { type: 'checkbox', checked: s.diffSplit || null,
        onchange: e => { s.diffSplit = e.target.checked; renderChanges(); } }), ' Side by side');
      const whole = el('label', {}, el('input', { type: 'checkbox', checked: s.diffWhole || null,
        onchange: e => { s.diffWhole = e.target.checked; renderChanges(); } }), ' Whole file');
      bar.append(split, whole, copyBtn);
      body.append(renderDiff(g.diff, !!s.diffSplit, !!s.diffWhole));
    }
  }

  function numbered(text) {
    const lines = text.replace(/\n$/, '').split('\n');
    const table = el('table', { class: 'code' });
    lines.forEach((t, i) => table.append(el('tr', {}, el('td', { class: 'ln' }, String(i + 1)), el('td', { class: 'tx' }, t))));
    return el('div', { class: 'code-wrap' }, table);
  }

  /* ------------------------------------------------------------------ */
  /* Comparison                                                          */

  /** Indexes of diff lines to show: changes and a few lines around them. */
  function visibleLines(diff, whole) {
    const show = new Array(diff.length).fill(whole);
    if (!whole) diff.forEach((d, i) => {
      if (d.type === 'eq') return;
      for (let k = Math.max(0, i - CONTEXT); k <= Math.min(diff.length - 1, i + CONTEXT); k++) show[k] = true;
    });
    return show;
  }

  function renderDiff(diff, split, whole) {
    if (!diff.some(d => d.type !== 'eq')) return el('p', { class: 'hint' }, 'No difference.');
    const show = visibleLines(diff, whole);
    const table = el('table', { class: 'diff' + (split ? ' split' : '') });
    const gap = n => table.append(el('tr', { class: 'gap' }, el('td', { colspan: split ? 4 : 3 },
      `⋯ ${n} unchanged line${n > 1 ? 's' : ''}`)));
    let hidden = 0;
    const flushGap = () => { if (hidden) { gap(hidden); hidden = 0; } };

    if (!split) {
      diff.forEach((d, i) => {
        if (!show[i]) { hidden++; return; }
        flushGap();
        const sign = d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' ';
        table.append(el('tr', { class: d.type },
          el('td', { class: 'ln' }, d.a ?? ''), el('td', { class: 'ln' }, d.b ?? ''),
          el('td', { class: 'tx' }, el('span', { class: 'sign' }, sign), d.text)));
      });
    } else {
      let i = 0;
      while (i < diff.length) {
        if (!show[i]) { hidden++; i++; continue; }
        flushGap();
        if (diff[i].type === 'eq') {
          const d = diff[i++];
          table.append(el('tr', { class: 'eq' }, el('td', { class: 'ln' }, d.a), el('td', { class: 'tx' }, d.text),
            el('td', { class: 'ln' }, d.b), el('td', { class: 'tx' }, d.text)));
          continue;
        }
        // Pair a run of removed lines with the added lines that follow.
        const dels = [], adds = [];
        while (i < diff.length && diff[i].type === 'del') dels.push(diff[i++]);
        while (i < diff.length && diff[i].type === 'add') adds.push(diff[i++]);
        for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
          const a = dels[k], b = adds[k];
          table.append(el('tr', {},
            el('td', { class: 'ln' + (a ? ' del' : ' empty') }, a ? a.a : ''), el('td', { class: 'tx' + (a ? ' del' : ' empty') }, a ? a.text : ''),
            el('td', { class: 'ln' + (b ? ' add' : ' empty') }, b ? b.b : ''), el('td', { class: 'tx' + (b ? ' add' : ' empty') }, b ? b.text : '')));
        }
      }
    }
    flushGap();
    return el('div', { class: 'code-wrap' }, table);
  }

  /** The comparison as a unified patch (git apply / GitHub compatible). */
  function unifiedPatch(g) {
    const name = g.path.split('/').pop();
    const diff = g.diff;
    const out = [`--- a/${name}`, `+++ b/${name}`];
    const show = visibleLines(diff, false);
    let i = 0;
    while (i < diff.length) {
      if (!show[i]) { i++; continue; }
      let j = i;
      while (j < diff.length && show[j]) j++;
      const hunk = diff.slice(i, j);
      const aStart = (hunk.find(d => d.a != null) || {}).a || 0;
      const bStart = (hunk.find(d => d.b != null) || {}).b || 0;
      const aLen = hunk.filter(d => d.type !== 'add').length;
      const bLen = hunk.filter(d => d.type !== 'del').length;
      out.push(`@@ -${aStart},${aLen} +${bStart},${bLen} @@`);
      for (const d of hunk) out.push((d.type === 'add' ? '+' : d.type === 'del' ? '-' : ' ') + d.text);
      i = j;
    }
    return out.join('\n') + '\n';
  }

  function renderChanges() {
    const body = $('#tab-changes');
    if (state.typing && body.contains(document.activeElement)) return;
    body.textContent = '';
    if (!state.gen) return;
    renderTarget(body);
    if (renderList(body)) renderOutputs(body);
  }

  /* ------------------------------------------------------------------ */
  /* Problems                                                            */

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
      body.append(el('div', { class: 'chain' }, 'Files applied, in order: ' +
        state.compiled.sources.map(s => s.path + (s.origin === 'new' ? ' (new)' : '')).join(' → ')));
    }
    if (!list.length) body.append(el('p', { class: 'hint' }, 'No problem found.'));
    for (const p of list) {
      body.append(el('div', { class: 'problem ' + (p.level || 'warn') },
        el('div', { class: 'where' }, p.file ? `${p.file}${p.line ? ':' + p.line : ''}` : ''),
        el('div', { class: 'msg' }, p.msg)));
    }
    $('#problem-count').textContent = list.length ? ` (${list.length})` : '';
  }

  app.renderVariables = renderVariables;
  app.renderChanges = renderChanges;
  app.renderProblems = renderProblems;
  app.showProblems = showProblems;

  document.addEventListener('DOMContentLoaded', () => {
    $('#var-filter').addEventListener('input', renderVariables);
  });
})();
