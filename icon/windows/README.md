# Telegram Drive — Windows Icon Implementation

Complete icon work package: the new folder artwork implemented for the Tauri 2 app
`Telegram Drive` (`github.com/caamer20/Telegram-Drive`, `app/src-tauri/`), built and verified.

## Contents

| Folder | What it is |
| --- | --- |
| `assets/` | The full generated icon set as installed in `app/src-tauri/icons/` |
| `source/` | The artwork masters everything was derived from |
| `verification/` | Rendered proof sheets from the actual build |
| `config/` | The one config file that was modified |

## Source handling

- `source/extracted_artwork_1269x1240.png` — the artwork provided in `clean_icon.svg`. The SVG
  was only a 2048-viewBox wrapper around this embedded PNG; it was extracted losslessly.
- `source/master_1269.png` — the square working master (1269x1269): the artwork pasted
  unresampled onto a transparent square canvas at the SVG's exact meet-scaling geometry
  (artwork fills the width, ~14px transparent bands top/bottom).
- Every asset below is derived by **downscale-only Lanczos resampling** from the master
  (largest consumer is 512px vs 1269px native — no upscaling anywhere).
- Transparency preserved: transparent corners untouched, interior ~252/255 alpha kept as-is.
  No recoloring, no background added.

## The Windows icon (`assets/icon.ico`, 103 KB)

Hand-built multi-resolution ICO — **9 embedded sizes**:

| Sizes | Encoding | Notes |
| --- | --- | --- |
| 16, 20, 24, 32, 48 | 32bpp BMP | subtle unsharp after downscale for crispness |
| 64, 96, 128, 256 | PNG-compressed entries | Vista+ shell format |

- The 20px entry covers 125% DPI taskbar scaling that the default Tauri set (16/24/32/48/64/256) misses.
- Small sizes were side-by-side verified crisper than the official `tauri icon` CLI output;
  256px is pixel-equivalent (`verification/compare_ico.png`).

## Full asset set (`assets/`)

| File | Purpose |
| --- | --- |
| `icon.ico` | Windows exe resource, installer, shortcuts, taskbar — **the main deliverable** |
| `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.png` | files referenced by `tauri.conf.json` `bundle.icon` |
| `Square*.png` (x9), `StoreLogo.png` | UWP/MSIX square logos |
| `logo.ico`, `logo.png` | auxiliary brand icons (logo.ico now multi-size 16-64) |
| `icon.icns` | macOS bundle icon (official CLI output, 16→1024) |
| `ios/AppIcon-*.png` (18) | iOS icon set (official CLI output) |
| `android/mipmap-*` | Android adaptive launcher icons (official CLI output; the repo gitignores this folder by design) |

## Tauri configuration wiring

`tauri.conf.json` was already correct — its `bundle.icon` list points at
`icons/32x32.png`, `icons/128x128.png`, `icons/128x128@2x.png`, `icons/icon.icns`, `icons/icon.ico`,
and tauri-build embeds the `.ico` into the exe (verified: generated `resource.rc` line
`32512 ICON "…icons\icon.ico"`).

The **one required change** was adding the installer icon, otherwise the NSIS installer keeps
the default NSIS logo. See `config/tauri.windows.release.conf.json`:

```json
"nsis": {
  "installerHooks": "./windows/vcredist-hooks.nsh",
  "installerIcon": "icons/icon.ico"
}
```

The tray icon uses `app.default_window_icon()`, which embeds from the same `bundle.icon` set —
no code change needed.

## Verification (from the actual release build)

- `verification/acceptance_sheet.png` — source .ico vs `app.exe` vs NSIS installer icon,
  rendered through `SHDefExtractIcon` (the API Explorer itself uses) at 16/32/48px.
- `verification/final_sheet.png` — all 9 ICO resolutions on light and dark backgrounds.
- Build outputs that carried these icons:
  `target/release/app.exe` (RT_ICON parse: 9 images, 16-256, 32bpp) and
  `target/release/bundle/nsis/Telegram Drive_3.9.5_x64-setup.exe`.

## Reuse in another Tauri 2 project

1. Copy `assets/*` into `src-tauri/icons/`.
2. Ensure `bundle.icon` in `tauri.conf.json` lists `icons/32x32.png`, `icons/128x128.png`,
   `icons/128x128@2x.png`, `icons/icon.icns`, `icons/icon.ico`.
3. Add `"installerIcon": "icons/icon.ico"` under `bundle.windows.nsis` in your Windows config.
4. Rebuild — the exe, installer, shortcuts, and tray all pick it up automatically.
