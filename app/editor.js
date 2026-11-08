/*
 * OBS Theme Inspector — editing model.
 *
 * Edits never touch the loaded files. They are kept apart and turned, on
 * demand, into one of three outputs:
 *   - the edited target file, complete;
 *   - a block to append at the end of the target file;
 *   - a line-by-line comparison between the original and the edited file.
 *
 * The target is the user's own file of the theme being viewed. When the
 * theme comes with OBS (Yami, Yami Classic …), a new variant extending it
 * is created instead, since OBS's own files are replaced at every update.
 *
 * Rules of parent themes are never edited in place: a rule with the same
 * selectors is added at the end of the target file. It has the same
 * specificity and comes later, so it wins, exactly as it would in OBS.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
(function () {
  'use strict';

  const E = window.OTI.engine;
  const Q = window.OTI.qss;

  const APPEND_HEADER = '/* Changes made with OBS Theme Inspector */';

  /** A rule is identified by its file, line and selector text in the original files. */
  const ruleKey = (file, line, ruleText) => `${file}|${line}|${ruleText}`;

  function emptyEdits(themeId) {
    return { themeId, target: null, decls: [], added: [], rules: [], vars: [], nextId: 1 };
  }

  /* ------------------------------------------------------------------ */
  /* Target file                                                         */

  function slug(text) {
    // Accents removed: "é" becomes "e".
    return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
  }

  /** Describes where edits of `theme` go. */
  function defaultTarget(theme, author) {
    if (theme.file.origin === 'user') return { kind: 'user', path: theme.file.path };
    // OBS lists a variant under its base theme, so "Classic (custom)" shows as a style of Yami.
    const name = `${theme.name} (custom)`;
    const base = theme.id.replace(/^com\.obsproject\./, '');
    return {
      kind: 'new',
      name,
      id: `custom.${base.split('.').map(slug).join('.')}`,
      filename: `${base.split('.').join('_')}_Custom.ovt`,
      author: author || '',
      extends: theme.id,
      dark: theme.dark,
    };
  }

  function newVariantText(t) {
    const q = s => `'${String(s).replace(/'/g, '')}'`;
    return [
      '/* Variant created with OBS Theme Inspector.',
      ` * It extends ${t.extends} and only holds the differences. */`,
      '',
      '@OBSThemeMeta {',
      `    name: ${q(t.name)};`,
      `    id: ${q(t.id)};`,
      `    extends: ${q(t.extends)};`,
      `    author: ${q(t.author)};`,
      `    dark: ${q(t.dark ? 'true' : 'false')};`,
      '}',
      '',
      '@OBSThemeVars {',
      '}',
      '',
    ].join('\n');
  }

  function targetPath(target) {
    return target.kind === 'user' ? target.path : target.filename;
  }

  /* ------------------------------------------------------------------ */
  /* Text helpers                                                        */

  function lineStart(text, pos) { return text.lastIndexOf('\n', pos - 1) + 1; }

  /** True when only whitespace precedes `pos` on its line. */
  function aloneOnLine(text, pos) { return /^\s*$/.test(text.slice(lineStart(text, pos), pos)); }

  function indentOf(text, pos) { return /^[ \t]*/.exec(text.slice(lineStart(text, pos)))[0]; }

  /** One selector per line, as OBS's own themes are written. */
  function formatSelectors(ruleText) {
    return Q.splitTopLevel(ruleText, ',').map(p => p.text.trim()).filter(Boolean).join(',\n');
  }

  function ruleBlock(comment, selectorText, decls, indent = '    ') {
    const lines = [];
    if (comment) lines.push(`/* ${comment} */`);
    lines.push(...formatSelectors(selectorText).split('\n').map((l, i, a) => i === a.length - 1 ? l + ' {' : l));
    for (const d of decls) lines.push(`${indent}${d.prop}: ${d.value};`);
    lines.push('}');
    return lines;
  }

  /* ------------------------------------------------------------------ */
  /* Generation                                                          */

  /**
   * ctx: { originalText, ownRules: Map(ruleKey -> rule parsed from the target),
   *        ruleInfo(key) -> { file, line, ruleText }, targetVars: Map(name -> var parsed from the target) }
   * Returns { text, appended: [{ line, lines, ref }], appendBlock, varLines }
   * (appended: where each added rule sits in `text`, and what it holds).
   */
  function generate(edits, ctx) {
    const original = ctx.originalText;
    const targetRules = ctx.ownRules;
    const ops = []; // { start, end, text } on the original text

    // 1. Declarations of the target's own rules: edited in place.
    const overrideGroups = new Map(); // ruleKey -> { info, decls: [] }
    const group = key => {
      if (!overrideGroups.has(key)) overrideGroups.set(key, { info: ctx.ruleInfo(key), decls: [] });
      return overrideGroups.get(key);
    };
    for (const e of edits.decls) {
      const own = targetRules.get(e.ruleKey);
      if (own) {
        const d = own.decls[e.declIndex];
        if (!d) continue;
        if (e.disabled) {
          const end = d.hasSemicolon ? d.end + 1 : d.end;
          ops.push({ start: d.start, end, text: `/* ${d.prop}: ${e.value ?? d.value}; */` });
        } else if (e.value != null) {
          ops.push({ start: d.valueStart, end: d.valueEnd, text: e.value });
        }
      } else if (!e.disabled && e.value != null) {
        group(e.ruleKey).decls.push({ prop: e.prop, value: e.value, ref: { kind: 'decl', id: e.id } });
      }
    }

    // 2. Properties added to existing rules.
    for (const a of edits.added) {
      const own = targetRules.get(a.ruleKey);
      if (own) {
        const last = own.decls[own.decls.length - 1];
        if (last && !last.hasSemicolon) ops.push({ start: last.valueEnd, end: last.valueEnd, text: ';' });
        if (aloneOnLine(original, own.close)) {
          const indent = last ? indentOf(original, last.start) : '    ';
          const at = lineStart(original, own.close);
          ops.push({ start: at, end: at, text: `${indent}${a.prop}: ${a.value};\n` });
        } else {
          ops.push({ start: own.close, end: own.close, text: ` ${a.prop}: ${a.value}; ` });
        }
      } else {
        group(a.ruleKey).decls.push({ prop: a.prop, value: a.value, ref: { kind: 'added', id: a.id } });
      }
    }

    // 3. Variables: in place when the target defines them, otherwise added to its block.
    const block = E.varsBlock(original);
    const varLines = [];
    const newVarText = [];
    for (const v of edits.vars) {
      varLines.push(`    --${v.name}: ${v.value};`);
      const own = ctx.targetVars.get(v.name);
      if (own && own.valueStart != null) ops.push({ start: own.valueStart, end: own.valueEnd, text: v.value });
      else newVarText.push(`    --${v.name}: ${v.value};`);
    }
    if (newVarText.length) {
      if (block) {
        if (aloneOnLine(original, block.end)) {
          const at = lineStart(original, block.end);
          ops.push({ start: at, end: at, text: newVarText.join('\n') + '\n' });
        } else {
          ops.push({ start: block.end, end: block.end, text: '\n' + newVarText.join('\n') + '\n' });
        }
      } else {
        const at = E.metaBlockEnd(original);
        ops.push({ start: at, end: at, text: '\n\n@OBSThemeVars {\n' + newVarText.join('\n') + '\n}\n' });
      }
    }

    let text = original;
    for (const op of ops.sort((a, b) => b.start - a.start || b.end - a.end)) {
      text = text.slice(0, op.start) + op.text + text.slice(op.end);
    }

    // 4. Overrides of parent rules and new rules, appended at the end.
    const appended = [];
    const tail = [];
    const push = (lines, ref) => {
      tail.push('');
      const first = tail.length;
      tail.push(...lines);
      appended.push({ offset: first, lines: lines.length, ref });
    };
    for (const [key, g] of overrideGroups) {
      if (!g.info || !g.decls.length) continue;
      push(ruleBlock(`Overrides ${g.info.file}:${g.info.line}`, g.info.ruleText, g.decls),
           { kind: 'override', ruleKey: key, decls: g.decls.map(d => d.ref) });
    }
    for (const r of edits.rules) {
      push(ruleBlock('New rule', r.selector, r.decls), { kind: 'rule', id: r.id });
    }
    if (tail.length) {
      if (!text.endsWith('\n')) text += '\n';
      const before = text.split('\n').length - 1;
      text += '\n' + APPEND_HEADER + '\n' + tail.slice(1).join('\n') + '\n';
      // Line numbers (1-based) of each appended rule in the final text.
      for (const a of appended) a.line = before + 2 + a.offset;
    }

    return { text, appended, appendBlock: appendBlock(edits, ctx, targetRules), varLines };
  }

  /** The changes expressed only as rules to add at the end of the file. */
  function appendBlock(edits, ctx, targetRules) {
    const groups = new Map();
    const notes = [];
    const add = (key, decl) => {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(decl);
    };
    for (const e of edits.decls) {
      const own = targetRules.get(e.ruleKey);
      if (e.disabled) {
        const info = ctx.ruleInfo(e.ruleKey);
        const d = own && own.decls[e.declIndex];
        notes.push(`/* Cannot be expressed as an addition: remove "${e.prop}: ${d ? d.value : ''};"` +
                   ` from the rule at ${info ? info.file + ':' + info.line : 'unknown'}. */`);
      } else if (e.value != null) add(e.ruleKey, { prop: e.prop, value: e.value });
    }
    for (const a of edits.added) add(a.ruleKey, { prop: a.prop, value: a.value });
    const lines = [APPEND_HEADER];
    for (const [key, decls] of groups) {
      const info = ctx.ruleInfo(key);
      if (!info) continue;
      lines.push('', ...ruleBlock(`Overrides ${info.file}:${info.line}`, info.ruleText, decls));
    }
    for (const r of edits.rules) lines.push('', ...ruleBlock('New rule', r.selector, r.decls));
    if (notes.length) lines.push('', ...notes);
    return lines.length > 1 ? lines.join('\n') + '\n' : '';
  }

  /* ------------------------------------------------------------------ */
  /* Line diff                                                           */

  /** Returns [{ type: 'eq' | 'del' | 'add', a, b, text }] with 1-based line numbers. */
  function diffLines(aText, bText) {
    const a = aText.split('\n'), b = bText.split('\n');
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let suf = 0;
    while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
    const am = a.slice(pre, a.length - suf), bm = b.slice(pre, b.length - suf);
    const out = [];
    for (let i = 0; i < pre; i++) out.push({ type: 'eq', a: i + 1, b: i + 1, text: a[i] });

    const n = am.length, m = bm.length;
    if (n * m > 4e6) {
      am.forEach((t, i) => out.push({ type: 'del', a: pre + i + 1, b: null, text: t }));
      bm.forEach((t, j) => out.push({ type: 'add', a: null, b: pre + j + 1, text: t }));
    } else {
      // Longest common subsequence, filled from the end.
      const w = m + 1;
      const L = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          L[i * w + j] = am[i] === bm[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n || j < m) {
        if (i < n && j < m && am[i] === bm[j]) { out.push({ type: 'eq', a: pre + i + 1, b: pre + j + 1, text: am[i] }); i++; j++; }
        else if (j < m && (i === n || L[i * w + j + 1] > L[(i + 1) * w + j])) { out.push({ type: 'add', a: null, b: pre + j + 1, text: bm[j] }); j++; }
        else { out.push({ type: 'del', a: pre + i + 1, b: null, text: am[i] }); i++; }
      }
    }
    for (let k = 0; k < suf; k++) {
      const ai = a.length - suf + k, bi = b.length - suf + k;
      out.push({ type: 'eq', a: ai + 1, b: bi + 1, text: a[ai] });
    }
    return renumber(slide(out));
  }

  /**
   * Moves each block of added (or removed) lines down while the line after
   * it repeats its first line, like classic diff tools do. Both results are
   * correct; this one reads naturally ("}" stays where it was, the new rule
   * comes after it).
   */
  function slide(ops) {
    for (let start = 0; start < ops.length; start++) {
      const type = ops[start].type;
      if (type === 'eq') continue;
      let end = start;
      while (end + 1 < ops.length && ops[end + 1].type === type) end++;
      // [A, B, C] followed by an unchanged A becomes A, [B, C, A].
      while (end + 1 < ops.length && ops[end + 1].type === 'eq' && ops[end + 1].text === ops[start].text) {
        ops.splice(start, end - start + 2, ops[end + 1], ...ops.slice(start + 1, end + 1), ops[start]);
        start++;
        end++;
      }
      start = end;
    }
    return ops;
  }

  function renumber(ops) {
    let a = 0, b = 0;
    for (const op of ops) {
      if (op.type !== 'add') op.a = ++a; else op.a = null;
      if (op.type !== 'del') op.b = ++b; else op.b = null;
    }
    return ops;
  }

  /**
   * Maps each line of the edited text to the original line it comes from.
   * Changed lines are paired with the lines they replace.
   */
  function lineMap(diff) {
    const map = new Map();
    let dels = [], adds = [];
    const flush = () => {
      adds.forEach((b, k) => { if (k < dels.length) map.set(b, dels[k]); });
      dels = []; adds = [];
    };
    for (const d of diff) {
      if (d.type === 'eq') { flush(); map.set(d.b, d.a); }
      else if (d.type === 'del') dels.push(d.a);
      else adds.push(d.b);
    }
    flush();
    return map;
  }

  window.OTI = window.OTI || {};
  window.OTI.editor = {
    ruleKey, emptyEdits, defaultTarget, newVariantText, targetPath, generate, diffLines, lineMap, APPEND_HEADER,
  };
})();
