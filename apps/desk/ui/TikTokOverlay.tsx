/**
 * A mock of TikTok's in-feed UI laid over the vertical preview, so the Desk
 * shows what the app will cover once the video is posted: the Following /
 * For You bar across the top, the button rail down the right, the caption
 * block at the bottom. Preview only — it never reaches a render. Sized in
 * container units off the frame's width, so it scales with the Player.
 * Positions are fractions of a 1080×1920 frame as TikTok draws it on a
 * current iPhone; the app shifts a little between phones and versions.
 */
import type * as React from "react";

const shade = "rgba(0,0,0,0.38)";
const ink = "rgba(255,255,255,0.92)";

const Rail: React.FC = () => (
  <div style={{ position: "absolute", right: "2.5cqw", bottom: "19%", display: "flex", flexDirection: "column", alignItems: "center", gap: "4.5cqw" }}>
    <div style={{ width: "11cqw", height: "11cqw", borderRadius: "50%", background: "rgba(255,255,255,0.35)", border: "0.5cqw solid white" }} />
    {["♥", "💬", "🔖", "↪"].map((g, i) => (
      <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.8cqw" }}>
        <div style={{ fontSize: "8cqw", lineHeight: 1, color: ink, textShadow: "0 0 2cqw rgba(0,0,0,0.6)" }}>{g}</div>
        <div style={{ fontSize: "2.8cqw", fontWeight: 700, color: ink }}>{["12.4K", "318", "902", "1.1K"][i]}</div>
      </div>
    ))}
    <div style={{ width: "10cqw", height: "10cqw", borderRadius: "50%", background: "radial-gradient(circle, #555 20%, #111 22%)", border: "1.5cqw solid #222" }} />
  </div>
);

export const TikTokOverlay: React.FC = () => (
  <div style={{ position: "absolute", inset: 0, pointerEvents: "none", fontFamily: "-apple-system, system-ui, sans-serif", overflow: "hidden" }}>
    {/* Top bar: status strip + LIVE · Following · For You · search. */}
    <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "10%", background: `linear-gradient(${shade}, rgba(0,0,0,0.15))` }}>
      <div style={{ position: "absolute", top: "1.4%", left: "7cqw", right: "7cqw", display: "flex", justifyContent: "space-between", fontSize: "3.4cqw", fontWeight: 700, color: ink }}>
        <span>9:41</span>
        <span>▮▮▮ ◠ ▭</span>
      </div>
      <div style={{ position: "absolute", bottom: "18%", left: 0, right: 0, display: "flex", justifyContent: "center", alignItems: "flex-end", gap: "5cqw", fontSize: "4.4cqw", fontWeight: 700 }}>
        <span style={{ position: "absolute", left: "4cqw", fontSize: "3.4cqw", color: ink }}>LIVE</span>
        <span style={{ color: "rgba(255,255,255,0.6)" }}>Following</span>
        <span style={{ color: "white", borderBottom: "0.6cqw solid white", paddingBottom: "0.6cqw" }}>For You</span>
        <span style={{ position: "absolute", right: "4cqw", fontSize: "5cqw", color: ink }}>⌕</span>
      </div>
    </div>
    <Rail />
    {/* Caption block: handle, caption, sound. */}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "22%", background: `linear-gradient(rgba(0,0,0,0), ${shade})` }}>
      <div style={{ position: "absolute", left: "3.5cqw", right: "22cqw", bottom: "22%", display: "flex", flexDirection: "column", gap: "1.4cqw", color: ink }}>
        <div style={{ fontSize: "4cqw", fontWeight: 700 }}>@freetheborough</div>
        <div style={{ fontSize: "3.5cqw", lineHeight: 1.3 }}>Your caption sits here, over the bottom of the clip… more</div>
        <div style={{ fontSize: "3.2cqw" }}>♫ original sound</div>
      </div>
    </div>
  </div>
);
