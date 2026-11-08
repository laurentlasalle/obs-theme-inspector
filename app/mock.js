/*
 * OBS Theme Inspector — HTML mock-up of the OBS Studio main window.
 *
 * Every Qt widget is an element built with w(); sub-controls drawn by Qt
 * itself (list items, dock titles, slider grooves …) are built with sc().
 * The structure follows OBS Studio 32.2.1 (frontend/forms/OBSBasic.ui and
 * the widgets OBS builds in code: AudioMixer, VolumeControl, SourceTreeItem,
 * OBSBasicControls, OBSBasicStatusBar …), so object names, classes and
 * parent/child relations match the real window in its default layout.
 *
 * Qt layouts are not widgets: they never appear in the tree. Where a layout
 * nests rows inside a widget, the widget itself is laid out with a CSS grid
 * (inline grid-area on its children), so selectors such as "A > B" still
 * match as they do in Qt.
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
    Line: 'QFrame',
    QAbstractScrollArea: 'QFrame',
    QScrollArea: 'QAbstractScrollArea',
    QAbstractItemView: 'QAbstractScrollArea',
    QListView: 'QAbstractItemView',
    QListWidget: 'QListView',
    SceneTree: 'QListWidget',
    SourceTree: 'QListView',
    SourceTreeItem: 'QFrame',
    OBSSourceLabel: 'QLabel',
    QStackedWidget: 'QFrame',
    QMainWindow: 'QWidget',
    OBSMainWindow: 'QMainWindow',
    OBSBasic: 'OBSMainWindow',
    QDockWidget: 'QWidget',
    OBSDock: 'QDockWidget',
    QToolBar: 'QWidget',
    QAbstractButton: 'QWidget',
    QToolButton: 'QAbstractButton',
    QPushButton: 'QAbstractButton',
    QCheckBox: 'QAbstractButton',
    VolumeName: 'QAbstractButton',
    QComboBox: 'QWidget',
    OBSPreviewScalingComboBox: 'QComboBox',
    QAbstractSpinBox: 'QWidget',
    QSpinBox: 'QAbstractSpinBox',
    QLineEdit: 'QWidget',
    QMenuBar: 'QWidget',
    QStatusBar: 'QWidget',
    OBSBasicStatusBar: 'QStatusBar',
    StatusBarWidget: 'QWidget',
    QAbstractSlider: 'QWidget',
    QScrollBar: 'QAbstractSlider',
    QSlider: 'QAbstractSlider',
    SliderIgnoreScroll: 'QSlider',
    AbsoluteSlider: 'SliderIgnoreScroll',
    VolumeSlider: 'AbsoluteSlider',
    AudioMixer: 'QFrame',
    VolumeControl: 'QFrame',
    VolumeMeter: 'QWidget',
    OBSQTDisplay: 'QWidget',
    OBSBasicPreview: 'OBSQTDisplay',
    OBSPreviewScalingLabel: 'QLabel',
    OBSBasicControls: 'QFrame',
  };

  function lineage(type) {
    const out = [];
    for (let t = type; t; t = QT_PARENT[t]) out.push(t);
    if (!(type in QT_PARENT)) out.push('QWidget');
    return out.join(' ');
  }

  /**
   * Creates a Qt widget element.
   * opts: { name, cls, props: {}, states: [], text, icon, iconSize, iconQp, iconDark, focusable,
   *         area (CSS grid-area inside its parent), layout: 'v'|'h'|'grid', style }
   */
  function w(type, opts = {}, children = []) {
    const el = document.createElement('div');
    el.dataset.t = lineage(type);
    el.dataset.type = type;
    // Qt class selectors (.x) read the "class" property, or the class name.
    setClasses(el, opts.cls || '');
    if (opts.name) el.dataset.name = opts.name;
    el.dataset.s = (opts.states || []).join(' ');
    for (const [k, v] of Object.entries(opts.props || {})) el.setAttribute('data-p-' + k.toLowerCase(), String(v));
    if (opts.layout) el.dataset.layout = opts.layout;
    if (opts.focusable) el.tabIndex = -1;
    if (opts.icon || opts.iconQp) {
      if (opts.icon) el.dataset.iconDefault = opts.icon;
      if (opts.iconQp) el.dataset.iconQp = opts.iconQp;       // icon read from a property of OBSBasic
      if (opts.iconDark) el.dataset.iconDark = opts.iconDark; // icon used when the theme is dark
      el.dataset.iconSize = opts.iconSize || 16;
      const icon = document.createElement('span');
      icon.className = 'q-icon';
      el.appendChild(icon);
    }
    if (opts.text != null) {
      const span = document.createElement('span');
      span.className = 'q-text';
      span.textContent = opts.text;
      el.appendChild(span);
    }
    if (opts.area) el.style.gridArea = opts.area;
    if (opts.style) el.setAttribute('style', (el.getAttribute('style') || '') + opts.style);
    for (const c of children) if (c) el.appendChild(c);
    return el;
  }

  /** Sets the "class" property of a widget (several classes, separated by spaces). */
  function setClasses(el, cls) {
    el.dataset.qc = cls || el.dataset.type;
    if (cls) el.dataset.clsProp = cls; else delete el.dataset.clsProp;
  }

  function toggleClass(el, cls, on) {
    const set = new Set((el.dataset.clsProp || '').split(' ').filter(Boolean));
    if (on) set.add(cls); else set.delete(cls);
    setClasses(el, [...set].join(' '));
  }

  /** Creates a sub-control (drawn by Qt, not a widget of its own). */
  function sc(name, opts = {}, children = []) {
    const el = document.createElement('div');
    el.dataset.sc = name;
    el.dataset.s = (opts.states || []).join(' ');
    if (opts.text != null) {
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
    if (opts.area) el.style.gridArea = opts.area;
    for (const c of children) if (c) el.appendChild(c);
    return el;
  }

  /** The viewport child every QAbstractScrollArea has. */
  function viewport(children) {
    const el = w('QWidget', { name: 'qt_scrollarea_viewport' }, children);
    el.dataset.viewport = '';
    return el;
  }

  /**
   * A scroll area: its viewport, and the container Qt keeps for the vertical
   * scroll bar (shown by script when the contents overflow).
   */
  function scrollArea(type, opts, contents) {
    const bar = scrollBar('vertical', {});
    const container = w('QWidget', { name: 'qt_scrollarea_vcontainer', layout: 'v' }, [bar]);
    container.hidden = true;
    return w(type, opts, [viewport(contents), container]);
  }

  /** An element of the mock-up that is not part of Qt (a painted surface). */
  function paint(cls) {
    const el = document.createElement('div');
    el.className = cls;
    return el;
  }

  /* ------------------------------------------------------------------ */
  /* Common widgets                                                      */

  function label(text, opts = {}) {
    return w('QLabel', Object.assign({ text }, opts));
  }

  function pushButton(opts = {}) {
    const states = opts.states ? [...opts.states] : [];
    if (opts.checkable) states.push('checkable', opts.checked ? 'checked' : 'unchecked');
    const children = [];
    if (opts.menu) children.push(sc('menu-indicator'));
    return w('QPushButton', Object.assign({}, opts, { states, focusable: true }), children);
  }

  function toolButton(action) {
    // OBS copies the QAction's dynamic properties ("class") onto the button.
    return w('QToolButton', { cls: action.cls, icon: action.icon, iconSize: 16, focusable: true,
                              props: { toolTip: action.tip } });
  }

  function checkBox(cls, checked, tip) {
    return w('QCheckBox', { cls, focusable: true, props: { toolTip: tip },
                            states: ['checkable', checked ? 'checked' : 'unchecked'] },
             [sc('indicator', { states: [checked ? 'checked' : 'unchecked'] })]);
  }

  /** A closed combo box (":off"); the arrow sits in the drop-down button. */
  function comboBox(opts, text) {
    return w(opts.type || 'QComboBox', Object.assign({ focusable: true, states: ['off'], text }, opts),
             [sc('drop-down', { states: ['off'] }, [sc('down-arrow', { states: ['off'] })])]);
  }

  function spinBox(opts, text) {
    return w('QSpinBox', Object.assign({ focusable: true }, opts), [
      w('QLineEdit', { name: 'qt_spinbox_lineedit', text }),
      sc('up-button', {}, [sc('up-arrow')]),
      sc('down-button', {}, [sc('down-arrow')]),
    ]);
  }

  /** A scroll bar; pos and page are fractions of the range (handle position and size). */
  function scrollBar(orientation, opts = {}) {
    const horizontal = orientation === 'horizontal';
    const bar = w('QScrollBar', Object.assign({ states: [orientation] }, opts), [
      sc('sub-line', { states: [orientation] }, [sc(horizontal ? 'left-arrow' : 'up-arrow', { states: [orientation] })]),
      sc('sub-page', { states: [orientation] }),
      sc('handle', { states: [orientation] }),
      sc('add-page', { states: [orientation] }),
      sc('add-line', { states: [orientation] }, [sc(horizontal ? 'right-arrow' : 'down-arrow', { states: [orientation] })]),
    ]);
    bar.style.setProperty('--pos', opts.pos != null ? opts.pos : 0);
    bar.style.setProperty('--page', opts.page != null ? opts.page : 0.3);
    return bar;
  }

  /** A horizontal slider; value is a fraction of the range. */
  function slider(type, value, opts = {}) {
    const s = w(type, Object.assign({ focusable: true, states: ['horizontal'] }, opts), [
      sc('groove', { states: ['horizontal'] }),
      sc('sub-page', { states: ['horizontal'] }),
      sc('add-page', { states: ['horizontal'] }),
      sc('handle', { states: ['horizontal'] }),
    ]);
    s.dataset.value = value;
    return s;
  }

  function line() {
    return w('Line', { props: { frameShape: 5, orientation: 2 } });
  }

  /* ------------------------------------------------------------------ */
  /* Docks                                                               */

  function dock(name, title, content) {
    const d = w('OBSDock', { name, states: ['closable', 'movable', 'floatable'] }, [
      sc('title', { text: title }),
      sc('float-button', { iconFrom: 'titlebar-normal-icon', iconSize: 16 }),
      sc('close-button', { iconFrom: 'titlebar-close-icon', iconSize: 16 }),
      content,
    ]);
    d.classList.add('mock-dock');
    return d;
  }

  function sceneTree(scenes, selected) {
    const items = scenes.map((name, i) => sc('item', { text: name, states: i === selected ? ['selected'] : [] }));
    return scrollArea('SceneTree', { name: 'scenes', focusable: true, props: { frameShape: 0, gridMode: false } }, items);
  }

  function scenesDock() {
    const scenes = ['Starting Soon', 'Just Chatting', 'Gameplay', 'Be Right Back', 'Ending'];
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

  // Source types and the OBSBasic property holding their icon.
  const SOURCE_ICONS = {
    game: ['gameCapIcon', 'gamepad.svg'],
    camera: ['cameraIcon', 'camera.svg'],
    browser: ['browserIcon', 'globe.svg'],
    text: ['textIcon', 'text.svg'],
    image: ['imageIcon', 'image.svg'],
    audioIn: ['audioInputIcon', 'microphone.svg'],
    media: ['mediaIcon', 'media.svg'],
  };

  function sourceItem(name, kind, visible, locked, selected) {
    const [qp, file] = SOURCE_ICONS[kind];
    const row = w('SourceTreeItem', { layout: 'h' }, [
      w('QLabel', { cls: 'source-icon', iconQp: qp, icon: ':/res/images/sources/' + file, iconSize: 16,
                    states: visible ? [] : ['disabled'] }),
      w('OBSSourceLabel', { text: name, states: visible ? [] : ['disabled'], style: 'flex: 1;' }),
      checkBox('checkbox-icon indicator-visibility', visible, 'Visibility'),
      checkBox('checkbox-icon indicator-lock', locked, 'Lock'),
    ]);
    return sc('item', { states: selected ? ['selected'] : [] }, [row]);
  }

  function sourcesDock() {
    const items = [
      sourceItem('Alerts', 'browser', true, true, false),
      sourceItem('Webcam', 'camera', true, false, false),
      sourceItem('Game Capture', 'game', true, false, true),
      sourceItem('Now Playing', 'text', true, false, false),
      sourceItem('Background', 'image', false, true, false),
    ];
    const tree = scrollArea('SourceTree', { name: 'sources', focusable: true, props: { frameShape: 0 } }, items);
    const toolbar = w('QToolBar', { name: 'sourcesToolbar', layout: 'h' }, [
      toolButton({ cls: 'icon-plus', icon: ':/res/images/plus.svg', tip: 'Add' }),
      toolButton({ cls: 'icon-trash', icon: ':/res/images/minus.svg', tip: 'Remove' }),
      sc('separator'),
      toolButton({ cls: 'icon-gear', icon: ':/settings/images/settings/general.svg', tip: 'Properties' }),
      sc('separator'),
      toolButton({ cls: 'icon-up', icon: ':/res/images/up.svg', tip: 'Move Up' }),
      toolButton({ cls: 'icon-down', icon: ':/res/images/down.svg', tip: 'Move Down' }),
    ]);
    const frame = w('QFrame', { name: 'sourcesFrame', layout: 'v', props: { frameShape: 0 } }, [tree, toolbar]);
    const contents = w('QWidget', { name: 'dockWidgetContents_6', layout: 'v' }, [frame]);
    return dock('sourcesDock', 'Sources', contents);
  }

  /* Audio mixer ------------------------------------------------------- */

  const MONITOR_NONE = 0, MONITOR_ONLY = 1, MONITOR_AND_OUTPUT = 2;

  /**
   * One VolumeControl, horizontal layout (VolumeControl::setLayoutVertical(false)).
   * a: { name, category: 'Global'|'Active'|'Inactive', muted, monitoring, volume (0-1), db, level (dB) }
   */
  function volumeControl(a) {
    const name = w('VolumeName', { cls: 'text-small mixer-name', focusable: true, area: '1 / 1 / 2 / 3' }, [
      w('QLabel', { text: a.name }),
      sc('down-arrow'),
    ]);
    const category = w('QLabel', { cls: 'mixer-category text-tiny', text: a.category, area: '1 / 3 / 2 / 4' });
    const volLabel = w('QLabel', { name: 'volLabel', text: a.db, area: '1 / 4 / 2 / 5' });
    const mute = pushButton({ cls: 'btn-mute', checkable: true, icon: ':/settings/images/settings/audio.svg', iconSize: 16,
                              area: '2 / 1 / 3 / 2' });
    const monitor = pushButton({ cls: 'btn-monitor', checkable: true, icon: ':/res/images/headphones-off.svg', iconSize: 16,
                                 area: '3 / 1 / 4 / 2' });
    const meter = w('VolumeMeter', {}, [paint('mock-meter')]);
    meter.dataset.level = a.level;
    const meterFrame = w('QFrame', { name: 'volMeterFrame', layout: 'v', area: '2 / 2 / 4 / 5' }, [
      slider('VolumeSlider', a.volume),
      meter,
    ]);
    const vc = w('VolumeControl', { name: a.name, layout: 'grid' }, [name, category, volLabel, mute, monitor, meterFrame]);
    vc.dataset.muted = a.muted ? '1' : '';
    vc.dataset.monitoring = a.monitoring;
    vc.dataset.category = a.category;
    processMixerState(vc);
    return vc;
  }

  /** Mirrors VolumeControl::processMixerState() and updateCategoryLabel(). */
  function processMixerState(vc) {
    const muted = !!vc.dataset.muted;
    const type = +vc.dataset.monitoring;
    const active = vc.dataset.category !== 'Inactive';
    const showAsMuted = muted || type === MONITOR_ONLY;
    const showAsMonitored = type !== MONITOR_NONE;
    const showWarningIcon = type === MONITOR_ONLY;
    const mute = vc.querySelector('[data-qc~="btn-mute"]');
    const monitor = vc.querySelector('[data-qc~="btn-monitor"]');

    setChecked(mute, showAsMuted);
    setChecked(monitor, showAsMonitored);
    mute.setAttribute('data-p-tooltip', showAsMuted ? 'Unmute' : 'Mute');
    monitor.setAttribute('data-p-tooltip', showAsMonitored ? 'Disable Monitoring' : 'Enable Monitoring');
    mute.dataset.iconDefault = showWarningIcon ? ':/res/images/unassigned.svg' : ':/settings/images/settings/audio.svg';
    monitor.dataset.iconDefault = showAsMonitored ? ':/res/images/headphones.svg' : ':/res/images/headphones-off.svg';
    // Qt cannot change a QPushButton's icon from :checked, so OBS adds a "checked" class too.
    toggleClass(mute, 'checked', showAsMuted);
    toggleClass(monitor, 'checked', showAsMonitored);
    toggleClass(mute, 'mute-warning', showWarningIcon);

    toggleClass(vc, 'volume-pinned', vc.dataset.category === 'Global');
    toggleClass(vc, 'volume-inactive', !active);
    const meter = vc.querySelector('[data-type="VolumeMeter"]');
    meter.dataset.muted = showAsMuted && !showAsMonitored ? '1' : '';
    meter.dataset.disabledColors = showAsMuted || !active ? '1' : '';
  }

  function setChecked(button, on) {
    removeState(button, on ? 'unchecked' : 'checked');
    addState(button, on ? 'checked' : 'unchecked');
  }

  function mixerDock() {
    const controls = [
      { name: 'Desktop Audio', category: 'Global', muted: false, monitoring: MONITOR_NONE, volume: 0.78, db: '-4.2 dB', level: -14 },
      { name: 'Mic/Aux', category: 'Global', muted: true, monitoring: MONITOR_NONE, volume: 0.9, db: '0.0 dB', level: -22 },
      { name: 'Alerts', category: 'Active', muted: false, monitoring: MONITOR_ONLY, volume: 0.62, db: '-9.5 dB', level: -8 },
      { name: 'Music', category: 'Inactive', muted: false, monitoring: MONITOR_AND_OUTPUT, volume: 0.55, db: '-12.0 dB', level: -60 },
    ].map(volumeControl);
    const hWidgets = w('QWidget', { name: 'hVolumeWidgets', layout: 'v' }, controls);
    const hArea = scrollArea('QScrollArea', { name: 'hMixerScrollArea' }, [hWidgets]);
    const stacked = w('QStackedWidget', { name: 'stackedMixerArea', layout: 'v' }, [hArea]);
    const spacer = w('QWidget', { style: 'flex: 1;' });
    const toolbar = w('QToolBar', { layout: 'h' }, [
      pushButton({ cls: 'toolbar-button toggle-hidden', text: '0 hidden', checkable: true,
                   props: { toolTip: 'Show hidden sources' } }),
      sc('separator'),
      spacer,
      sc('separator'),
      toolButton({ icon: ':/res/images/layout-vertical.svg', tip: 'Vertical Layout' }),
      sc('separator'),
      toolButton({ cls: 'icon-cogs', icon: ':/settings/images/settings/advanced.svg', tip: 'Advanced Audio Properties' }),
      sc('separator'),
      pushButton({ cls: 'toolbar-button text-bold', text: 'Options', menu: true }),
    ]);
    const mixer = w('AudioMixer', { layout: 'v', props: { frameShape: 0 } }, [stacked, toolbar]);
    const contents = w('QWidget', { name: 'dockWidgetContents_7', layout: 'v' }, [mixer]);
    return dock('mixerDock', 'Audio Mixer', contents);
  }

  /* Scene transitions and controls ------------------------------------ */

  function transitionsDock() {
    const frame = w('QFrame', { name: 'transitionsFrame', layout: 'grid' }, [
      comboBox({ name: 'transitions', area: '1 / 1 / 2 / -1' }, 'Fade'),
      label('Duration', { name: 'transitionDurationLabel', area: '2 / 1 / 3 / 2' }),
      spinBox({ name: 'transitionDuration', area: '2 / 2 / 3 / -1' }, '300 ms'),
      pushButton({ name: 'transitionAdd', cls: 'btn-tool icon-plus', icon: ':/res/images/plus.svg', area: '3 / 3 / 4 / 4',
                   props: { toolTip: 'Add Configurable Transition' } }),
      pushButton({ name: 'transitionRemove', cls: 'btn-tool icon-trash', icon: ':/res/images/minus.svg', area: '3 / 4 / 4 / 5',
                   props: { toolTip: 'Remove Configurable Transition' } }),
      pushButton({ name: 'transitionProps', cls: 'btn-tool icon-dots-vert', icon: ':/settings/images/settings/general.svg',
                   area: '3 / 5 / 4 / 6', props: { toolTip: 'Transition Properties' } }),
    ]);
    const contents = w('QWidget', { name: 'dockWidgetContents_5', layout: 'v' }, [frame]);
    return dock('transitionsDock', 'Scene Transitions', contents);
  }

  function controlsDock() {
    const frame = w('QFrame', { name: 'controlsFrame', layout: 'grid' }, [
      pushButton({ name: 'streamButton', text: 'Start Streaming', checkable: true, area: '1 / 1 / 2 / -1' }),
      pushButton({ name: 'recordButton', text: 'Start Recording', checkable: true, area: '2 / 1 / 3 / -1' }),
      pushButton({ name: 'virtualCamButton', text: 'Start Virtual Camera', checkable: true, area: '3 / 1 / 4 / 2' }),
      pushButton({ name: 'virtualCamConfigButton', cls: 'icon-gear', icon: ':/settings/images/settings/general.svg',
                   area: '3 / 2 / 4 / 3', props: { toolTip: 'Configure Virtual Camera' } }),
      pushButton({ name: 'modeSwitch', text: 'Studio Mode', checkable: true, area: '4 / 1 / 5 / -1' }),
      pushButton({ name: 'settingsButton', text: 'Settings', area: '5 / 1 / 6 / -1' }),
    ]);
    const controls = w('OBSBasicControls', { name: 'OBSBasicControls', layout: 'v' }, [frame]);
    return dock('controlsDock', 'Controls', controls);
  }

  /* Central widget: preview and source context bar --------------------- */

  function centralWidget() {
    const preview = w('OBSBasicPreview', { name: 'preview', area: '1 / 1 / 2 / 2' }, [paint('mock-canvas')]);
    const xContainer = w('QWidget', { name: 'previewXContainer', layout: 'h', area: '2 / 1 / 3 / 2' }, [
      pushButton({ name: 'previewZoomOutButton', cls: 'icon-minus', icon: ':/res/images/minus.svg', iconSize: 8,
                   props: { toolTip: 'Zoom Out' } }),
      w('OBSPreviewScalingLabel', { name: 'previewScalePercent', text: '45%' }),
      pushButton({ name: 'previewZoomInButton', cls: 'icon-plus', icon: ':/res/images/plus.svg', iconSize: 8,
                   props: { toolTip: 'Zoom In' } }),
      comboBox({ name: 'previewScalingMode', type: 'OBSPreviewScalingComboBox' }, 'Scale to Window'),
      w('QWidget', { style: 'flex: none; width: 4px;' }),
      scrollBar('horizontal', { name: 'previewXScrollBar', pos: 0.5, page: 0.5, style: 'flex: 1;' }),
    ]);
    const yBar = scrollBar('vertical', { name: 'previewYScrollBar', pos: 0.5, page: 0.5, area: '1 / 2 / 2 / 3' });
    const container = w('QWidget', { name: 'previewContainer', layout: 'grid' }, [preview, yBar, xContainer]);
    const canvasEditor = w('QWidget', { name: 'canvasEditor', layout: 'h' }, [container]);

    const context = w('QFrame', { name: 'contextContainer', layout: 'h', style: 'gap: 6px;' }, [
      w('QFrame', { name: 'contextSubContainer', layout: 'h', style: 'gap: 6px;' }, [
        w('QLabel', { name: 'contextSourceIcon', iconQp: 'gameCapIcon', icon: ':/res/images/sources/gamepad.svg', iconSize: 16 }),
        label('Game Capture', { name: 'contextSourceLabel' }),
        w('QLabel', { name: 'contextSourceIconSpacer' }),
        line(),
        pushButton({ name: 'sourcePropertiesButton', text: 'Properties', icon: ':/settings/images/settings/general.svg' }),
        pushButton({ name: 'sourceFiltersButton', text: 'Filters', icon: ':/res/images/filter.svg' }),
        line(),
      ]),
      w('QFrame', { name: 'emptySpace', layout: 'h', style: 'flex: 1;' }),
    ]);
    return w('QWidget', { name: 'centralwidget', layout: 'v' }, [canvasEditor, context]);
  }

  /* Menu bar and status bar --------------------------------------------- */

  function menuBar() {
    const menus = ['File', 'Edit', 'View', 'Docks', 'Profile', 'Scene Collection', 'Tools', 'Help'];
    return w('QMenuBar', { name: 'menubar', layout: 'h' }, menus.map(m => sc('item', { text: m })));
  }

  function statusBar() {
    const frame = (name, children) => w('QFrame', { name, layout: 'h', props: { frameShape: 0 } }, children);
    const pixmap = (name, file) => w('QLabel', { name, icon: ':/res/images/' + file, iconDark: 'theme:Dark/' + file, iconSize: 16 });
    const widget = w('StatusBarWidget', { name: 'StatusBarWidget', layout: 'h' }, [
      frame('messageFrame', [label('', { name: 'message' })]),
      frame('networkFrame', [pixmap('statusIcon', 'network-inactive.svg')]),
      frame('streamFrame', [pixmap('streamIcon', 'streaming-inactive.svg'), label('00:00:00', { name: 'streamTime' })]),
      frame('recordFrame', [pixmap('recordIcon', 'recording-inactive.svg'), label('00:00:00', { name: 'recordTime' })]),
      frame('cpuFrame', [label('CPU: 1.2%', { name: 'cpuUsage' })]),
      frame('fpsFrame', [label('60.00 / 60.00 FPS', { name: 'fpsCurrent' })]),
    ]);
    widget.firstElementChild.style.flex = '1';
    return w('OBSBasicStatusBar', { name: 'statusbar', layout: 'h' }, [widget]);
  }

  /* ------------------------------------------------------------------ */
  /* Main window, default layout of OBS 32.2.1                           */
  /* Scenes and Sources stacked on the left (full height), the central   */
  /* widget top right, then Audio Mixer, Scene Transitions and Controls  */
  /* along the bottom.                                                   */

  function build() {
    const at = (el, area) => { el.style.gridArea = area; return el; };
    const separator = (area, orientation) => sc('separator', { states: [orientation], area });
    const win = w('OBSBasic', { name: 'OBSBasic' }, [
      at(menuBar(), '1 / 1 / 2 / -1'),
      at(scenesDock(), '2 / 1 / 3 / 2'),
      separator('3 / 1 / 4 / 2', 'horizontal'),
      at(sourcesDock(), '4 / 1 / 7 / 2'),
      separator('2 / 2 / 7 / 3', 'vertical'),
      at(centralWidget(), '2 / 3 / 5 / -1'),
      separator('5 / 3 / 6 / -1', 'horizontal'),
      at(mixerDock(), '6 / 3 / 7 / 4'),
      separator('6 / 4 / 7 / 5', 'vertical'),
      at(transitionsDock(), '6 / 5 / 7 / 6'),
      separator('6 / 6 / 7 / 7', 'vertical'),
      at(controlsDock(), '6 / 7 / 7 / 8'),
      at(statusBar(), '7 / 1 / 8 / -1'),
    ]);
    win.classList.add('mock-window');
    return win;
  }

  /* ------------------------------------------------------------------ */
  /* Interaction                                                         */

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

  function toggleChecked(el) {
    const on = !hasState(el, 'checked');
    setChecked(el, on);
    const ind = el.querySelector(':scope > [data-sc="indicator"]');
    if (ind) setChecked(ind, on);
    return on;
  }

  /** Makes the mock-up respond to clicks; onChange(element) is called after each change. */
  function wire(root, onChange) {
    root.addEventListener('scroll', () => syncScrollBars(root), true);
    root.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) return; // reserved for the inspector

      // Volume control buttons follow VolumeControl::handleMuteButton / handleMonitorButton.
      const vc = e.target.closest('[data-type="VolumeControl"]');
      const vcButton = vc && e.target.closest('[data-qc~="btn-mute"], [data-qc~="btn-monitor"]');
      if (vcButton) {
        const type = +vc.dataset.monitoring;
        if (/btn-mute/.test(vcButton.dataset.qc)) {
          const showAsMuted = !!vc.dataset.muted || type === MONITOR_ONLY;
          vc.dataset.muted = showAsMuted ? '' : '1';
          if (showAsMuted && type === MONITOR_ONLY) vc.dataset.monitoring = MONITOR_AND_OUTPUT;
        } else {
          vc.dataset.monitoring = type !== MONITOR_NONE ? MONITOR_NONE : MONITOR_AND_OUTPUT;
        }
        processMixerState(vc);
        onChange(vc);
        return;
      }

      const item = e.target.closest('[data-sc="item"]');
      const checkbox = e.target.closest('[data-t~="QCheckBox"]');
      if (checkbox && root.contains(checkbox)) {
        const on = toggleChecked(checkbox);
        // The visibility box of a source dims its icon and name.
        if (/indicator-visibility/.test(checkbox.dataset.qc)) {
          for (const sib of checkbox.parentElement.querySelectorAll(':scope > [data-t~="QLabel"]')) {
            if (on) removeState(sib, 'disabled'); else addState(sib, 'disabled');
          }
        }
        onChange(checkbox);
        return;
      }
      if (item && root.contains(item) && !item.closest('[data-t~="QMenuBar"]')) {
        for (const other of item.parentElement.querySelectorAll(':scope > [data-sc="item"]')) {
          removeState(other, 'selected');
          removeState(other, 'focus');
        }
        addState(item, 'selected');
        addState(item, 'focus');
        onChange(item);
        return;
      }
      const button = e.target.closest('[data-s~="checkable"]');
      if (button && root.contains(button)) {
        toggleChecked(button);
        onChange(button);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Painted widgets: sliders and volume meters                          */
  /* Qt places slider sub-controls itself and OBS paints its meters: the */
  /* positions are computed here, the colours come from the theme.       */

  function layoutSliders(root) {
    for (const s of root.querySelectorAll('[data-t~="QSlider"]')) {
      const groove = s.querySelector(':scope > [data-sc="groove"]');
      const handle = s.querySelector(':scope > [data-sc="handle"]');
      const sub = s.querySelector(':scope > [data-sc="sub-page"]');
      const add = s.querySelector(':scope > [data-sc="add-page"]');
      const value = +s.dataset.value || 0;
      // Qt makes the slider tall enough for its handle.
      s.style.minHeight = handle.offsetHeight + 'px';
      groove.style.transform = 'none';
      groove.style.top = Math.round((s.clientHeight - groove.offsetHeight) / 2) + 'px';
      const hw = handle.offsetWidth;
      const left = groove.offsetLeft + (groove.offsetWidth - hw) * value;
      // Negative vertical margins grow the handle around the groove in Qt: centre it.
      const mt = parseFloat(getComputedStyle(handle).marginTop) || 0;
      handle.style.left = left + 'px';
      handle.style.transform = 'none';
      handle.style.top = (groove.offsetTop + groove.offsetHeight / 2 - handle.offsetHeight / 2 - mt) + 'px';
      const center = left + hw / 2;
      for (const [el, from, to] of [[sub, groove.offsetLeft, center], [add, center, groove.offsetLeft + groove.offsetWidth]]) {
        el.style.left = from + 'px';
        el.style.width = Math.max(0, to - from) + 'px';
        el.style.top = groove.offsetTop + 'px';
        el.style.height = groove.offsetHeight + 'px';
      }
    }
  }

  const METER_DEFAULTS = {
    backgroundnominalcolor: '#267f26', backgroundwarningcolor: '#7f7f26', backgrounderrorcolor: '#7f2626',
    foregroundnominalcolor: '#4cff4c', foregroundwarningcolor: '#ffff4c', foregrounderrorcolor: '#ff4c4c',
    backgroundnominalcolordisabled: 'rgb(90,90,90)', backgroundwarningcolordisabled: 'rgb(117,117,117)',
    backgrounderrorcolordisabled: 'rgb(65,65,65)', foregroundnominalcolordisabled: 'rgb(163,163,163)',
    foregroundwarningcolordisabled: 'rgb(217,217,217)', foregrounderrorcolordisabled: 'rgb(113,113,113)',
    magnitudecolor: '#000', majortickcolor: '#000', minortickcolor: '#323232',
  };

  /** Paints a horizontal stereo meter as VolumeMeter::paintEvent() does. */
  function paintMeters(root) {
    for (const m of root.querySelectorAll('[data-type="VolumeMeter"]')) {
      const surface = m.querySelector(':scope > .mock-meter');
      const cs = getComputedStyle(m);
      const color = k => (cs.getPropertyValue('--qp-' + k) || '').trim() || METER_DEFAULTS[k];
      const disabled = !!m.dataset.disabledColors || !!m.dataset.muted;
      const pick = (layer, kind) => color(`${layer}${kind}color${disabled ? 'disabled' : ''}`);

      const channels = 2, thickness = 6, indicator = 3;
      const bar = channels * (thickness + 1) - 1;
      const fontPx = parseFloat(cs.fontSize) || 8;
      const width = Math.max(60, m.clientWidth);
      const height = bar + Math.ceil(fontPx * 1.4) + 4;
      const dpr = window.devicePixelRatio || 1;
      let canvas = surface.querySelector('canvas');
      if (!canvas) { canvas = document.createElement('canvas'); surface.appendChild(canvas); }
      canvas.width = width * dpr; canvas.height = height * dpr;
      canvas.style.width = width + 'px'; canvas.style.height = height + 'px';
      const c = canvas.getContext('2d');
      c.scale(dpr, dpr);
      c.fillStyle = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : 'transparent';
      c.clearRect(0, 0, width, height);
      if (c.fillStyle !== 'transparent') c.fillRect(0, 0, width, height);

      const start = indicator + 2, length = width - start;
      const pos = db => length - Math.trunc(db * (length / -60));
      const warn = pos(-20), err = pos(-9);
      // Ticks and labels under the bars.
      c.font = `${cs.fontWeight} ${fontPx}px ${cs.fontFamily}`;
      c.fillStyle = color('majortickcolor');
      c.textBaseline = 'top';
      for (let db = 0; db >= -60; db -= 6) {
        const x = Math.round(indicator + 3 + (width - indicator - 3) - db * ((width - indicator - 3) / -60) - 1);
        c.fillRect(x, bar, 1, 2);
        const text = String(db);
        const tw = c.measureText(text).width;
        c.fillText(text, db === 0 ? x - tw : Math.max(0, x - tw / 2), bar + 3);
      }
      // Background, then the level, peak hold and magnitude, per channel.
      const level = m.dataset.muted ? -60 : +m.dataset.level;
      for (let ch = 0; ch < channels; ch++) {
        const y = ch * (thickness + 1);
        c.fillStyle = pick('background', 'error'); c.fillRect(start, y, length, thickness);
        c.fillStyle = pick('background', 'warning'); c.fillRect(start, y, err, thickness);
        c.fillStyle = pick('background', 'nominal'); c.fillRect(start, y, warn, thickness);
        const peak = pos(level - ch * 1.5);
        if (level > -60) {
          if (peak > err) { c.fillStyle = pick('foreground', 'error'); c.fillRect(start, y, Math.min(peak, length), thickness); }
          if (peak > warn) { c.fillStyle = pick('foreground', 'warning'); c.fillRect(start, y, Math.min(peak, err), thickness); }
          if (peak > start) { c.fillStyle = pick('foreground', 'nominal'); c.fillRect(start, y, Math.min(peak, warn), thickness); }
          c.fillStyle = color('magnitudecolor');
          c.fillRect(start + pos(level - 6 - ch * 1.5) - 3, y, 3, thickness);
          c.fillStyle = pick('foreground', 'nominal');
          c.fillRect(0, y, indicator, thickness);
        }
      }
    }
  }

  /** The preview: OBSQTDisplay fills itself with displayBackgroundColor, the canvas sits centred. */
  function paintPreview(root) {
    for (const d of root.querySelectorAll('[data-t~="OBSQTDisplay"]')) {
      const value = getComputedStyle(d).getPropertyValue('--qp-displaybackgroundcolor').trim();
      d.style.backgroundColor = value || 'rgb(76, 76, 76)';
    }
  }

  /** Shows the scroll bar of a scroll area whose contents overflow, at the viewport's position. */
  function syncScrollBars(root) {
    for (const vp of root.querySelectorAll('[data-viewport]')) {
      const container = vp.parentElement.querySelector(':scope > [data-name="qt_scrollarea_vcontainer"]');
      if (!container) continue;
      const over = vp.scrollHeight > vp.clientHeight + 1;
      container.hidden = !over;
      if (!over) continue;
      const bar = container.querySelector('[data-t~="QScrollBar"]');
      bar.style.setProperty('--page', vp.clientHeight / vp.scrollHeight);
      bar.style.setProperty('--pos', vp.scrollTop / Math.max(1, vp.scrollHeight - vp.clientHeight));
    }
  }

  function paintAll(root) {
    syncScrollBars(root);
    layoutSliders(root);
    paintMeters(root);
    paintPreview(root);
  }

  window.OTI = window.OTI || {};
  window.OTI.mock = { build, wire, lineage, addState, removeState, hasState, paintAll };
})();
