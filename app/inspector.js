/*
 * OBS Theme Inspector — the Element tab: the selected element, the rules
 * that reach it, and in-place editing of those rules.
 *
 * Editing works on the rule, not on the element: a change reaches every
 * element the rule targets, as it would in OBS. Those elements are
 * highlighted while a value is being edited.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
(function () {
  'use strict';

  const app = window.OTI.app;
  const { state, el, $, M, ED, E } = app;

  const STATE_TOGGLES = ['hover', 'pressed', 'focus', 'checked', 'selected', 'disabled'];
  // States copied into a suggested selector for a new rule.
  const SELECTOR_STATES = ['selected', 'checked', 'hover', 'pressed', 'disabled'];

  /* ------------------------------------------------------------------ */
  /* Edit operations                                                     */

  function nextId(ed) { return ed.nextId++; }

  function refresh(live) { app.applyTheme(live); }

  /** Sets (or clears, when back to the original) the value of an existing declaration. */
  function setDeclValue(ruleKey, declIndex, prop, original, value, live) {
    const ed = app.edits();
    let e = ed.decls.find(x => x.ruleKey === ruleKey && x.declIndex === declIndex);
    if (!e) {
      if (value === original) return;
      e = { id: nextId(ed), ruleKey, declIndex, prop, original };
      ed.decls.push(e);
    }
    e.value = value;
    if (e.value === original && !e.disabled) ed.decls.splice(ed.decls.indexOf(e), 1);
    refresh(live);
  }

  function toggleDecl(ruleKey, declIndex, prop, original) {
    const ed = app.edits();
    let e = ed.decls.find(x => x.ruleKey === ruleKey && x.declIndex === declIndex);
    if (!e) { e = { id: nextId(ed), ruleKey, declIndex, prop, original, value: null }; ed.decls.push(e); }
    e.disabled = !e.disabled;
    if (!e.disabled && (e.value == null || e.value === original)) ed.decls.splice(ed.decls.indexOf(e), 1);
    refresh();
  }

  function revertDecl(id) {
    const ed = app.edits();
    ed.decls = ed.decls.filter(x => x.id !== id);
    refresh();
  }

  function addDecl(ruleKey, prop, value) {
    const ed = app.edits();
    ed.added.push({ id: nextId(ed), ruleKey, prop, value });
    refresh();
  }

  function setAdded(id, value, live) {
    const a = app.edits().added.find(x => x.id === id);
    if (a) { a.value = value; refresh(live); }
  }

  function removeAdded(id) {
    const ed = app.edits();
    ed.added = ed.added.filter(x => x.id !== id);
    refresh();
  }

  function newRule(selector) {
    const ed = app.edits();
    const r = { id: nextId(ed), selector, decls: [] };
    ed.rules.push(r);
    refresh();
    return r;
  }

  /* ------------------------------------------------------------------ */
  /* Inline editing                                                      */

  /**
   * Replaces `span` with a text field. Typing previews live; Enter or
   * leaving the field keeps the value; Escape restores the previous one.
   * Up/Down arrows change the first number by 1 (Shift: 10, Alt: 0.1).
   */
  function editInPlace(span, initial, onValue, options = {}) {
    const input = el('input', { class: 'inline-edit', type: 'text', spellcheck: 'false' });
    input.value = initial;
    input.style.width = Math.max(6, initial.length + 2) + 'ch';
    span.replaceWith(input);
    input.focus();
    input.select();
    state.typing = true;
    if (options.onStart) options.onStart();
    let done = false;
    let timer = 0;
    const finish = (value, cancelled) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      state.typing = false;
      input.blur();
      if (options.onEnd) options.onEnd();
      onValue(value, false, cancelled);
    };
    input.addEventListener('input', () => {
      input.style.width = Math.max(6, input.value.length + 2) + 'ch';
      clearTimeout(timer);
      timer = setTimeout(() => onValue(input.value, true), 120);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(input.value); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(initial, true); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
        const replaced = input.value.replace(/-?\d*\.?\d+/, n => String(Math.round((parseFloat(n) + step) * 10) / 10));
        if (replaced !== input.value) {
          e.preventDefault();
          input.value = replaced;
          input.dispatchEvent(new Event('input'));
        }
      }
    });
    input.addEventListener('blur', () => finish(input.value));
  }

  /** A row with two fields to add a property, or a single field for a selector. */
  function inlineForm(fields, onSubmit, onCancel) {
    const inputs = fields.map(f => el('input', { class: 'inline-edit', type: 'text', placeholder: f.placeholder,
                                                 spellcheck: 'false', style: `width:${f.width || 14}ch` }));
    fields.forEach((f, i) => { if (f.value) inputs[i].value = f.value; });
    const submit = () => {
      const values = inputs.map(i => i.value.trim());
      if (values.every(Boolean)) onSubmit(...values);
    };
    for (const input of inputs) {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); submit(); }
        if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      });
    }
    const row = el('div', { class: 'decl adding' }, ...inputs.flatMap((input, i) => [input, fields[i].after || '']),
      el('button', { type: 'button', class: 'mini', onclick: submit }, 'Add'),
      el('button', { type: 'button', class: 'mini', onclick: onCancel }, 'Cancel'));
    setTimeout(() => inputs[0].focus());
    return row;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */

  function renderInspector() {
    const body = $('#tab-element');
    // Keep a value being typed in: re-rendering would steal the focus.
    if (state.typing) return;
    body.textContent = '';
    const target = state.selected;
    if (!target || !document.contains(target)) {
      body.append(el('p', { class: 'hint' },
        'Hover an element of the mock-up to see the rules that style it. ',
        el('kbd', {}, 'Ctrl'), ' + click (', el('kbd', {}, '⌘'), ' + click on a Mac) pins the selection; do it again to release it. ',
        'Click a value to change it: the change reaches every element the rule targets. ',
        'Nothing is written to your files; the Changes tab gives you the result.'));
      return;
    }

    // Breadcrumb of Qt ancestors.
    const chain = [];
    for (let p = target; p && p.id !== 'stage'; p = p.parentElement) if (p.dataset.t || p.dataset.sc) chain.unshift(p);
    const crumbs = el('div', { class: 'crumbs' });
    chain.forEach((node, i) => {
      if (i) crumbs.append(el('span', { class: 'sep' }, '›'));
      crumbs.append(el('a', { class: node === target ? 'current' : '', onclick: () => app.select(node, true) }, app.describe(node)));
    });
    body.append(crumbs);

    const widget = target.dataset.t ? target : app.ownerWidget(target);
    const facts = el('dl', { class: 'facts' });
    const fact = (k, v) => { if (v) facts.append(el('dt', {}, k), el('dd', {}, v)); };
    if (target.dataset.sc) fact('Sub-control', `::${target.dataset.sc} of ${app.describe(widget)}`);
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
        app.scheduleIcons();
        renderInspector();
      });
      states.append(el('label', {}, cb, ':' + s));
    }
    body.append(el('h2', {}, 'Force states'), states);

    renderRules(body, target, widget);
  }

  function suggestSelector(target, widget) {
    let sel = widget.dataset.type;
    if (widget.dataset.name) sel += '#' + widget.dataset.name;
    if (target.dataset.sc) sel += '::' + target.dataset.sc;
    for (const s of SELECTOR_STATES) if (M.hasState(target, s)) sel += ':' + s;
    return sel;
  }

  function matchingRules(target) {
    if (!state.css) return [];
    const layerIndex = new Map(state.css.layers.map((l, i) => [l, i]));
    const out = [];
    for (const r of state.css.rules) {
      let ok = false;
      try { ok = target.matches(r.css); } catch (e) { ok = false; }
      if (ok) out.push(r);
    }
    out.sort((a, b) => (layerIndex.get(a.layer) - layerIndex.get(b.layer)) || (a.order - b.order));
    // A rule with several selectors can match through more than one of them:
    // show it once, where its strongest matching selector puts it.
    const seen = new Map();
    for (const r of out) {
      const key = `${r.fileIndex}:${r.source.start}`;
      if (seen.has(key)) seen.get(key).matched.push(r.selector);
      else seen.set(key, Object.assign({}, r, { matched: [r.selector] }));
    }
    const grouped = [];
    const kept = new Set();
    for (let i = out.length - 1; i >= 0; i--) {
      const key = `${out[i].fileIndex}:${out[i].source.start}`;
      if (kept.has(key)) continue;
      kept.add(key);
      grouped.unshift(Object.assign(seen.get(key), { spec: out[i].spec, layer: out[i].layer, order: out[i].order,
                                                     selector: out[i].selector }));
    }
    return grouped;
  }

  function renderRules(body, target, widget) {
    const rules = matchingRules(target);
    const head = el('div', { class: 'rules-head' },
      el('h2', {}, `Matching rules (${rules.length}), strongest first`),
      el('button', { type: 'button', class: 'mini', title: 'Add a rule for this element to your changes',
                     onclick: () => {
                       const form = inlineForm([{ placeholder: 'selector', value: suggestSelector(target, widget), width: 40 }],
                         sel => { newRule(sel); }, () => form.remove());
                       head.after(form);
                     } }, '+ New rule'));
    body.append(head);
    if (!rules.length) {
      body.append(el('p', { class: 'hint' }, 'No rule of this theme targets this element: Qt draws it with its own style and the palette.'));
      return;
    }

    // Which rule wins each property (the last one in Qt's order that sets it).
    const winner = new Map();
    rules.forEach((r, ri) => r.decls.forEach(d => { if (d.css.length) winner.set(d.prop.toLowerCase(), ri); }));

    for (let ri = rules.length - 1; ri >= 0; ri--) {
      body.append(renderRule(rules[ri], ri, winner));
    }
  }

  function resolved(value) {
    return E.substitute(value, state.compiled.replacements);
  }

  /** Builds the view of one rule, with editing wired to the right kind of edit. */
  function renderRule(r, ri, winner) {
    const id = app.identifyRule(r);
    const ed = app.edits();
    const targets = app.rulesTargets(r);
    const g = state.gen;

    let label = null;
    let src = `${r.file}:${r.line}`;
    let views = [];
    let onAdd = null;
    let extra = null;

    if (id.kind === 'parent' || id.kind === 'own') {
      const own = id.kind === 'own';
      const decls = own ? id.rule.decls : r.decls;
      if (own) src = `${g.path}:${id.rule.line}`;
      decls.forEach((d, di) => {
        const e = ed.decls.find(x => x.ruleKey === id.key && x.declIndex === di);
        const compiledDecl = own ? r.decls.find(c => c.prop === d.prop) : d;
        views.push({
          prop: d.prop,
          value: own && e && e.value != null ? e.value : d.value,
          editValue: e && e.value != null ? e.value : d.value,
          notes: compiledDecl ? compiledDecl.notes : [],
          edited: own && !!e && e.value != null,
          changedElsewhere: !own && !!e,
          disabled: own && !!(e && e.disabled),
          toggle: own ? () => toggleDecl(id.key, di, d.prop, d.value) : null,
          revert: own && e ? () => revertDecl(e.id) : null,
          set: (v, live) => setDeclValue(id.key, di, d.prop, d.value, v, live),
        });
      });
      for (const a of ed.added.filter(x => x.ruleKey === id.key)) {
        if (!own) continue; // shown in the overriding rule instead
        views.push({ prop: a.prop, value: a.value, editValue: a.value, notes: [], added: true,
                     set: (v, live) => setAdded(a.id, v, live), revert: () => removeAdded(a.id) });
      }
      onAdd = (prop, value) => addDecl(id.key, prop, value);
    } else if (id.kind === 'override') {
      const info = g.ruleInfo(id.ruleKey);
      label = `Your change, overriding ${info.file}:${info.line}`;
      src = g.target.kind === 'new' ? `${g.path} (new)` : g.path;
      for (const ref of id.decls) {
        const e = ref.kind === 'decl' ? ed.decls.find(x => x.id === ref.id) : ed.added.find(x => x.id === ref.id);
        if (!e) continue;
        const compiledDecl = r.decls.find(c => c.prop === e.prop);
        views.push({ prop: e.prop, value: e.value, editValue: e.value, notes: compiledDecl ? compiledDecl.notes : [],
                     edited: true, added: ref.kind === 'added',
                     set: ref.kind === 'decl' ? (v, live) => setDeclValue(e.ruleKey, e.declIndex, e.prop, e.original, v, live)
                                              : (v, live) => setAdded(e.id, v, live),
                     revert: ref.kind === 'decl' ? () => revertDecl(e.id) : () => removeAdded(e.id) });
      }
      onAdd = (prop, value) => addDecl(id.ruleKey, prop, value);
    } else if (id.kind === 'rule') {
      const rule = ed.rules.find(x => x.id === id.id);
      if (!rule) return el('div');
      label = 'Your new rule';
      src = g.target.kind === 'new' ? `${g.path} (new)` : g.path;
      rule.decls.forEach((d, di) => {
        const compiledDecl = r.decls[di];
        views.push({ prop: d.prop, value: d.value, editValue: d.value, notes: compiledDecl ? compiledDecl.notes : [],
                     added: true,
                     set: (v, live) => { d.value = v; refresh(live); },
                     revert: () => { rule.decls.splice(di, 1); refresh(); } });
      });
      onAdd = (prop, value) => { rule.decls.push({ prop, value }); refresh(); };
      extra = el('button', { type: 'button', class: 'mini danger', title: 'Delete this rule',
                             onclick: ev => { ev.stopPropagation(); ed.rules = ed.rules.filter(x => x !== rule); refresh(); } }, 'Delete');
    }

    const header = el('div', { class: 'rule-head', title: 'Highlight every element this rule targets',
                               onclick: () => app.highlight(targets) },
      el('span', {}, el('span', { class: 'rule-sel', title: r.ruleText }, r.matched.join(', ')), ' ',
         el('span', { class: 'rule-spec' }, `(${r.spec.join(',')})`)),
      el('span', { class: 'rule-src' }, extra, ' ', src));
    const box = el('div', { class: 'rule' + (label ? ' mine' : '') });
    if (label) box.append(el('div', { class: 'rule-label' }, label));
    box.append(header);
    const decls = el('div', { class: 'decls' });
    for (const v of views) decls.append(renderDecl(v, ri, winner, targets));
    if (onAdd) {
      const add = el('button', { type: 'button', class: 'add-prop', title: id.kind === 'parent'
        ? 'Added to your file as an overriding rule' : 'Add a property to this rule' }, '+ property');
      add.addEventListener('click', () => {
        const form = inlineForm([{ placeholder: 'property', after: ': ' }, { placeholder: 'value', after: ';', width: 24 }],
          (prop, value) => onAdd(prop, value), () => { form.replaceWith(add); });
        add.replaceWith(form);
      });
      decls.append(add);
    }
    box.append(decls);
    box.append(el('div', { class: 'rule-foot' }, `${targets.length} element${targets.length === 1 ? '' : 's'} targeted`));
    return box;
  }

  function renderDecl(v, ri, winner, targets) {
    const overridden = v.disabled || winner.get(v.prop.toLowerCase()) !== ri;
    const cls = ['decl', overridden ? 'overridden' : '', v.edited ? 'edited' : '', v.added ? 'added' : '',
                 v.disabled ? 'disabled' : ''].filter(Boolean).join(' ');
    const line = el('div', { class: cls });
    if (v.toggle) {
      const cb = el('input', { type: 'checkbox', class: 'decl-toggle', title: 'Enable or disable this declaration' });
      cb.checked = !v.disabled;
      cb.addEventListener('change', v.toggle);
      line.append(cb);
    } else {
      line.append(el('span', { class: 'decl-toggle-spacer', title: v.added || v.edited ? '' :
        'A rule of a parent theme cannot be disabled from your file; change its value instead.' }));
    }
    const valueSpan = el('span', { class: 'v editable', title: 'Click to edit' }, v.value);
    valueSpan.addEventListener('click', () => {
      editInPlace(valueSpan, v.editValue, (value, live, cancelled) => {
        if (cancelled) { v.set(v.editValue, false); return; }
        v.set(value, live);
      }, {
        onStart: () => app.highlight(targets, true),
        onEnd: () => app.clearBoxes('rule'),
      });
    });
    line.append(el('span', { class: 'p' }, v.prop), ': ', valueSpan, ';');
    const r = resolved(v.value);
    if (r !== v.value) line.append(' ', el('span', { class: 'r' }, '→ ' + r));
    if (v.changedElsewhere) line.append(' ', el('span', { class: 'badge' }, 'changed in your file'));
    if (v.revert) line.append(' ', el('button', { type: 'button', class: 'revert', title: v.added ? 'Remove' : 'Revert',
                                                  onclick: v.revert }, v.added ? '✕' : '↺'));
    for (const n of v.notes || []) line.append(el('span', { class: 'note' }, n));
    return line;
  }

  app.renderInspector = renderInspector;
})();
