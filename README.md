# OBS Theme Inspector

See how an OBS Studio theme (`.obt`, `.ovt`, `.oha`) styles the OBS interface, in a web browser, and find out exactly which rule controls which element.

OBS draws its interface with Qt, whose style sheets look like CSS but run outside the browser. Finding the right selector for a widget usually means guessing from OBS's source code. This tool rebuilds the OBS main window as HTML, applies your theme to it, and shows the rules that reach any element you hover, in the order Qt applies them.

## Use it

1. Download or clone this repository.
2. Open `index.html` in Firefox or Chrome, on Windows, macOS or Linux. No server or installation is needed.
3. Pick a theme in the **Theme** menu. The themes bundled with OBS 32.2.1 (Yami and its variants) are always available.
4. To inspect your own theme, click **Add folder…** and choose the folder holding your theme files, or drag them onto the page. Bring the image folders too (for example `LJCS/popout.svg`), so `url(theme:…)` icons can be found.

Your files and settings are kept in the browser for next time. **Remove my files** forgets them.

### Inspecting

- **Hover** an element of the mock-up: the **Element** tab shows its Qt class and ancestors, its `objectName` (what `#name` targets), its `class` property (what `.name` targets), and every rule that reaches it, with variables resolved.
- **Ctrl + click** (**⌘ + click** on a Mac) pins the selection, so you can scroll through its rules. Do it again to release it.
- Click a **rule's header** to highlight every element it targets.
- **Force states** previews `:hover`, `:pressed`, `:checked`, `:selected` and others without the mouse.
- Rules are listed from the one applied last (the strongest) to the first. Declarations overridden by a later rule are struck through.
- The **Variables** tab lists every `@OBSThemeVars` variable with its final value and where it was defined.
- The **Problems** tab lists what OBS would ignore or could not find: missing images, unknown variables, invalid selectors.
- **Font Size**, **Density** and **System** reproduce the settings that feed `obsFontScale`, `obsPadding` and the `--os_win_*` / `--os_mac_*` / `--os_lin_*` variables. **Zoom** helps compare with screenshots taken at 150 % or 200 % display scaling.
- The browser's own inspector works too (right-click › **Inspect**): each theme file is a separate style sheet, named after the file, and every translated rule keeps its original selector and line number in a comment.

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
