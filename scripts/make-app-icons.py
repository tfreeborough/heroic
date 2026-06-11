#!/usr/bin/env python3
# /// script
# dependencies = ["pillow", "numpy"]
# ///
"""Generate Expo app icon variants from a single square master image.

Usage:
    python3 scripts/make-app-icons.py <master.png> <assets-dir>

e.g.
    python3 scripts/make-app-icons.py \
        apps/enter-the-gauntlet/assets/enter-the-gauntlet.png \
        apps/enter-the-gauntlet/assets

Writes into <assets-dir>:
    icon.png                     1024x1024 opaque (iOS + default)
    android-icon-foreground.png  subject extracted, scaled to the adaptive-icon
                                 safe zone, transparent elsewhere
    android-icon-background.png  clean re-render of the master's background
    android-icon-monochrome.png  solid white silhouette (Android themed icons)
    favicon.png                  48x48 (or the existing favicon's size)

Plus a preview contact sheet at /tmp/icon_preview.png:
    main icon | adaptive icon circle-masked | themed monochrome | foreground cutout

Assumptions about the master image (true of AI-generated app icons on a
plain backdrop):
  - square, subject centered (the image's center pixel is part of the subject)
  - background is a smooth gradient or flat color, distinct in color from
    the subject's edges

The background is recovered by fitting a degree-4 2D polynomial surface per
RGB channel to known-background pixels (seeded from the image border, refined
iteratively); pixels that deviate from the surface are the subject.

Dependencies: pip install pillow numpy   (or run with: uv run make-app-icons.py ...)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


def propagate(seed, allowed):
    """Grow seed via 4-connectivity, constrained to allowed, until stable."""
    comp = seed & allowed
    while True:
        grown = comp.copy()
        grown[1:, :] |= comp[:-1, :]
        grown[:-1, :] |= comp[1:, :]
        grown[:, 1:] |= comp[:, :-1]
        grown[:, :-1] |= comp[:, 1:]
        grown &= allowed
        if (grown == comp).all():
            return comp
        comp = grown


def dilate(mask, n):
    for _ in range(n):
        grown = mask.copy()
        grown[1:, :] |= mask[:-1, :]
        grown[:-1, :] |= mask[1:, :]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        mask = grown
    return mask


def erode(mask, n):
    for _ in range(n):
        e = mask.copy()
        e[1:, :] &= mask[:-1, :]
        e[:-1, :] &= mask[1:, :]
        e[:, 1:] &= mask[:, :-1]
        e[:, :-1] &= mask[:, 1:]
        mask = e
    return mask


def poly_basis(xn, yn, degree=4):
    return np.stack(
        [
            (xn**i * yn**j).ravel()
            for i in range(degree + 1)
            for j in range(degree + 1)
            if i + j <= degree
        ],
        axis=1,
    )


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__.split("\n\n")[1])
    src_path, assets = Path(sys.argv[1]), Path(sys.argv[2])

    src = Image.open(src_path).convert("RGB")
    W, H = src.size
    if W != H:
        sys.exit(f"master image must be square, got {W}x{H}")
    arr = np.asarray(src).astype(np.float64)
    yy, xx = np.mgrid[0:H, 0:W]

    # --- fit background surface: seed with border pixels, refine iteratively ---
    B = poly_basis(xx / W - 0.5, yy / H - 0.5)
    margin = int(0.05 * W)
    bg_mask = (
        (xx < margin) | (xx >= W - margin) | (yy < margin) | (yy >= H - margin)
    ).ravel()
    for _ in range(4):
        coefs = np.linalg.lstsq(B[bg_mask], arr.reshape(-1, 3)[bg_mask], rcond=None)[0]
        model = (B @ coefs).reshape(H, W, 3)
        dist = np.linalg.norm(arr - model, axis=-1)
        bg_mask = (dist < 25).ravel()

    # soft alpha from color distance to the background model
    T0, T1 = 25.0, 60.0
    alpha = np.clip((dist - T0) / (T1 - T0), 0, 1)

    # keep only the component connected to the image center (drops stray speckles)
    hard = dist > (T0 + T1) / 2
    seed = np.zeros_like(hard)
    seed[H // 2, W // 2] = True
    comp = propagate(seed, hard)

    # enclosed background-colored pockets inside the subject = pinholes; fill them
    border = np.zeros_like(hard)
    border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
    outside = propagate(border, ~comp)
    holes = ~comp & ~outside

    # dilated component keeps the soft edge band; eroded solid hardens the
    # interior (partial-alpha pixels there would show in the monochrome layer)
    alpha *= dilate(comp, 4)
    alpha = np.maximum(alpha, holes)
    solid = comp | holes
    alpha = np.maximum(alpha, erode(solid, 3))
    print(f"subject: {comp.mean():.0%} of image, filled {holes.sum()} hole px")

    alpha8 = (alpha * 255).astype(np.uint8)
    subject = Image.fromarray(np.dstack([arr.astype(np.uint8), alpha8]), "RGBA")
    ys, xs = np.nonzero(alpha8 > 10)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    subject_crop = subject.crop(bbox)

    OUT = 1024

    # --- icon.png: plain 1024 resize of the full artwork ---
    src.resize((OUT, OUT), Image.LANCZOS).save(assets / "icon.png")

    # --- android background: re-render the fitted surface, subject-free ---
    yo, xo = np.mgrid[0:OUT, 0:OUT]
    Bo = poly_basis(xo / OUT - 0.5, yo / OUT - 0.5)
    bg_out = (Bo @ coefs).reshape(OUT, OUT, 3).clip(0, 255).astype(np.uint8)
    Image.fromarray(bg_out, "RGB").save(assets / "android-icon-background.png")
    print(
        "suggest adaptiveIcon.backgroundColor: #%02X%02X%02X" % tuple(bg_out[0, 0])
    )

    # --- android foreground: subject scaled into the 66/108dp safe zone ---
    SAFE = round(66 / 108 * OUT)
    scale = SAFE / max(subject_crop.size)
    fw, fh = (round(s * scale) for s in subject_crop.size)
    pos = ((OUT - fw) // 2, (OUT - fh) // 2)
    subject_scaled = subject_crop.resize((fw, fh), Image.LANCZOS)
    fg = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    fg.paste(subject_scaled, pos, subject_scaled)
    fg.save(assets / "android-icon-foreground.png")

    # --- android monochrome: solid white silhouette, same placement ---
    mono = Image.new("RGBA", (OUT, OUT), (0, 0, 0, 0))
    white = Image.new("RGBA", (fw, fh), (255, 255, 255, 255))
    mono_mask = (
        Image.fromarray((solid * 255).astype(np.uint8), "L")
        .crop(bbox)
        .resize((fw, fh), Image.LANCZOS)
    )
    mono.paste(white, pos, mono_mask)
    mono.save(assets / "android-icon-monochrome.png")

    # --- favicon: match existing favicon dimensions if present ---
    try:
        fav_size = Image.open(assets / "favicon.png").size
    except Exception:
        fav_size = (48, 48)
    src.resize(fav_size, Image.LANCZOS).save(assets / "favicon.png")

    # --- preview contact sheet ---
    P = 256
    sheet = Image.new("RGB", (P * 4 + 50, P + 20), (40, 40, 40))

    def circle_crop(img1024):
        visible = round(72 / 108 * OUT)  # launcher-visible region
        off = (OUT - visible) // 2
        c = img1024.crop((off, off, off + visible, off + visible)).resize(
            (P, P), Image.LANCZOS
        )
        m = Image.new("L", (P, P), 0)
        ImageDraw.Draw(m).ellipse((0, 0, P - 1, P - 1), fill=255)
        out = Image.new("RGBA", (P, P), (0, 0, 0, 0))
        out.paste(c, (0, 0), m)
        return out

    sheet.paste(src.resize((P, P), Image.LANCZOS), (10, 10))
    adaptive = Image.alpha_composite(
        Image.fromarray(bg_out, "RGB").convert("RGBA"), fg
    )
    ac = circle_crop(adaptive)
    sheet.paste(ac, (P + 20, 10), ac)
    themed = Image.new("RGBA", (OUT, OUT), (30, 30, 30, 255))
    tinted = Image.new("RGBA", (OUT, OUT), (170, 200, 255, 255))
    themed.paste(tinted, (0, 0), mono.getchannel("A"))
    tc = circle_crop(themed)
    sheet.paste(tc, (P * 2 + 30, 10), tc)
    checker = Image.new("RGB", (P, P), (255, 255, 255))
    d = ImageDraw.Draw(checker)
    for gy in range(0, P, 16):
        for gx in range(0, P, 16):
            if (gx // 16 + gy // 16) % 2:
                d.rectangle((gx, gy, gx + 15, gy + 15), fill=(200, 200, 200))
    fg_small = fg.resize((P, P), Image.LANCZOS)
    checker.paste(fg_small, (0, 0), fg_small)
    sheet.paste(checker, (P * 3 + 40, 10))
    sheet.save("/tmp/icon_preview.png")
    print(f"icons written to {assets}/, preview at /tmp/icon_preview.png")


if __name__ == "__main__":
    main()
