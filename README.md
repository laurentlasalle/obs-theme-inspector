# OBS Theme Inspector

See how an OBS Studio theme (`.obt`, `.ovt`, `.oha`) styles the OBS interface, in a web browser, and find out exactly which rule controls which element.

OBS draws its interface with Qt, whose style sheets look like CSS but run outside the browser. Finding the right selector for a widget usually means guessing from OBS's source code. This tool rebuilds the OBS main window as HTML, applies your theme to it, and shows the rules that reach any element you hover, in the order Qt applies them.

> **Work in progress.** The tool is usable but incomplete: only the Scenes dock of the main window is drawn so far, and the rest (Sources, Audio Mixer, Controls, Transitions, preview, status bar and menu bar) will follow. Expect rough edges, and changes to how things work from one update to the next.

## Use it

1. Download or clone this repository.
2. Open `index.html` in Firefox or Chrome, on Windows, macOS or Linux. No server or installation is needed.
3. Pick a theme in the **Theme** menu. The themes bundled with OBS 32.2.1 (Yami and its variants) are always available.
4. To inspect your own theme, click **Add folder…** and choose the folder holding your theme files, or drag them onto the page. Bring the image folders too (for example `LJCS/popout.svg`), so `url(theme:…)` icons can be found.

Your files, settings and pending changes are kept in the browser for next time. **Remove my files** forgets your files and the changes made to them.

### Inspecting

- **Hover** an element of the mock-up: the **Element** tab shows its Qt class and ancestors, its `objectName` (what `#name` targets), its `class` property (what `.name` targets), and every rule that reaches it, with variables resolved.
- **Ctrl + click** (**⌘ + click** on a Mac) pins the selection, so you can scroll through its rules. Do it again to release it.
- Click a **rule's header** to highlight every element it targets.
- For a sub-control such as `::item`, **Inherited from …** shows the rules of its widget that give it its font and colour: Qt draws sub-controls with their widget's font and colour.
- **Computed** lists the final value of the main properties (font, colours, background, borders, padding, margin, sizes) and where each one comes from: a rule, the widget it inherits from, or Qt's defaults. Click a source to jump to its rule; click a value to set that property in a new rule for the element, or in one of the rules that already target it.
- **Force states** previews `:hover`, `:pressed`, `:checked`, `:selected` and others without the mouse.
- Rules are listed from the one applied last (the strongest) to the first. Declarations overridden by a later rule are struck through.
- The **Variables** tab lists every `@OBSThemeVars` variable with its final value and where it was defined.
- The **Problems** tab lists what OBS would ignore or could not find: missing images, unknown variables, invalid selectors.
- **Font Size**, **Density** and **System** reproduce the settings that feed `obsFontScale`, `obsPadding` and the `--os_win_*` / `--os_mac_*` / `--os_lin_*` variables. **Zoom** helps compare with screenshots taken at 150 % or 200 % display scaling.
- The browser's own inspector works too (right-click › **Inspect**): each theme file is a separate style sheet, named after the file, and every translated rule keeps its original selector and line number in a comment.

## Editing

Click a value in the **Element** or **Variables** tab to change it. The mock-up updates while you type, and every element the rule targets is highlighted: in Qt, a change applies to a rule, never to a single element. Up and Down arrows step the first number of a value (Shift: by 10, Alt: by 0.1); Enter keeps the value, Escape restores it.

- **+ property** adds a property to a rule; **+ New rule** creates a rule for the selected element, with a suggested selector you can adjust.
- The checkbox next to a declaration of your own file disables it.
- **↺** reverts a change; **✕** removes a property or a rule you added.

Your files are never modified, and nothing leaves the page until you ask for it in the **Changes** tab.

The browser keeps your loaded files, settings and changes, so reloading the page loses nothing. A banner then says how many changes were restored, with a **Revert all** button to start again from the original theme. Each browser keeps its own copy. If you load a new version of a file, the changes made to the old one are dropped, since they point at lines that may have moved.

### Where changes go

- **Rules of your own file** are changed where they are.
- **Rules of a parent theme** (for example `Yami.obt`) are not touched: a rule with the same selectors and only the changed properties is added at the end of your file. It has the same specificity and comes later in the chain, so it wins, exactly as in OBS.
- **Variables** are changed in, or added to, the `@OBSThemeVars` block of your file.
- When the theme you edit comes with OBS (Yami, Yami Classic …), the changes go to a **new variant** that extends it, since OBS replaces its own files at every update. Its name, ID, file name and author can be set in the **Changes** tab.

### Getting the result

The **Changes** tab lists every change, each with its own revert button, and offers three outputs:

- **Edited file**: the complete file, to copy or download.
- **Block to append**: only the changes, written as rules to paste at the end of your file; deleting the block undoes them. OBS only reads the first `@OBSThemeVars` block of a file, so changed variables are listed apart, to be replaced by hand.
- **Comparison**: the original and the edited file line by line, removed lines in red and added lines in green, in one column or side by side, with a **Copy as patch** button.

## How faithful is it?

The theme processing follows OBS 32.2.1 (`frontend/OBSApp_Themes.cpp`) closely: the dependency chain, the variable parser, `calc()` / `max()` / `min()`, rounding of `px` values, and the order in which files are applied. Quirks are kept on purpose; for example, OBS reads `#fff` as `#000fff`, and keeps only the first word of a plain-text variable.

Qt style sheets are then translated to CSS:

| Qt | In the mock-up |
| --- | --- |
| `QPushButton` (matches subclasses) | `[data-t~="QPushButton"]`, every element lists its whole class lineage |
| `#name` | `[data-name="name"]` |
| `.name` (the `class` property) | `[data-qc~="name"]` |
| `::item`, `::title`, `::indicator` … | child elements with `data-sc` |
| `:checked`, `:selected`, `:!hover` … | `data-s` states, or the browser's own `:hover`, `:active`, `:focus` |
| Specificity, then source order | one cascade layer per Qt specificity, so the browser applies rules in Qt's order |
| No inheritance of colour and font between widgets | every widget starts from the palette and the default font |

What remains an approximation:

- **Layout.** Qt's layouts are imitated with flexbox; sizes can differ by a few pixels.
- **Unstyled parts.** What a theme does not style is drawn by Qt's own style ("windowsvista" on Windows); the mock-up only imitates it.
- **Qt-only properties.** `qproperty-icon`, `titlebar-close-icon`, `titlebar-normal-icon`, `icon-size` and `image` are applied by script. Others are listed in the **Problems** tab when they cannot be translated.

## Scope

The mock-up currently contains the **Scenes** dock. The rest of the main window (Sources, Audio Mixer, Controls, Transitions, preview, status bar, menu bar) comes next.

## Updating the bundled OBS themes

The default themes are embedded in `app/bundle-obs-<version>.js`, because a page opened from disk cannot read the files next to it.

1. Copy `frontend/data/themes` of the OBS release to `themes/obs-<version>/`, and `frontend/forms/images` to `resources/obs-<version>-images/`.
2. Run `python3 tools/bundle_themes.py <version>`.
3. Point the `<script>` tag in `index.html` to the new bundle.

## Licence

GPL-2.0-or-later, like OBS Studio, whose theme files and images are included (see `LICENSE`). Written by Laurent LaSalle.
