/**
 * The Site stage (docs/design/desk-writeup.md): the long
 * video as an article for the studio site's dev log. Claude drafts it from
 * the long cut in Tom's voice (nothing about watching, subscribing, the
 * screen), Tom edits the words here, pastes the video's link once it's up,
 * and Save to the site writes the markdown and the chosen thumbnail as its
 * cover into the site's content folder for him to commit. Render builds it.
 * The pictures go in as the video shows them, glyphs and glow, not the
 * stills they were made from: the page draws each one with the real engine
 * (glyphStill, thumbStill) and sends it up just before the save.
 */
import { useEffect, useState } from "react";
import type { GameApi, Script } from "./api";
import { Markdown } from "./markdown";
import { GlyphPicture, type Palette, glyphStill } from "./Pictures";
import { thumbStill } from "./Thumbnails";

import { type Writeup, articlePictures, slugify, youtubeId } from "../lib/scripts";

type Busy = "" | string;

/** A thumbnail picture as the cover will be saved: glyphs, full bleed, no words. */
const CoverStill: React.FC<{ api: GameApi; src: string; height?: number }> = ({ api, src: picture, height = 72 }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    setSrc(null);
    void thumbStill(api.publicUrl(picture), "", "red")
      .then((blob) => {
        made = URL.createObjectURL(blob);
        if (live) setSrc(made);
        else URL.revokeObjectURL(made);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [api, picture]);
  return src ? <img src={src} alt="" style={{ height, borderRadius: 4, display: "block" }} /> : <span className="small muted" style={{ display: "inline-block", height, lineHeight: `${height}px` }}>drawing…</span>;
};

export const WriteupStep: React.FC<{
  s: Script;
  api: GameApi;
  claude: boolean;
  palette: Palette;
  busy: Busy;
  onChange: (w: Writeup) => void;
  onWrite: (instruction: string) => void;
  /** `prepare` draws and sends the glyph stills; the save runs after it. */
  onSave: (prepare: () => Promise<void>) => void;
}> = ({ s, api, claude, palette, busy, onChange, onWrite, onSave }) => {
  const [ask, setAsk] = useState("");
  const [preview, setPreview] = useState(false);
  const [link, setLink] = useState("");
  const [drawing, setDrawing] = useState("");
  const [dating, setDating] = useState(false);
  // The video's publish date off YouTube, into the date field (the dev log orders by it).
  const dateFrom = (video: string) => {
    setDating(true);
    void api
      .videoDate(s.id, video)
      .then((r) => r.date && onChange({ ...(w as Writeup), youtube: video, date: r.date }))
      .catch(() => {})
      .finally(() => setDating(false));
  };
  const w = s.writeup;
  const write = () => {
    onWrite(ask);
    setAsk("");
  };
  const set = (p: Partial<Writeup>) => w && onChange({ ...w, ...p });
  // The cover: any thumbnail try, Tom's pick or the chosen thumbnail's picture, drawn with no words.
  const tries = [...new Set((s.thumbnails ?? []).flatMap((t) => t.candidates))];
  const cover = w?.cover && tries.includes(w.cover) ? w.cover : (s.thumbnails ?? []).find((t) => t.chosen)?.chosen;
  const pictureOf = (beat: string) => s.long?.beats.find((b) => b.id === beat)?.pictures?.find((p) => p.chosen);
  // Draw every picture the article uses (and the cover) as glyphs with the real engine and send them up, then save.
  const save = () =>
    onSave(async () => {
      if (!w) return;
      const list = articlePictures(s, w.body);
      for (const [n, p] of list.entries()) {
        setDrawing(`drawing picture ${n + 1} of ${list.length}…`);
        await api.siteStill(s.id, p.beat, await glyphStill(api.publicUrl(p.src), pictureOf(p.beat)?.look ?? 1, palette));
      }
      if (cover) {
        setDrawing("drawing the cover…");
        await api.siteStill(s.id, "cover", await thumbStill(api.publicUrl(cover), "", "red"));
      }
      setDrawing("");
    });
  const words = w ? w.body.split(/\s+/).filter(Boolean).length : 0;
  const headings = w ? w.body.split("\n").filter((l) => /^##\s+\S/.test(l)).length : 0;
  const pics = w ? articlePictures(s, w.body) : [];
  const unsaved = w?.saved && w.saved.at < w.writtenAt;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row between" style={{ flexWrap: "wrap", gap: 8 }}>
        <h4 style={{ margin: 0 }}>The write-up for the dev log on the site</h4>
        {w?.saved ? (
          <span className="small muted" title={w.saved.file}>
            on the site as /log/{w.slug}/ · saved {w.saved.at.slice(0, 16).replace("T", " ")}
          </span>
        ) : null}
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <button onClick={write} disabled={!claude || Boolean(busy)} title="Claude turns the long cut into an article in your voice: every point kept, nothing about watching or the channel, headings from the chapters">
          {busy === "writeup" ? "writing…" : w ? "Write it again" : "Write the article"}
        </button>
        <input type="text" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && claude && !busy && write()} placeholder='Steer it, or leave blank: "shorter", "keep the bit about the netcode"…' style={{ flex: 1, minWidth: 220, maxWidth: 460 }} />
      </div>
      {!w ? (
        <div className="small muted">Claude writes the video up as an article for the dev log on the site: the same words, written rather than spoken, with the video at the top of the page. It gives Google something to read and sends people who search for the game across to the site.</div>
      ) : (
        <>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
            <label className="stack" style={{ gap: 4, flex: 2, minWidth: 240 }}>
              <span className="row between small">
                <strong>Title</strong>
                <span className={w.title.length > 70 ? "warn" : "muted"}>{w.title.length}/70</span>
              </span>
              <input type="text" value={w.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
            <label className="stack" style={{ gap: 4, flex: 1, minWidth: 200 }}>
              <span className="small">
                <strong>The URL</strong> <span className="muted">/log/{slugify(w.slug) || "…"}/</span>
              </span>
              <input type="text" value={w.slug} onChange={(e) => set({ slug: e.target.value })} onBlur={() => set({ slug: slugify(w.slug) })} />
            </label>
          </div>
          <label className="stack" style={{ gap: 4 }}>
            <span className="row between small">
              <strong>Description</strong>
              <span className={w.description.length > 160 ? "warn" : "muted"}>{w.description.length}/160 (the listing, the search snippet, the social card)</span>
            </span>
            <textarea rows={2} value={w.description} onChange={(e) => set({ description: e.target.value })} />
          </label>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <strong className="small">Dated</strong>
            <input type="date" value={w.date ?? ""} onChange={(e) => set({ date: e.target.value || undefined })} title="The post's date, which the dev log orders by: the video's publish date once its link is pasted, or the day it's first saved" />
            {dating ? <span className="small muted">asking YouTube…</span> : w.youtube ? (
              <button className="link small" onClick={() => dateFrom(w.youtube!)} title="Read the publish date off the video's page again">
                from the video
              </button>
            ) : (
              <span className="small muted">{w.date ? "" : w.saved ? `the first save's, ${w.saved.date}` : "blank = the day it's first saved; pasting the video's link fills it in"}</span>
            )}
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <strong className="small">The video</strong>
            {w.youtube ? (
              <span className="row small" style={{ gap: 8 }}>
                <a href={`https://www.youtube.com/watch?v=${w.youtube}`} target="_blank" rel="noopener">
                  youtube.com/watch?v={w.youtube}
                </a>
                <button className="link small" onClick={() => set({ youtube: undefined })}>
                  clear
                </button>
              </span>
            ) : (
              <input
                type="text"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  const id = youtubeId(e.target.value);
                  if (id) {
                    set({ youtube: id });
                    setLink("");
                    dateFrom(id);
                  }
                }}
                placeholder="Paste the YouTube link once it's up: the page gets the player"
                style={{ flex: 1, minWidth: 260, maxWidth: 460 }}
              />
            )}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <strong className="small">The cover</strong>
              {cover ? (
                <>
                  <CoverStill api={api} src={cover} />
                  <span className="small muted">as glyphs with no words: the page's poster and social card{w.cover ? "" : " (the chosen thumbnail's picture; pick another below)"}</span>
                </>
              ) : (
                <span className="small muted">no thumbnail pictures yet (make some on Publish), so the page shows a plain plate (nothing is fetched from YouTube before play)</span>
              )}
            </div>
            {tries.length > 1 ? (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {tries.map((src) => (
                  <button key={src} className={`link${src === cover ? " on" : ""}`} style={{ padding: 2, border: src === cover ? "2px solid var(--sand)" : "2px solid transparent", borderRadius: 6, background: "none" }} onClick={() => set({ cover: src })} title={src === cover ? "the cover" : "use this picture as the cover"}>
                    <CoverStill api={api} src={src} height={54} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="stack" style={{ gap: 4 }}>
            <div className="row between small">
              <strong>The article</strong>
              <span className="row" style={{ gap: 10 }}>
                <span className="muted">
                  {words} words · {headings ? `${headings} heading${headings === 1 ? "" : "s"}, ${pics.length === headings ? "a picture under each" : `pictures under ${pics.length} of them`}` : "no headings, so no pictures"}
                </span>
                <button className="link small" onClick={() => setPreview(!preview)}>
                  {preview ? "edit" : "preview"}
                </button>
              </span>
            </div>
            {preview ? <Markdown text={w.body} className="panel" /> : <textarea rows={22} value={w.body} onChange={(e) => set({ body: e.target.value })} style={{ fontFamily: "inherit", lineHeight: 1.5 }} />}
          </div>
          {pics.length ? (
            <div className="stack" style={{ gap: 6 }}>
              <strong className="small">The pictures, as glyphs, one under each heading</strong>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                {pics.map((p) => (
                  <div key={p.beat} className="stack" style={{ gap: 2, width: 200 }} title={p.alt}>
                    <GlyphPicture url={api.publicUrl(p.src)} look={pictureOf(p.beat)?.look ?? 1} palette={palette} />
                    <span className="small muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      under "{p.heading}"
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={save} disabled={Boolean(busy) || !w.title.trim() || !w.body.trim()} title="Draws the pictures as glyphs, then writes the markdown, the pictures and the cover into the site's content folder. Then commit and push: Render builds the page.">
              {busy === "writeup-save" ? drawing || "saving…" : w.saved ? "Save to the site again" : "Save to the site"}
            </button>
            {w.saved ? (
              <span className="small muted">
                {unsaved ? "written again since it was saved. " : ""}
                {w.saved.file}
                {w.saved.cover ? ` + ${w.saved.cover}` : ""} · commit and push, and Render builds it{w.youtube ? "" : " (no video on the page until you paste the link and save again)"}
              </span>
            ) : (
              <span className="small muted">nothing on the site yet</span>
            )}
          </div>
        </>
      )}
    </div>
  );
};
