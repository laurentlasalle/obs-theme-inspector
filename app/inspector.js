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
    const anchor = measureAnchor(body);
    const focusing = !!state.focusDecl;
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
    if (!focusing) restoreAnchor(body, anchor);
  }

  /* ------------------------------------------------------------------ */
  /* Scroll anchoring                                                    */
  /* Re-rendering rebuilds the panel, and what lies above the element the */
  /* user just touched may change height: keep that element in place.    */

  function anchorSelectors(node) {
    const out = [];
    const section = node.closest('[data-section]');
    const sec = section ? `[data-section="${section.dataset.section}"] ` : '';
    const rule = node.closest('.rule[data-ref]');
    const ref = rule ? `.rule[data-ref="${CSS.escape(rule.dataset.ref)}"]` : '';
    const decl = node.closest('.decl[data-prop], .c-row[data-prop]');
    if (decl) out.push(`${sec}${ref ? ref + ' ' : ''}.${decl.classList[0]}[data-prop="${CSS.escape(decl.dataset.prop)}"]`);
    if (ref) out.push(sec + ref);
    if (section) out.push(sec.trim());
    return out;
  }

  function rememberAnchor(ev) {
    const sels = anchorSelectors(ev.target);
    if (sels.length) state.anchor = { target: state.selected, sels };
  }

  function measureAnchor(body) {
    const a = state.anchor;
    if (!a || a.target !== state.selected || body.hidden) return null;
    const top = body.getBoundingClientRect().top;
    const found = a.sels.map(sel => body.querySelector(sel)).map(n => n ? n.getBoundingClientRect().top - top : null);
    return { sels: a.sels, offsets: found };
  }

  function restoreAnchor(body, m) {
    if (!m) return;
    const top = body.getBoundingClientRect().top;
    for (let i = 0; i < m.sels.length; i++) {
      if (m.offsets[i] === null) continue;
      const n = body.querySelector(m.sels[i]);
      if (!n) continue;
      body.scrollTop += (n.getBoundingClientRect().top - top) - m.offsets[i];
      return;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const body = $('#tab-element');
    body.addEventListener('pointerdown', rememberAnchor, true);
    body.addEventListener('focusin', rememberAnchor, true);
  });

  function suggestSelector(target, widget, withoutStates) {
    let sel = widget.dataset.type;
    if (widget.dataset.name) sel += '#' + widget.dataset.name;
    if (target.dataset.sc) sel += '::' + target.dataset.sc;
    if (!withoutStates) for (const s of SELECTOR_STATES) if (M.hasState(target, s)) sel += ':' + s;
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
      body.append(el('p', { class: 'hint' }, 'No rule of this theme targets this element directly.'));
    }

    const winner = winners(rules);
    const own = el('div', { 'data-section': 'rules' });
    for (let ri = rules.length - 1; ri >= 0; ri--) {
      own.append(renderRule(rules[ri], ri, winner));
    }
    body.append(own);

    // A sub-control is drawn with the font and colour of its widget.
    let inherited = null;
    if (target.dataset.sc) {
      const ownRules = rules;
      const blocked = new Set();
      for (const r of ownRules) for (const d of r.decls) if (d.css.length) for (const p of coveredBy(d.prop)) blocked.add(p);
      const ownerRules = matchingRules(widget);
      const ownerWinner = winners(ownerRules);
      const cards = [];
      for (let ri = ownerRules.length - 1; ri >= 0; ri--) {
        const card = renderRule(ownerRules[ri], ri, ownerWinner, { only: isInherited, blocked });
        if (card) cards.push(card);
      }
      inherited = { widget, rules: ownerRules };
      const section = el('div', { class: 'section inherited-section', 'data-section': 'inherited' },
        el('h2', {}, `Inherited from ${app.describe(widget)}`));
      if (cards.length) section.append(...cards);
      else section.append(el('p', { class: 'hint' }, 'No rule sets its font or colour: Qt uses the application font and palette.'));
      body.append(section);
    }

    renderComputed(body, target, widget, rules, inherited);

    // After adding a declaration from the Computed section, open it for editing.
    if (state.focusDecl) {
      const { ref, prop } = state.focusDecl;
      state.focusDecl = null;
      const card = body.querySelector(`.rule[data-ref="${CSS.escape(ref)}"]`);
      const value = card && card.querySelector(`.decl[data-prop="${CSS.escape(prop)}"] .v`);
      if (value) {
        value.scrollIntoView({ block: 'center' });
        value.click();
      }
    }
  }

  /** Which rule wins each property (the last one in Qt's order that sets it). */
  function winners(rules) {
    const winner = new Map();
    rules.forEach((r, ri) => r.decls.forEach(d => { if (d.css.length) winner.set(d.prop.toLowerCase(), ri); }));
    return winner;
  }

  /* ------------------------------------------------------------------ */
  /* Computed values                                                     */

  const INHERITED = new Set(['color', 'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-transform']);
  const isInherited = prop => INHERITED.has(prop.toLowerCase());

  const SIDES = ['top', 'right', 'bottom', 'left'];
  const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

  /** The computed properties shown, and the declarations able to set each one. */
  const COMPUTED = [
    { prop: 'font-family', from: ['font-family', 'font'] },
    { prop: 'font-size', from: ['font-size', 'font'] },
    { prop: 'font-weight', from: ['font-weight', 'font'] },
    { prop: 'font-style', from: ['font-style', 'font'] },
    { prop: 'text-transform', from: ['text-transform'] },
    { prop: 'text-align', from: ['text-align'] },
    { prop: 'color', from: ['color'] },
    { prop: 'background-color', from: ['background-color', 'background'] },
    { prop: 'background-image', from: ['background-image', 'background'] },
    ...SIDES.map(side => ({ prop: `border-${side}`, edit: 'border',
      from: ['border', `border-${side}`, 'border-width', 'border-style', 'border-color',
             `border-${side}-width`, `border-${side}-style`, `border-${side}-color`] })),
    { prop: 'border-radius', from: ['border-radius', ...CORNERS.map(c => `border-${c}-radius`)] },
    { prop: 'padding', from: ['padding', ...SIDES.map(s => `padding-${s}`)] },
    { prop: 'margin', from: ['margin', ...SIDES.map(s => `margin-${s}`)] },
    { prop: 'min-width', from: ['min-width'] },
    { prop: 'max-width', from: ['max-width'] },
    { prop: 'min-height', from: ['min-height'] },
    { prop: 'max-height', from: ['max-height'] },
    { prop: 'icon-size', from: ['icon-size'], css: '--q-icon-size' },
  ];

  /** The longhand properties a declaration sets (for "is this overridden"). */
  function coveredBy(prop) {
    const p = prop.toLowerCase();
    const out = new Set([p]);
    for (const c of COMPUTED) if (c.from.includes(p)) out.add(c.prop);
    return out;
  }

  function toHex(value) {
    return value.replace(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/g, (m, r, g, b, a) => {
      if (a !== undefined && +a === 0) return 'transparent';
      const hex = '#' + [r, g, b].map(n => (+n).toString(16).padStart(2, '0')).join('');
      return a !== undefined && +a < 1 ? `${hex} (${Math.round(a * 100)} %)` : hex;
    });
  }

  function computedValue(cs, c, target) {
    if (c.css) return cs.getPropertyValue(c.css).trim();
    if (c.prop.startsWith('border-') && SIDES.includes(c.prop.slice(7))) {
      const side = c.prop.slice(7);
      const w = cs.getPropertyValue(`border-${side}-width`);
      const st = cs.getPropertyValue(`border-${side}-style`);
      if (st === 'none' || parseFloat(w) === 0) return 'none';
      return toHex(`${w} ${st} ${cs.getPropertyValue(`border-${side}-color`)}`);
    }
    return toHex(cs.getPropertyValue(c.prop).trim());
  }

  /** Finds the declaration that sets a computed property: [rule, decl] or null. */
  function origin(rules, c) {
    for (let ri = rules.length - 1; ri >= 0; ri--) {
      const r = rules[ri];
      for (let di = r.decls.length - 1; di >= 0; di--) {
        const d = r.decls[di];
        if (d.css.length && c.from.includes(d.prop.toLowerCase())) return { rule: r, decl: d };
      }
    }
    return null;
  }

  function ruleRef(r) {
    const id = app.identifyRule(r);
    if (id.kind === 'override') return 'ov:' + id.ruleKey;
    if (id.kind === 'rule') return 'rule:' + id.id;
    return id.key || `${r.file}:${r.line}`;
  }

  function jumpTo(ref) {
    const card = $(`#tab-element .rule[data-ref="${CSS.escape(ref)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.remove('flash');
    void card.offsetWidth;
    card.classList.add('flash');
  }

  function renderComputed(body, target, widget, rules, inherited) {
    const cs = getComputedStyle(target);
    const table = el('div', { class: 'computed' });
    const rect = target.getBoundingClientRect();
    const zoom = state.settings.zoom || 1;
    table.append(el('div', { class: 'c-row' }, el('span', { class: 'c-prop' }, 'size'),
      el('span', { class: 'c-val' }, `${Math.round(rect.width / zoom)} × ${Math.round(rect.height / zoom)} px`),
      el('span', { class: 'c-src' }, 'layout (approximate)')));

    for (const c of COMPUTED) {
      const value = computedValue(cs, c, target);
      if (c.css && !value) continue;
      let src, ref = null, declared = null, fromTheme = false;
      const o = origin(rules, c);
      if (o) {
        src = `${o.rule.file}:${o.decl.line}`;
        ref = ruleRef(o.rule);
        declared = o.decl.value;
        fromTheme = true;
      } else if (inherited && isInherited(c.prop)) {
        const io = origin(inherited.rules, c);
        if (io) {
          src = `inherited from ${app.describe(inherited.widget)}, ${io.rule.file}:${io.decl.line}`;
          ref = ruleRef(io.rule);
          declared = io.decl.value;
          fromTheme = true;
        }
      }
      if (!src) src = isInherited(c.prop) || c.prop.includes('color') ? 'Qt default (application font, palette)' : 'Qt default';

      // Qt sizes fonts in points: show both.
      const shown = c.prop === 'font-size' && /px$/.test(value)
        ? `${value} (${Math.round(parseFloat(value) * 0.75 * 100) / 100}pt)` : value;
      const valSpan = el('span', { class: 'c-val editable', title: 'Click to set this property in a rule' }, shown || '—');
      valSpan.addEventListener('click', () => chooseDestination(row, target, widget, rules, c, declared || value));
      const srcEl = ref ? el('a', { class: 'c-src', onclick: () => jumpTo(ref) }, src) : el('span', { class: 'c-src' }, src);
      const row = el('div', { class: 'c-row' + (fromTheme ? '' : ' default'), 'data-prop': c.prop },
        el('span', { class: 'c-prop' }, c.prop), valSpan, srcEl);
      if (declared && declared !== value) valSpan.title = `Declared as ${declared}. Click to set this property in a rule.`;
      table.append(row);
    }
    body.append(el('div', { class: 'section computed-section', 'data-section': 'computed' }, el('h2', {}, 'Computed'), table));
  }

  /**
   * Asks where to set a property: a new rule for this element (default), or
   * one of the rules that already target it (rules tied to a state last).
   */
  function chooseDestination(row, target, widget, rules, c, initial) {
    const old = row.parentElement.querySelector('.chooser');
    if (old) old.remove();
    const prop = c.edit || c.prop;
    const value = /^(none|—)$/.test(initial) ? '' : initial;
    const base = suggestSelector(target, widget, true);
    const choices = [{ label: `New rule: ${base}`, hint: 'only what this selector targets', pick: () => {
      const ed = app.edits();
      const r = { id: nextId(ed), selector: base, decls: [{ prop, value: value || '0' }] };
      ed.rules.push(r);
      state.focusDecl = { ref: 'rule:' + r.id, prop };
      refresh();
    } }];
    const stateful = r => /:(?!:)/.test(r.matched.join(' ').replace(/::[\w-]+/g, ''));
    const sorted = [...rules].reverse().sort((a, b) => stateful(a) - stateful(b));
    for (const r of sorted) {
      choices.push({ label: r.matched.join(', '), hint: `${r.file}:${r.line}` + (stateful(r) ? ' (only in that state)' : ''),
                     pick: () => setInRule(r, prop, value) });
    }
    const box = el('div', { class: 'chooser' },
      el('div', { class: 'chooser-title' }, `Set ${prop} in:`),
      ...choices.map((ch, i) => el('button', { type: 'button', class: 'choice' + (i === 0 ? ' default' : ''),
        onclick: () => { box.remove(); ch.pick(); } }, el('span', {}, ch.label), el('small', {}, ch.hint))),
      el('button', { type: 'button', class: 'mini', onclick: () => box.remove() }, 'Cancel'));
    row.after(box);
    box.querySelector('.choice').focus();
  }

  /** Adds (or opens) a declaration of `prop` in an existing rule, then edits it. */
  function setInRule(r, prop, value) {
    const id = app.identifyRule(r);
    const ed = app.edits();
    const p = prop.toLowerCase();
    if (id.kind === 'rule') {
      const rule = ed.rules.find(x => x.id === id.id);
      if (!rule.decls.some(d => d.prop.toLowerCase() === p)) rule.decls.push({ prop, value: value || '0' });
      state.focusDecl = { ref: 'rule:' + id.id, prop };
    } else if (id.kind === 'override') {
      const has = id.decls.some(ref => {
        const e = ref.kind === 'decl' ? ed.decls.find(x => x.id === ref.id) : ed.added.find(x => x.id === ref.id);
        return e && e.prop.toLowerCase() === p;
      });
      if (!has) ed.added.push({ id: nextId(ed), ruleKey: id.ruleKey, prop, value: value || '0' });
      state.focusDecl = { ref: 'ov:' + id.ruleKey, prop };
    } else {
      const decls = id.kind === 'own' ? id.rule.decls : r.decls;
      const exists = decls.some(d => d.prop.toLowerCase() === p);
      if (!exists) ed.added.push({ id: nextId(ed), ruleKey: id.key, prop, value: value || '0' });
      // A declaration added to a parent rule shows up in the overriding rule.
      state.focusDecl = { ref: id.kind === 'own' || exists ? id.key : 'ov:' + id.key, prop };
    }
    refresh();
  }

  function resolved(value) {
    return E.substitute(value, state.compiled.replacements);
  }

  /** Builds the view of one rule, with editing wired to the right kind of edit. */
  function renderRule(r, ri, winner, opts = {}) {
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

    if (opts.only) {
      views = views.filter(v => opts.only(v.prop));
      if (!views.length) return null;
      onAdd = null;
    }

    const header = el('div', { class: 'rule-head', title: 'Highlight every element this rule targets',
                               onclick: () => app.highlight(targets) },
      el('span', {}, el('span', { class: 'rule-sel', title: r.ruleText }, r.matched.join(', ')), ' ',
         el('span', { class: 'rule-spec' }, `(${r.spec.join(',')})`)),
      el('span', { class: 'rule-src' }, extra, ' ', src));
    const box = el('div', { class: 'rule' + (label ? ' mine' : '') + (opts.only ? ' inherited' : ''), 'data-ref': ruleRef(r) });
    if (label) box.append(el('div', { class: 'rule-label' }, label));
    box.append(header);
    const decls = el('div', { class: 'decls' });
    for (const v of views) decls.append(renderDecl(v, ri, winner, targets, opts.blocked));
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

  function renderDecl(v, ri, winner, targets, blocked) {
    // Overridden by a later rule, or (inherited section) set on the element itself.
    const overridden = v.disabled || winner.get(v.prop.toLowerCase()) !== ri ||
                       (blocked && [...coveredBy(v.prop)].some(p => blocked.has(p)));
    const cls = ['decl', overridden ? 'overridden' : '', v.edited ? 'edited' : '', v.added ? 'added' : '',
                 v.disabled ? 'disabled' : ''].filter(Boolean).join(' ');
    const line = el('div', { class: cls, 'data-prop': v.prop });
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
    if (v.revert) line.append(' ', el('button', { type: 'button', class: 'revert',
                                                  title: v.added ? 'Remove' : v.disabled ? 'Revert (same as ticking the box)' : 'Revert',
                                                  onclick: v.revert }, v.added ? '✕' : '↺'));
    for (const n of v.notes || []) line.append(el('span', { class: 'note' }, n));
    return line;
  }

  app.renderInspector = renderInspector;
})();
