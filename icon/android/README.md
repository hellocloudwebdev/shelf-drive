# Android launcher icon work — Acme AI (Ace Studio)

Complete Android launcher icon implementation derived from the canonical artwork
(`source/clean_icon.svg`). This is the Android part of the icon work; the
sibling `windows/` folder contains the Windows/desktop icon set produced
separately. Do not mix them: `windows/assets/android/` holds Tauri's *default*
icon output (white `#fff` background color, no themed icon), while this folder
holds the full custom implementation described below.

## Contents

```
res/                                  Android resource tree — drop-in for
                                      src-tauri/gen/android/app/src/main/res/
  drawable/ic_launcher_background.xml   adaptive background: diagonal gradient
                                        vector #FFDDF2FB -> #FF95CDF9
  drawable/ic_launcher_monochrome.xml   Android 13+ themed-icon glyph (vector)
  mipmap-anydpi-v26/ic_launcher.xml     adaptive icon wiring: background +
                                        foreground + monochrome
  mipmap-anydpi-v26/ic_launcher_round.xml
  mipmap-*/ic_launcher_foreground.png   folder logo on transparency, 108dp
                                        canvas, logo inside the 66dp safe zone
  mipmap-*/ic_launcher.png              legacy icon, full artwork (API < 26)
  mipmap-*/ic_launcher_round.png        legacy circular variant
source/clean_icon.svg                 canonical artwork (unmodified)
source/extracted_artwork_1269x1240.png  the PNG embedded in that SVG (its true
                                        pixel source; the "SVG" is a wrapper)
verification/final_check.png          shipped files composited under circle /
                                      squircle / rounded-square masks at 432px,
                                      96px adaptive + 48px legacy, next to the
                                      original artwork
verification/monochrome.png           themed-icon glyph, 216px
verification/monochrome_48px.png      themed-icon glyph at 48px
verification/separation_proof.png     foreground over checkerboard (proves the
                                      light-blue squircle is NOT baked into the
                                      foreground) next to the original
```

## How it works

- The supplied "SVG" is a 2048-class PNG wrapped in an SVG tag, with the
  light-blue rounded-square background baked in. The folder logo was separated
  by fitting the background gradient and computing per-pixel alpha so that
  `alpha*logo + (1-alpha)*background` reproduces the original pixel-for-pixel
  (measured error p99 < 1/255). Glass translucency and the soft drop shadow are
  preserved in the foreground's alpha channel; the solid folder is fully opaque.
- Background layer: full-bleed vector gradient; the launcher mask (circle,
  squircle, rounded square...) defines the icon shape.
- Foreground: the original squircle maps onto the 72dp mask viewport, so the
  logo sits well inside the 66dp safe circle — no mask can crop it.
- Monochrome: folder silhouette with tab and two slot gaps echoing the layered
  sheets; alpha-only, tinted by the system.
- Legacy mipmaps keep the original full artwork for API 24-25.

## Install

Copy `res/.` into `src-tauri/gen/android/app/src/main/res/` of the Tauri
project (`D:\Packages\projects` — already installed there; tracked backup at
`src-tauri/icons/android-res/`). `tauri android init` skips existing files, so
this can be done before or after init. Optional: add
`android:roundIcon="@mipmap/ic_launcher_round"` to the generated manifest's
`<application>` (Tauri's template omits it; the round resources are provided).

## Tools

Preview/verification generator (self-contained, uses only `source/` + `res/`):
`acme-ai-android-icons` repo at `C:\Users\Hp\.zcode\workspace\default\`
(`tools/render_previews.py`), committed as git repo
`acme-ai-android-icons` (branch `main`).
