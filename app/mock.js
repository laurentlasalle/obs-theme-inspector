/*
 * OBS Theme Inspector — HTML mock-up of the OBS Studio main window.
 *
 * Every Qt widget is an element built with w(); sub-controls drawn by Qt
 * itself (list items, dock titles, toolbar separators …) are built with sc().
 * The structure follows frontend/forms/OBSBasic.ui of OBS Studio 32.2.1, so
 * object names, classes and parent/child relations match the real window.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
(function () {
  'use strict';

  /* Qt class hierarchy, child -> parent. */
  const QT_PARENT = {
    QWidget: null,
    QFrame: 'QWidget',
    QLabel: 'QFrame',
    QAbstractScrollArea: 'QFrame',
    QAbstractItemView: 'QAbstractScrollArea',
    QListView: 'QAbstractItemView',
    QListWidget: 'QListView',
    SceneTree: 'QListWidget',
    QMainWindow: 'QWidget',
    OBSMainWindow: 'QMainWindow',
    OBSBasic: 'OBSMainWindow',
    QDockWidget: 'QWidget',
    OBSDock: 'QDockWidget',
    QToolBar: 'QWidget',
    QAbstractButton: 'QWidget',
    QToolButton: 'QAbstractButton',
    QPushButton: 'QAbstractButton',
    QMenuBar: 'QWidget',
    QStatusBar: 'QWidget',
    QAbstractSlider: 'QWidget',
    QScrollBar: 'QAbstractSlider',
  };

  function lineage(type) {
    const out = [];
    for (let t = type; t; t = QT_PARENT[t]) out.push(t);
    if (!(type in QT_PARENT)) out.push('QWidget');
    return out.join(' ');
  }

  /**
   * Creates a Qt widget element.
   * opts: { name, cls, props: {}, states: [], text, layout: 'v'|'h', icon, iconSize, focusable, style }
   */
  function w(type, opts = {}, children = []) {
    const el = document.createElement('div');
    el.dataset.t = lineage(type);
    el.dataset.type = type;
    // Qt class selectors (.x) read the "class" property, or the class name.
    el.dataset.qc = opts.cls || type;
    if (opts.cls) el.dataset.clsProp = opts.cls;
    if (opts.name) el.dataset.name = opts.name;
    el.dataset.s = (opts.states || []).join(' ');
    for (const [k, v] of Object.entries(opts.props || {})) el.setAttribute('data-p-' + k.toLowerCase(), String(v));
    if (opts.layout) el.dataset.layout = opts.layout;
    if (opts.focusable) el.tabIndex = -1;
    if (opts.icon) {
      el.dataset.iconDefault = opts.icon;
      el.dataset.iconSize = opts.iconSize || 16;
      const icon = document.createElement('span');
      icon.className = 'q-icon';
      el.appendChild(icon);
    }
    if (opts.text) {
      const span = document.createElement('span');
      span.className = 'q-text';
      span.textContent = opts.text;
      el.appendChild(span);
    }
    if (opts.style) el.setAttribute('style', opts.style);
    for (const c of children) if (c) el.appendChild(c);
    return el;
  }

  /** Creates a sub-control (drawn by Qt, not a widget of its own). */
  function sc(name, opts = {}, children = []) {
    const el = document.createElement('div');
    el.dataset.sc = name;
    el.dataset.s = (opts.states || []).join(' ');
    if (opts.text) {
      const span = document.createElement('span');
      span.className = 'q-text';
      span.textContent = opts.text;
      el.appendChild(span);
    }
    if (opts.iconFrom) {
      el.dataset.iconFrom = opts.iconFrom;
      el.dataset.iconSize = opts.iconSize || 16;
      const icon = document.createElement('span');
      icon.className = 'q-icon';
      el.appendChild(icon);
    }
    if (opts.image) {
      const img = document.createElement('span');
      img.className = 'q-image';
      el.appendChild(img);
    }
    for (const c of children) if (c) el.appendChild(c);
    return el;
  }

  /** The viewport child every QAbstractScrollArea has. */
  function viewport(children) {
    const el = w('QWidget', { name: 'qt_scrollarea_viewport' }, children);
    el.dataset.viewport = '';
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Docks                                                               */

  function dock(name, title, content) {
    return w('OBSDock', { name, states: ['closable', 'movable', 'floatable'] }, [
      sc('title', { text: title }),
      sc('float-button', { iconFrom: 'titlebar-normal-icon', iconSize: 16 }),
      sc('close-button', { iconFrom: 'titlebar-close-icon', iconSize: 16 }),
      content,
    ]);
  }

  function toolButton(action) {
    // OBS copies the QAction's dynamic properties ("class") onto the button.
    return w('QToolButton', { name: '', cls: action.cls, icon: action.icon, iconSize: 16, focusable: true,
                              props: { toolTip: action.tip } });
  }

  function sceneTree(scenes, selected) {
    const items = scenes.map((name, i) => sc('item', { text: name, states: i === selected ? ['selected'] : [] }));
    return w('SceneTree', { name: 'scenes', focusable: true, props: { frameShape: 0, gridMode: false } },
             [viewport(items)]);
  }

  function scenesDock() {
    const scenes = ['Bureau', 'Écran', 'Game (Source)', 'Camera (Source)', 'Camera (Mask)', 'Pause (Source)',
                    'Vertical Gameplay', 'Vertical Alerts', 'Vertical Camera'];
    const toolbar = w('QToolBar', { name: 'scenesToolbar', layout: 'h' }, [
      toolButton({ cls: 'icon-plus', icon: ':/res/images/plus.svg', tip: 'Add' }),
      toolButton({ cls: 'icon-trash', icon: ':/res/images/minus.svg', tip: 'Remove' }),
      sc('separator'),
      toolButton({ cls: 'icon-filter', icon: ':/res/images/filter.svg', tip: 'Filters' }),
      sc('separator'),
      toolButton({ cls: 'icon-up', icon: ':/res/images/up.svg', tip: 'Move Up' }),
      toolButton({ cls: 'icon-down', icon: ':/res/images/down.svg', tip: 'Move Down' }),
    ]);
    const frame = w('QFrame', { name: 'scenesFrame', layout: 'v', props: { frameShape: 0 } },
                    [sceneTree(scenes, 2), toolbar]);
    const contents = w('QWidget', { name: 'dockWidgetContents_2', layout: 'v' }, [frame]);
    return dock('scenesDock', 'Scenes', contents);
  }

  /* ------------------------------------------------------------------ */
  /* Main window                                                         */

  function build() {
    const scenes = scenesDock();
    scenes.classList.add('mock-dock');
    scenes.style.width = '300px';
    scenes.style.height = '340px';
    const win = w('OBSBasic', { name: 'OBSBasic', layout: 'h' }, [scenes]);
    win.classList.add('mock-window');
    return win;
  }

  /* ------------------------------------------------------------------ */
  /* Interaction: selection in lists, checkable buttons                  */

  function addState(el, s) {
    const set = new Set((el.dataset.s || '').split(' ').filter(Boolean));
    set.add(s);
    el.dataset.s = [...set].join(' ');
  }

  function removeState(el, s) {
    el.dataset.s = (el.dataset.s || '').split(' ').filter(x => x && x !== s).join(' ');
  }

  function hasState(el, s) {
    return (el.dataset.s || '').split(' ').includes(s);
  }

  function wire(root, onChange) {
    root.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) return; // reserved for the inspector
      const item = e.target.closest('[data-sc="item"]');
      if (item && root.contains(item)) {
        for (const other of item.parentElement.querySelectorAll(':scope > [data-sc="item"]')) {
          removeState(other, 'selected');
          removeState(other, 'focus');
        }
        addState(item, 'selected');
        addState(item, 'focus');
        onChange();
        return;
      }
      const button = e.target.closest('[data-s~="checkable"]');
      if (button && root.contains(button)) {
        if (hasState(button, 'checked')) { removeState(button, 'checked'); addState(button, 'unchecked'); }
        else { addState(button, 'checked'); removeState(button, 'unchecked'); }
        onChange();
      }
    });
  }

  window.OTI = window.OTI || {};
  window.OTI.mock = { build, wire, lineage, addState, removeState, hasState };
})();
