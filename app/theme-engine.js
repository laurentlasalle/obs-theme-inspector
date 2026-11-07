/*
 * OBS Theme Inspector — theme engine.
 *
 * Reproduces how OBS Studio (frontend/OBSApp_Themes.cpp, version 32.2.1)
 * reads .obt / .ovt / .oha files, builds the inheritance chain, resolves
 * @OBSThemeVars (aliases, calc(), max(), min()) and substitutes var(--x)
 * in the style sheet. Quirks of the original are kept on purpose, so the
 * preview behaves like OBS, bugs included; each one is commented.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
(function () {
  'use strict';

  const VarType = {
    Color: 'Color', Size: 'Size', Number: 'Number', String: 'String',
    Alias: 'Alias', Calc: 'Calc', Max: 'Max', Min: 'Min',
  };
  const MATH = new Set([VarType.Calc, VarType.Max, VarType.Min]);

  /* ------------------------------------------------------------------ */
  /* Comments and a minimal tokenizer (close to libobs' cf-lexer)        */

  /** Replaces comments by spaces, keeping newlines so line numbers survive. */
  function stripComments(text) {
    return text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
  }

  /**
   * Tokenizes a value the way cf-lexer roughly does: quoted strings,
   * numbers with their suffix glued ("12px", "0.5"), names, and single
   * punctuation characters.
   */
  function tokenize(text) {
    const tokens = [];
    // A token starting with a digit runs on through letters and dots
    // ("12px", "0.5", "2f2f2f" after a "#").
    const re = /\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\d[\w.%]*|\.\d[\w.%]*|[A-Za-z_]\w*|\S)/gy;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[1] === undefined) break;
      tokens.push(m[1]);
    }
    return tokens;
  }

  function unquote(tok) {
    if (/^(["']).*\1$/s.test(tok)) return tok.slice(1, -1).replace(/\\(.)/g, '$1');
    return tok;
  }

  /** Position of the first @OBSThemeVars block: start (after "{") and end (the "}"), or null. */
  function varsBlock(text) {
    const b = findBlock(stripComments(text), 'OBSThemeVars');
    return b ? { start: b.start, end: b.end } : null;
  }

  /** Position right after the @OBSThemeMeta block, or 0. */
  function metaBlockEnd(text) {
    const b = findBlock(stripComments(text), 'OBSThemeMeta');
    return b ? b.end + 1 : 0;
  }

  /** Content of the first `@Name { ... }` block, or null. */
  function findBlock(text, name) {
    const re = new RegExp('@' + name + '\\s*\\{', 'g');
    const m = re.exec(text);
    if (!m) return null;
    const start = m.index + m[0].length;
    const end = text.indexOf('}', start);
    if (end < 0) return null;
    return { body: text.slice(start, end), start, end };
  }

  /* ------------------------------------------------------------------ */
  /* @OBSThemeMeta                                                       */

  function parseMeta(text, filename) {
    const clean = stripComments(text);
    const block = findBlock(clean, 'OBSThemeMeta');
    const meta = { name: '', id: '', extends: '', author: '', dark: false };
    if (block) {
      for (const decl of block.body.split(';')) {
        const m = /^\s*([A-Za-z_]\w*)\s*:\s*(.*?)\s*$/s.exec(decl);
        if (!m) continue;
        // OBS only accepts quoted string values here (CFTOKEN_STRING).
        if (!/^(["']).*\1$/s.test(m[2])) continue;
        const value = unquote(m[2]);
        if (m[1] === 'dark') meta.dark = value === 'true';
        else if (m[1] in meta) meta[m[1]] = value;
      }
    }
    const ext = (filename.match(/\.(obt|ovt|oha)$/i) || [, ''])[1].toLowerCase();
    meta.isBaseTheme = ext === 'obt';
    meta.isHighContrast = ext === 'oha';
    meta.isVisible = !filename.includes('System');
    meta.valid = !!(meta.id && meta.name && (meta.isBaseTheme || meta.extends));
    return meta;
  }

  /* ------------------------------------------------------------------ */
  /* @OBSThemeVars                                                       */

  let anonCounter = 0;

  /** Parses the operands of calc()/max()/min(), starting after the name. */
  function parseMath(tokens, i, vars) {
    if (tokens[i] !== '(') return null;
    i++;
    const values = [];
    while (i < tokens.length && tokens[i] !== ')') {
      const t = tokens[i];
      if (t === ';') break;
      if (t === 'calc' || t === 'max' || t === 'min') {
        const sub = parseMath(tokens, i + 1, vars);
        if (!sub) return null;
        // Internal math operations become anonymous variables, like in OBS.
        const name = '__unnamed_' + (++anonCounter);
        vars.push({ name, type: t === 'calc' ? VarType.Calc : t === 'max' ? VarType.Max : VarType.Min,
                    value: sub.values, suffix: '' });
        values.push(name);
        i = sub.next;
        continue;
      }
      if (t === 'var') {
        const v = parseVarName(tokens, i + 1);
        if (!v) return null;
        values.push(v.name);
        i = v.next;
        continue;
      }
      values.push(t);
      i++;
    }
    if (tokens[i] !== ')') return null;
    return values.length ? { values, next: i + 1 } : null;
  }

  /** Parses `( - - name )` after `var`. */
  function parseVarName(tokens, i) {
    if (tokens[i] !== '(' || tokens[i + 1] !== '-' || tokens[i + 2] !== '-') return null;
    const name = tokens[i + 3];
    if (!name || tokens[i + 4] !== ')') return null;
    return { name, next: i + 5 };
  }

  /** strtol(…, 16) semantics: reads leading hex digits only. */
  function strtolHex(s) {
    const m = /^[0-9a-fA-F]+/.exec(s || '');
    return m ? parseInt(m[0], 16) : 0;
  }

  function parseColor(tokens, i) {
    let color = 0;
    if (tokens[i] === '#') {
      // OBS reads the next token with strtol(hex). "#fff" therefore gives
      // 0x000fff, not white: a quirk kept on purpose.
      color = strtolHex(tokens[i + 1]);
      return { color, next: i + 2 };
    }
    if (tokens[i] === 'rgb') {
      const t = tokens;
      if (t[i + 1] !== '(' || t[i + 3] !== ',' || t[i + 5] !== ',' || t[i + 7] !== ')') return null;
      color = ((parseInt(t[i + 2], 10) & 255) << 16) | ((parseInt(t[i + 4], 10) & 255) << 8) |
              (parseInt(t[i + 6], 10) & 255);
      return { color, next: i + 8 };
    }
    if (tokens[i] === 'bikeshed') {
      color = (Math.floor(Math.random() * 127) << 16) | (Math.floor(Math.random() * 127) << 8) |
              Math.floor(Math.random() * 127);
      return { color, next: i + 1 };
    }
    return null;
  }

  function splitNumber(tok) {
    const m = /^(\d*\.?\d+)(.*)$/.exec(tok);
    if (!m) return null;
    return { value: parseFloat(m[1]), suffix: m[2] };
  }

  /**
   * Parses the variables of one theme file, in order.
   * `os` is "win", "mac" or "lin": variables named --os_<os>_x replace --x.
   */
  function parseVars(text, os, warnings, file) {
    const vars = [];
    const clean = stripComments(text);
    const block = findBlock(clean, 'OBSThemeVars');
    if (!block) return vars;
    const osPrefix = 'os_' + os + '_';
    const lineOf = idx => clean.slice(0, idx).split('\n').length;

    let pos = block.start;
    for (const raw of block.body.split(';')) {
      const declStart = pos;
      pos += raw.length + 1;
      const m = /^\s*--([A-Za-z0-9_-]+)\s*:\s*([\s\S]*?)\s*$/.exec(raw);
      if (!m) continue;
      const key = m[1];
      // Values set by OBS itself start with "obs" and cannot be overridden.
      if (key.startsWith('obs')) continue;
      let name = key;
      if (key.startsWith(osPrefix) && key.length > osPrefix.length) name = key.slice(osPrefix.length);

      const tokens = tokenize(m[2]);
      const line = lineOf(declStart + raw.search(/\S/));
      // Positions in the original text, used to write edited values back.
      const colon = raw.indexOf(':');
      const afterColon = raw.slice(colon + 1);
      const valueStart = declStart + colon + 1 + (afterColon.length - afterColon.trimStart().length);
      const valueEnd = declStart + raw.trimEnd().length;
      const v = { name, key, file, line, suffix: '', editable: false, text: m[2],
                  declStart: declStart + raw.search(/\S/), valueStart, valueEnd };
      const t0 = tokens[0];
      let next = 1;
      if (t0 === undefined) continue;

      const num = /^\d/.test(t0) || /^\.\d/.test(t0) ? splitNumber(t0) : null;
      if (num) {
        v.type = num.suffix ? VarType.Size : VarType.Number;
        v.value = num.value;
        v.suffix = num.suffix;
      } else if (t0 === 'rgb' || t0 === '#' || t0 === 'bikeshed') {
        const c = parseColor(tokens, 0);
        if (!c) { warnings.push({ file, line, msg: `Invalid color for --${key}` }); continue; }
        v.type = VarType.Color;
        v.value = c.color;
        next = c.next;
      } else if (t0 === 'var') {
        const r = parseVarName(tokens, 1);
        if (!r) continue;
        v.type = VarType.Alias;
        v.value = r.name;
        next = r.next;
      } else if (t0 === 'calc' || t0 === 'max' || t0 === 'min') {
        v.type = t0 === 'calc' ? VarType.Calc : t0 === 'max' ? VarType.Max : VarType.Min;
        const r = parseMath(tokens, 1, vars);
        if (!r) { warnings.push({ file, line, msg: `Invalid expression for --${key}` }); continue; }
        v.value = r.values;
        next = r.next;
      } else {
        // OBS keeps only the first token of anything else.
        v.type = VarType.String;
        v.value = unquote(t0);
        if (tokens.length > 1 && tokens[1] !== '!') {
          warnings.push({ file, line,
            msg: `--${key}: OBS only keeps the first token of "${m[2].trim()}", which is "${v.value}"` });
        }
      }
      if (tokens[next] === '!' && tokens[next + 1] === 'editable' && !MATH.has(v.type) && v.type !== VarType.Alias) {
        v.editable = true;
      }
      vars.push(v);
    }
    return vars;
  }

  /* ------------------------------------------------------------------ */
  /* Resolution (ResolveVariable / ParseMathVariable / EvalMath)         */

  class InvalidOperand extends Error {}

  function resolveAlias(vars, v, warnings) {
    if (v.type !== VarType.Alias) return v;
    let key = v.value;
    const seen = new Set();
    while (vars.has(key) && vars.get(key).type === VarType.Alias) {
      if (seen.has(key)) return null;
      seen.add(key);
      key = vars.get(key).value;
    }
    if (!vars.has(key)) {
      warnings && warnings.push({ file: v.file, line: v.line,
        msg: `Variable --${key} (aliased by --${v.name}) does not exist` });
      return null;
    }
    return vars.get(key);
  }

  function formatNumber(val) {
    // QString::number(val, 'f', isInteger ? 0 : -1)
    if (Math.ceil(val) === val) return val.toFixed(0);
    return String(val);
  }

  function parseMathVariable(vars, value, recursion) {
    if (/^\d/.test(value)) {
      const n = splitNumber(value) || { value: parseFloat(value), suffix: '' };
      return { type: n.suffix ? VarType.Size : VarType.Number, value: n.value, suffix: n.suffix };
    }
    let v = resolveAlias(vars, { type: VarType.Alias, value, name: value }, null);
    if (!v) throw new InvalidOperand(value);
    if (MATH.has(v.type)) {
      const r = evalMath(vars, v, recursion + 1);
      if (r.error) throw new InvalidOperand(value);
      v = parseMathVariable(vars, r.text, recursion + 1);
    }
    if (v.type !== VarType.Number && v.type !== VarType.Size) throw new InvalidOperand(value);
    return v;
  }

  /** Returns { text } or { error, text: "'Invalid expression'" }. */
  function evalMath(vars, v, recursion = 0) {
    const bad = error => ({ error, text: "'Invalid expression'" });
    if (recursion >= 10) return bad('Maximum recursion level reached');
    const args = v.value;
    const op = args[1];
    if (v.type === VarType.Calc && !['*', '+', '-', '/'].includes(op)) return bad(`Unknown calc() operator: ${op}`);
    if (v.type !== VarType.Calc && op !== ',') return bad(`Invalid separator: ${op}`);
    if (args.length !== 3) return bad(`Invalid number of arguments: ${args.join(' ')}`);
    let a, b;
    try {
      a = parseMathVariable(vars, args[0], 0);
      b = parseMathVariable(vars, args[2], 0);
    } catch (e) {
      return bad(`Operand is not a number or size: ${e.message}`);
    }
    if (a.suffix && b.suffix && a.suffix !== b.suffix) return bad(`Units do not match: ${a.suffix} and ${b.suffix}`);
    const d1 = a.value, d2 = b.value;
    if (!isFinite(d1) || !isFinite(d2)) return bad('Non-finite value');
    let val = NaN;
    if (v.type === VarType.Calc) {
      val = op === '+' ? d1 + d2 : op === '-' ? d1 - d2 : op === '*' ? d1 * d2 : d1 / d2;
      // std::isnormal: zero is rejected too, as in OBS.
      if (!isFinite(val) || val === 0 || Math.abs(val) < 2.2250738585072014e-308) {
        return bad(`Non-normal result: ${d1} ${op} ${d2} = ${val}`);
      }
    } else if (v.type === VarType.Max) {
      val = d1 > d2 ? d1 : d2;
    } else {
      val = d1 < d2 ? d1 : d2;
    }
    return { text: formatNumber(val) + (a.suffix || b.suffix || '') };
  }

  function colorHex(c) {
    return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
  }

  /** std::roundf: halves away from zero. */
  function roundHalfAway(x) {
    return Math.sign(x) * Math.round(Math.abs(x));
  }

  /**
   * Computes the replacement text of every variable, like PrepareQSS().
   * Returns Map(name -> { text, source, error }).
   */
  function computeReplacements(vars, warnings) {
    const out = new Map();
    for (const [name, v0] of vars) {
      if (name.startsWith('__unnamed_')) continue;
      const v = resolveAlias(vars, v0, warnings);
      if (!v) { out.set(name, { text: null, error: 'Alias target not found', source: v0 }); continue; }
      let text, error;
      if (v.type === VarType.Color) {
        text = colorHex(v.value);
      } else if (MATH.has(v.type)) {
        const r = evalMath(vars, v);
        text = r.text;
        error = r.error;
        if (error) warnings.push({ file: v0.file, line: v0.line, msg: `--${name} : ${error}` });
      } else if (v.type === VarType.Size || v.type === VarType.Number) {
        text = formatNumber(v.value) + (v.suffix || '');
      } else {
        text = String(v.value);
      }
      // Values ending in "px" are rounded to whole pixels.
      if (text.endsWith('px')) {
        const n = parseFloat(text.slice(0, -2));
        if (isFinite(n)) text = roundHalfAway(n) + 'px';
      }
      out.set(name, { text, error, source: v0 });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Theme set: discovery and dependency chains (FindThemes)             */

  /**
   * files: array of { path, text, origin: 'core' | 'user' }.
   * Core files are registered first; on duplicate ids the first wins.
   */
  function buildThemeSet(files) {
    const themes = new Map();
    const problems = [];
    const ordered = [...files.filter(f => f.origin === 'core'), ...files.filter(f => f.origin !== 'core')];
    for (const f of ordered) {
      if (!/\.(obt|ovt|oha)$/i.test(f.path)) continue;
      const filename = f.path.split('/').pop();
      const meta = parseMeta(f.text, filename);
      if (!meta.valid) {
        problems.push({ file: f.path, msg: 'Invalid or incomplete @OBSThemeMeta' });
        continue;
      }
      if (themes.has(meta.id)) {
        const kept = themes.get(meta.id);
        problems.push({ file: f.path,
          msg: `Theme id "${meta.id}" is already used by ${kept.file.path}; this file is ignored, as OBS does` });
        continue;
      }
      themes.set(meta.id, Object.assign(meta, { file: f, dependencies: [], parent: '' }));
    }

    const invalid = new Set();
    for (const theme of themes.values()) {
      if (!theme.extends) {
        if (!theme.isBaseTheme) { invalid.add(theme.id); problems.push({ file: theme.file.path, msg: 'Variant without a parent (extends)' }); }
        continue;
      }
      let parentId = theme.extends;
      while (parentId) {
        const parent = themes.get(parentId);
        if (!parent) {
          problems.push({ file: theme.file.path, msg: `Parent "${parentId}" not found` });
          invalid.add(theme.id);
          break;
        }
        if (theme.isBaseTheme && !parent.isBaseTheme) { invalid.add(theme.id); break; }
        if (parent.id === theme.id || theme.dependencies.includes(parent.id)) {
          problems.push({ file: theme.file.path, msg: 'Circular inheritance' });
          invalid.add(theme.id);
          break;
        }
        if (!theme.isBaseTheme && parent.isBaseTheme && !theme.parent) theme.parent = parent.id;
        theme.dependencies.unshift(parent.id);
        parentId = parent.extends;
        if (!parentId && !parent.isBaseTheme) { invalid.add(theme.id); break; }
      }
    }
    for (const id of invalid) themes.delete(id);
    return { themes, problems };
  }

  /* ------------------------------------------------------------------ */
  /* Compiling one theme (SetTheme + PrepareQSS)                         */

  /** FindEndOfOBSMetadata(): end of the last OBS-specific section. */
  function endOfObsMetadata(content) {
    let end = 0;
    for (const section of ['OBSThemeMeta', 'OBSThemeVars', 'OBSTheme']) {
      const idx = content.indexOf(section);
      if (idx > end) end = content.indexOf('}', idx) + 1;
    }
    return end;
  }

  /**
   * Compiles a theme. options: { fontScale, density (padding value), os, highContrast,
   *   textOverrides: Map(path -> text) to compile an edited copy of a file,
   *   extraSource: { path, text } appended last (a new variant being created) }.
   * Returns { chain, vars, replacements, sources: [{ theme, path, text, offset }], usesFontScale,
   *           usesDensity, warnings }.
   */
  function compileTheme(themeSet, id, options) {
    const theme = themeSet.themes.get(id);
    if (!theme) throw new Error('Theme not found: ' + id);
    const warnings = [];
    const ids = [...theme.dependencies, theme.id];
    if (options.highContrast) {
      for (const t of themeSet.themes.values()) {
        if (t.isHighContrast && t.parent === theme.id) { ids.push(t.id); break; }
      }
    }
    const vars = new Map();
    vars.set('obsFontScale', { name: 'obsFontScale', type: VarType.Number, value: options.fontScale, suffix: '', file: 'OBS', line: 0 });
    vars.set('obsPadding', { name: 'obsPadding', type: VarType.Number, value: options.density, suffix: '', file: 'OBS', line: 0 });

    const sources = [];
    const overrides = options.textOverrides || new Map();
    const addSource = (theme, path, text, origin) => {
      for (const v of parseVars(text, options.os, warnings, path)) vars.set(v.name, v);
      sources.push({ theme, path, text, origin, offset: endOfObsMetadata(text) });
    };
    for (const tid of ids) {
      const t = themeSet.themes.get(tid);
      const text = overrides.has(t.file.path) ? overrides.get(t.file.path) : t.file.text;
      addSource(t, t.file.path, text, t.file.origin);
    }
    if (options.extraSource) addSource(null, options.extraSource.path, options.extraSource.text, 'new');

    let usesFontScale = false, usesDensity = false;
    for (const v of vars.values()) {
      const refs = v.type === VarType.Alias ? [v.value] : MATH.has(v.type) ? v.value : [];
      if (refs.includes('obsFontScale')) usesFontScale = true;
      if (refs.includes('obsPadding')) usesDensity = true;
    }

    const replacements = computeReplacements(vars, warnings);
    return { theme, chain: ids.map(i => themeSet.themes.get(i)), vars, replacements, sources,
             usesFontScale, usesDensity, warnings };
  }

  /** Substitutes var(--name) like PrepareQSS (unknown names are left untouched). */
  function substitute(text, replacements, onMissing) {
    return text.replace(/var\(--([A-Za-z0-9_-]+)\)/g, (whole, name) => {
      const r = replacements.get(name);
      if (r && r.text != null) return r.text;
      onMissing && onMissing(name);
      return whole;
    });
  }

  /** Palette roles set through palette_<role>[_<group>] variables (PreparePalette). */
  function palette(compiled) {
    const pal = {};
    for (const [name, v0] of compiled.vars) {
      if (!name.startsWith('palette_')) continue;
      const parts = name.split('_');
      if (parts.length < 2 || parts.length > 3) continue;
      const v = resolveAlias(compiled.vars, v0, null);
      if (!v || v.type !== VarType.Color) continue;
      const role = parts[1].toLowerCase();
      const group = (parts[2] || 'all').toLowerCase();
      pal[group === 'all' ? role : role + '-' + group] = colorHex(v.value);
    }
    return pal;
  }

  window.OTI = window.OTI || {};
  window.OTI.engine = {
    VarType, stripComments, parseMeta, parseVars, buildThemeSet, compileTheme, substitute,
    palette, endOfObsMetadata, varsBlock, metaBlockEnd, densityValues: { Classic: 0.25, Compact: 2, Normal: 4, Comfortable: 6 },
  };
})();
