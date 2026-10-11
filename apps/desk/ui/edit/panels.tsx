/**
 * The inspector's panels, down the editor's right side: what's selected (a
 * video clip's framing, shave and sound; an audio clip's level), the voice
 * (mic, tidy, noise, level) and captions, the music bed, the script, the
 * edit's name and note. The mic itself lives in Editor.tsx; the Voice panel
 * is handed its meter.
 */
import type * as React from "react";
import { type AudioClip, type Box, type CaptionStyle, type Card, type Clip, type Music, NOISE_LEVELS, type Sequence, type Timed, boxAspect, cropBox, fitBox, frameBox, stackBox, stackRegions, stackedKey } from "@heroic/voiceover";
import type { GameApi, GameInfo, Script, ScriptSummary, WhisperStatus } from "../api";
import type { MicDevice } from "../mic";
import { fmtSeconds } from "../api";
import { go } from "../App";
import { ScriptReading } from "../Scripts";
import { Framer, sizeBox, stem } from "./widgets";

export const VideoClipPanel: React.FC<{
  game: GameInfo;
  api: GameApi;
  seq: Sequence;
  track: number;
  clip: Clip;
  timed: Timed | undefined;
  prev: Clip | undefined;
  shape: string;
  /** The clip shares the frame with another track for some of its run. */
  stackable: boolean;
  frameMode: "alone" | "stacked";
  locked: boolean;
  onFrameMode: (m: "alone" | "stacked") => void;
  onCheckpoint: () => void;
  onPatch: (patch: Partial<Clip>, undoable?: boolean) => void;
  onPatchAll: (patch: (c: Clip) => Partial<Clip>) => void;
}> = ({ game, api, seq, track, clip, timed, prev, shape, stackable, frameMode, locked, onFrameMode, onCheckpoint, onPatch, onPatchAll }) => {
  const prefix = `${game.footagePublic}/`;
  const file = clip.src.startsWith(prefix) ? clip.src.slice(prefix.length) : clip.src;
  const size = game.formats[shape] ?? { width: 1080, height: 1920, label: "" };
  const frameAspect = size.width / size.height;
  const regions = stackRegions(frameAspect);
  const regionAspect = (r: Box) => (r.w * size.width) / (r.h * size.height);
  const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const stacked = stackable && frameMode === "stacked";
  const frameKey = stacked ? stackedKey(shape) : shape;
  // Stacked, a clip on the bottom track takes the main half, one on an upper track the other.
  const want = stacked ? regionAspect(track === 0 ? regions.main : regions.over) : frameAspect;
  const framed = stacked ? stackBox(clip, shape, want) : frameBox(clip, shape, want);
  const framedSet = Boolean(clip.frames?.[frameKey]);
  const cropTop = crop.y;
  const cropBottom = Math.max(0, 1 - crop.y - crop.h);
  const others = seq.video.some((t) => t.clips.some((c) => c.id !== clip.id && c.src === clip.src));
  const reframes = Boolean(!stacked && prev && timed?.arrive === "continue" && !sameBoxish(frameBox(prev, shape, want), framed));
  return (
    <>
      <div className="small muted">
        <b>{stem(file)}</b> · {fmtSeconds(clip.start)} → {fmtSeconds(clip.end)} of the recording · at {fmtSeconds(clip.at)} on V{track + 1}
      </div>
      {timed ? (
        <div className="small muted">
          {timed.arrive === "first" ? "The first clip on its track." : timed.arrive === "slide" ? `Slides in over the clip before (${timed.overlap.toFixed(2)}s: as long as they overlap).` : timed.arrive === "cut" ? "A hard cut from the clip before (they touch). Drag it over the clip before for a slide." : timed.arrive === "continue" ? `Carries straight on from the clip before (same recording, nothing taken out between)${reframes ? "; framed differently, so the camera glides" : ""}.` : "After a gap: the track below shows through until it starts."}
        </div>
      ) : null}
      {stackable ? (
        <div className="row" style={{ gap: 6 }}>
          <span className="small muted">Framing</span>
          {(["alone", "stacked"] as const).map((m) => (
            <button key={m} className={`small ${frameMode === m ? "" : "ghost"}`} onClick={() => onFrameMode(m)} title={m === "alone" ? "While it fills the frame on its own" : "While another track plays with it and it has half the frame"}>
              {m === "alone" ? "on its own" : "when stacked"}
            </button>
          ))}
        </div>
      ) : null}
      <div className="field">
        <label title="Drag the window to move it; turn the scroll wheel over it to zoom. Each shape (vertical, square, landscape) has its own: switch shape above the preview.">
          Framing for {shape}
          {stacked ? ", stacked" : ""} {framedSet ? "" : <span className="muted">(not set: {stacked ? "the middle, filling its half" : boxAspect(crop, clip.aspect) > 1 && want < 1 ? "the middle of the picture" : "the whole picture"})</span>}
        </label>
        <Framer img={api.clipThumb(file, Math.min(clip.sourceSeconds - 0.05, clip.start + Math.min(1, (clip.end - clip.start) / 2)))} aspect={clip.aspect} box={framed} set={framedSet} want={want} disabled={locked} onStart={onCheckpoint} onChange={(b) => onPatch({ frames: { ...clip.frames, [frameKey]: b } }, false)} />
        <div className="row" style={{ gap: 8 }}>
          <span className="small muted">zoom</span>
          <input
            type="range"
            min={0.15}
            max={1}
            step={0.01}
            value={Math.abs(boxAspect(framed, clip.aspect) - want) < 0.01 ? framed.h : fitBox(framed, clip.aspect, want).h}
            disabled={locked}
            style={{ flex: 1, direction: "rtl" }}
            onPointerDown={onCheckpoint}
            onChange={(e) => {
              const b = Math.abs(boxAspect(framed, clip.aspect) - want) < 0.01 ? framed : fitBox(framed, clip.aspect, want);
              onPatch({ frames: { ...clip.frames, [frameKey]: sizeBox(b, Number(e.target.value), clip.aspect, want) } }, false);
            }}
          />
          {framedSet ? (
            <button
              className="small ghost"
              disabled={locked}
              onClick={() => {
                const { [frameKey]: _gone, ...rest } = clip.frames ?? {};
                onPatch({ frames: Object.keys(rest).length ? rest : undefined });
              }}
            >
              Reset
            </button>
          ) : null}
        </div>
        {others && framedSet ? (
          <div>
            <button className="small ghost" disabled={locked} onClick={() => onPatchAll((c) => ({ frames: { ...c.frames, [frameKey]: clip.frames![frameKey]! } }))}>
              Same framing on every clip from this recording
            </button>
          </div>
        ) : null}
        {!stacked ? <div className="hint">To pan, split the clip where the view should move and frame the second half somewhere else: the camera glides between them.</div> : null}
      </div>
      <div className="field">
        <label>Shave the top (status bar) · {(cropTop * 100).toFixed(1)}%</label>
        <input type="range" min={0} max={0.2} step={0.005} value={cropTop} disabled={locked} onPointerDown={onCheckpoint} onChange={(e) => onPatch({ crop: cropBox(Number(e.target.value), cropBottom) }, false)} />
      </div>
      <div className="field">
        <label>Shave the bottom (nav bar) · {(cropBottom * 100).toFixed(1)}%</label>
        <input type="range" min={0} max={0.2} step={0.005} value={cropBottom} disabled={locked} onPointerDown={onCheckpoint} onChange={(e) => onPatch({ crop: cropBox(cropTop, Number(e.target.value)) }, false)} />
      </div>
      {others ? (
        <div>
          <button className="small ghost" disabled={locked} onClick={() => onPatchAll(() => ({ crop: clip.crop }))}>
            Same shave on every clip from this recording
          </button>
        </div>
      ) : null}
      <div className="row">
        <div className="field inline">
          <input id="clip-muted" type="checkbox" checked={Boolean(clip.muted)} disabled={locked} onChange={(e) => onPatch({ muted: e.target.checked })} />
          <label htmlFor="clip-muted">Silence this clip</label>
        </div>
        {!clip.muted ? (
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Its sound · {Math.round((clip.volume ?? 1) * 100)}%</label>
            <input type="range" min={0} max={1.5} step={0.05} value={clip.volume ?? 1} disabled={locked} onPointerDown={onCheckpoint} onChange={(e) => onPatch({ volume: Number(e.target.value) }, false)} />
          </div>
        ) : null}
      </div>
    </>
  );
};
const sameBoxish = (a: Box, b: Box) => Math.abs(a.x - b.x) < 1e-4 && Math.abs(a.y - b.y) < 1e-4 && Math.abs(a.w - b.w) < 1e-4 && Math.abs(a.h - b.h) < 1e-4;

export const AudioClipPanel: React.FC<{
  seq: Sequence;
  track: number;
  clip: AudioClip;
  locked: boolean;
  whisperReady: boolean;
  onCheckpoint: () => void;
  onPatch: (patch: Partial<AudioClip>, undoable?: boolean) => void;
  onAgain: (take: number) => void;
}> = ({ seq, track, clip, locked, whisperReady, onCheckpoint, onPatch, onAgain }) => {
  const take = seq.takes[clip.take];
  const tr = seq.audio[track];
  return (
    <>
      <div className="small muted">
        Take {clip.take + 1}
        {take ? ` (${fmtSeconds(take.seconds)}, ${take.recordedAt.slice(0, 16).replace("T", " ")})` : ""} · {fmtSeconds(clip.start)} → {fmtSeconds(clip.end)} of it · at {fmtSeconds(clip.at)} on A{track + 1}
        {tr?.muted ? " · the whole track is silent" : ""}
      </div>
      <div className="row">
        <div className="field inline">
          <input id="aclip-muted" type="checkbox" checked={Boolean(clip.muted)} disabled={locked} onChange={(e) => onPatch({ muted: e.target.checked })} />
          <label htmlFor="aclip-muted">Silence this clip</label>
        </div>
        {!clip.muted ? (
          <div className="field" style={{ flex: 1, minWidth: 160 }}>
            <label>Its level · {Math.round((clip.volume ?? 1) * 100)}%</label>
            <input type="range" min={0} max={1.5} step={0.05} value={clip.volume ?? 1} disabled={locked} onPointerDown={onCheckpoint} onChange={(e) => onPatch({ volume: Number(e.target.value) }, false)} />
          </div>
        ) : null}
      </div>
      {take && whisperReady ? (
        <div>
          <button className="small ghost" disabled={locked} onClick={() => onAgain(clip.take)} title="Runs Whisper over this take again. Words you've fixed are kept if it hears the same number of words.">
            Listen to this take again
          </button>
        </div>
      ) : null}
      {take && !take.words.length && take.transcribed ? <div className="small muted">Whisper heard no words in this take.</div> : null}
    </>
  );
};

export const MusicPanel: React.FC<{ music: Music | undefined; songs: { value: string; label: string }[]; locked: boolean; onChange: (m: Music | undefined) => void; onCheckpoint: () => void }> = ({ music, songs, locked, onChange, onCheckpoint }) => (
  <div className="stack" id="music-panel">
    <div className="field">
      <label title="One song under the whole edit. It ducks while you talk. Every video made from this edit plays it; Make's own music fields are hidden when the edit has one.">Song</label>
      <select value={music?.song ?? ""} disabled={locked} onChange={(e) => onChange(e.target.value ? { song: e.target.value, from: music?.from ?? 0, level: music?.level ?? 0.8 } : undefined)}>
        <option value="">none (Make can still add one per video)</option>
        {songs.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
    {music ? (
      <>
        <div className="field">
          <label title="The songs build: the heavy part is usually 60s or more in">Start the song from (s) · {fmtSeconds(music.from)}</label>
          <input type="number" min={0} step={1} value={music.from} disabled={locked} onChange={(e) => onChange({ ...music, from: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
        <div className="field">
          <label>Level · {Math.round(music.level * 100)}%</label>
          <input type="range" min={0} max={1} step={0.05} value={music.level} disabled={locked} onPointerDown={onCheckpoint} onChange={(e) => onChange({ ...music, level: Number(e.target.value) })} />
        </div>
      </>
    ) : (
      <div className="small muted">Record with the game's battle music off and lay a song here instead.</div>
    )}
  </div>
);

/**
 * The script: the one (Scripts tab) this edit is making, read while
 * recording. Pick one from the scripts not made yet; its long cut (or
 * its source, before a rewrite) sits here, big enough to read from
 * across the desk. Tick it once the video's made.
 */
export const ScriptPanel: React.FC<{ scripts: ScriptSummary[]; script: Script | null; idea: string; locked: boolean; onPick: (id: string) => void; onTick: (id: string, done: boolean) => void }> = ({ scripts, script, idea, locked, onPick, onTick }) => {
  const current = scripts.find((i) => i.id === idea);
  const choices = scripts.filter((i) => !i.done || i.id === idea);
  return (
    <div className="stack script">
      <div className="row between">
        <select value={current ? idea : ""} disabled={locked} onChange={(e) => onPick(e.target.value)} style={{ width: "auto", maxWidth: 260 }} title="The script this edit is making: read it while you record.">
          <option value="">{scripts.length ? "no script picked" : "no scripts yet"}</option>
          {choices.map((i) => (
            <option key={i.id} value={i.id}>
              {i.done ? "✓ " : ""}
              {i.title}
            </option>
          ))}
        </select>
      </div>
      {current ? (
        <>
          <div className={`title ${current.done ? "done" : ""}`}>{current.title}</div>
          {script ? <ScriptReading s={script} /> : <div className="small muted">loading…</div>}
          <div className="row small muted" style={{ gap: 14 }}>
            <button className="link small" onClick={() => go({ name: "scripts", id: current.id })}>
              Open it on Scripts
            </button>
            <button className="link small" disabled={locked} onClick={() => onTick(current.id, !current.done)}>
              {current.done ? "Not made after all" : "Tick it off: made"}
            </button>
          </div>
        </>
      ) : idea && scripts.length ? (
        <div className="small muted">The script this edit was making has been deleted. Pick another, or leave it.</div>
      ) : (
        <div className="small muted">Pick the script this video is making and it shows here to read from while you record. Scripts live on the Scripts tab.</div>
      )}
    </div>
  );
};

/** The mic and how the takes sound: for every audio clip in the edit. */
export const VoicePanel: React.FC<{
  seq: Sequence;
  locked: boolean;
  recording: boolean;
  micOn: boolean;
  mics: MicDevice[];
  device: string;
  meter: React.RefObject<HTMLDivElement | null>;
  meterText: React.RefObject<HTMLSpanElement | null>;
  clipSound: boolean;
  onClipSound: (on: boolean) => void;
  onMic: (device?: string) => void;
  onSound: (want: { tidy?: boolean; denoise?: number }) => void;
  onVoice: (patch: Partial<Sequence["voice"]>, undoable?: boolean) => void;
  onCheckpoint: () => void;
  onAudioFile: (f: File) => void;
  onBackup: () => void;
}> = ({ seq, locked, recording, micOn, mics, device, meter, meterText, clipSound, onClipSound, onMic, onSound, onVoice, onCheckpoint, onAudioFile, onBackup }) => (
  <div className="stack">
    <div className="field">
      <label>Microphone</label>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        {micOn ? (
          <select value={device} style={{ flex: 1, minWidth: 0 }} disabled={locked} onChange={(e) => onMic(e.target.value)}>
            {mics.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        ) : (
          <button className="ghost small" onClick={() => onMic()}>
            Turn the mic on
          </button>
        )}
      </div>
      <div className="row" style={{ flexWrap: "nowrap" }}>
        <div className="meter" title="Talk normally: aim for the bar to sit in the green and touch amber on loud words. Red is too hot: back off the mic or turn its gain down.">
          <div ref={meter} />
        </div>
        <span ref={meterText} className="small muted mono" style={{ width: 56, flexShrink: 0 }}>
          {micOn ? "" : "mic off"}
        </span>
      </div>
    </div>
    <div className="field inline">
      <input id="edit-clip-sound" type="checkbox" checked={clipSound} disabled={locked} onChange={(e) => onClipSound(e.target.checked)} />
      <label htmlFor="edit-clip-sound" title="Off: the footage is silent on this screen, and nothing at all plays while you record. On: you hear the footage and your earlier takes while you record, so wear headphones or the mic hears them too. This screen only: it changes nothing in the edit or the video.">
        Play the footage's own sound here <span className="muted">(while recording too: headphones on)</span>
      </label>
    </div>
    <div className="field inline">
      <input id="edit-tidy" type="checkbox" checked={seq.voice.tidy} disabled={locked} onChange={(e) => onSound({ tidy: e.target.checked })} />
      <label htmlFor="edit-tidy" title="Takes out the rumble below your voice and brings every take to the same loudness. The untouched recording is kept, so this can be flipped later.">
        Tidy the sound
      </label>
    </div>
    <div className="field">
      <label title="Turns down what's in the room when you're not speaking: hum, rumble, hiss, a fan. Your voice is left as it is. Learnt from the pauses in each take. The untouched recording is kept, so try each and listen.">Background noise</label>
      <div className="row" style={{ gap: 6 }}>
        {NOISE_LEVELS.map((n) => (
          <button key={n.level} className={`small ${(seq.voice.denoise ?? 0) === n.level ? "" : "ghost"}`} disabled={locked} onClick={() => onSound({ denoise: n.level })} title={n.level ? `Cuts the rumble, and turns the rest of the room down by ${n.reduce} dB` : "The takes as they are"}>
            {n.level ? `${n.label}` : "Leave it"}
          </button>
        ))}
      </div>
    </div>
    <div className="field">
      <label htmlFor="edit-volume" title="How loud your voice is against the footage and the music, in every video made from this edit. A video can turn it down further (voiceVolume in Make).">
        Voice level · {Math.round((seq.voice.volume ?? 1) * 100)}%{(seq.voice.volume ?? 1) < 1 ? ` (${(20 * Math.log10(seq.voice.volume ?? 1)).toFixed(1)} dB)` : ""}
      </label>
      <input id="edit-volume" type="range" min={0.1} max={1} step={0.05} value={seq.voice.volume ?? 1} disabled={recording} onPointerDown={onCheckpoint} onChange={(e) => onVoice({ volume: Number(e.target.value) })} />
    </div>
    <div className="row small muted" style={{ gap: 14 }}>
      <label style={{ cursor: locked ? "default" : "pointer" }}>
        <span style={{ textDecoration: "underline" }}>Add a recording from a file</span>
        <input
          type="file"
          accept="audio/*,.wav,.m4a,.mp3,.aiff,.aif"
          disabled={locked}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onAudioFile(f);
          }}
        />
      </label>
      {seq.takes.length ? (
        <button className="link small" disabled={locked} onClick={onBackup} title="The recordings only exist on this Mac until you do">
          Back the takes up to Drive
        </button>
      ) : null}
    </div>
  </div>
);

/** How the words show: this screen's caption style, the nudge, Whisper's state. */
export const CaptionsPanel: React.FC<{
  seq: Sequence;
  style: CaptionStyle;
  overlay: boolean;
  whisper: WhisperStatus | null;
  locked: boolean;
  pickedTake: number | undefined;
  onStyle: (s: CaptionStyle) => void;
  onOverlay: (on: boolean) => void;
  onVoice: (patch: Partial<Sequence["voice"]>, undoable?: boolean) => void;
  onInstallWhisper: () => void;
  onAgain: (take: number) => void;
}> = ({ seq, style, overlay, whisper, locked, pickedTake, onStyle, onOverlay, onVoice, onInstallWhisper, onAgain }) => (
  <div className="stack">
    <div className="field">
      <label>Captions on this screen</label>
      <div className="row" style={{ gap: 6 }}>
        {(["tiktok", "regular", "off"] as CaptionStyle[]).map((s) => (
          <button key={s} className={`small ${style === s ? "" : "ghost"}`} onClick={() => onStyle(s)}>
            {s === "tiktok" ? "TikTok style" : s === "regular" ? "Regular" : "Off"}
          </button>
        ))}
      </div>
      <div className="hint">For the preview. Each video picks its own in Make.</div>
    </div>
    {whisper && !whisper.ready ? (
      <div className="small warn">
        {whisper.installing ? (
          <>Setting Whisper up: {whisper.step === "downloading" ? `downloading the model, ${Math.round((whisper.progress ?? 0) * 100)}%` : "building it (a minute or two)"}…</>
        ) : (
          <>
            Captions need Whisper, which isn't set up on this Mac yet (a one-off 1.6 GB download; needs <code>brew install cmake</code>).{" "}
            <button className="small ghost" onClick={onInstallWhisper}>
              Set it up
            </button>
            {whisper.error ? <div>✖ {whisper.error}</div> : null}
          </>
        )}
      </div>
    ) : null}
    <div className="field" style={{ width: 140 }}>
      <label title="Shifts every caption later (+) or earlier (−)">Nudge (ms)</label>
      <input type="number" step={10} value={seq.voice.captionNudgeMs} onChange={(e) => onVoice({ captionNudgeMs: Math.max(-1000, Math.min(1000, Number(e.target.value) || 0)) }, true)} />
    </div>
    <div className="field inline">
      <input id="edit-overlay" type="checkbox" checked={overlay} onChange={(e) => onOverlay(e.target.checked)} />
      <label htmlFor="edit-overlay">Show what TikTok covers</label>
    </div>
    {pickedTake !== undefined && whisper?.ready ? (
      <div>
        <button className="small ghost" disabled={locked} onClick={() => onAgain(pickedTake)} title="Runs Whisper over the selected take again. Words you've fixed are kept if it hears the same number of words.">
          Listen to this take again
        </button>
      </div>
    ) : null}
  </div>
);

/** The edit itself: its name, a note, the slide length, the bin. */
export const EditPanel: React.FC<{ name: string; note: string; slide: number; locked: boolean; onName: (s: string) => void; onNote: (s: string) => void; onSlide: (s: number) => void; onBin: () => void }> = ({ name, note, slide, locked, onName, onNote, onSlide, onBin }) => (
  <div className="stack">
    <div className="field">
      <label>Name</label>
      <input type="text" value={name} disabled={locked} onChange={(e) => onName(e.target.value)} />
    </div>
    <div className="field">
      <label>Note (what happens in it, for you)</label>
      <textarea value={note} disabled={locked} style={{ minHeight: 60 }} onChange={(e) => onNote(e.target.value)} />
    </div>
    <div className="field" style={{ width: 120 }}>
      <label title="How far a recording added from the library overlaps the clip before it when the playhead is past the end of the track (a slide lasts as long as the overlap), and a snap point when you drag a clip up to another">Slide (s)</label>
      <input type="number" step={0.1} min={0.1} max={2} value={slide} disabled={locked} onChange={(e) => onSlide(Math.max(0.1, Math.min(2, Number(e.target.value) || 0.4)))} />
    </div>
    <div className="row">
      <span className="small muted" style={{ flex: 1 }}>
        Everything saves itself. Make plays this edit as it is, nothing to export.
      </span>
      <button className="link small" disabled={locked} onClick={onBin}>
        Bin this edit
      </button>
    </div>
  </div>
);

/** A card on the overlay: what it is, its words or picture or note, where it sits. */
export const CardPanel: React.FC<{ api: GameApi; card: Card; locked: boolean; onPatch: (p: Partial<Card>) => void }> = ({ api, card, locked, onPatch }) => (
  <div className="stack card-panel">
    <div className="row" style={{ gap: 8 }}>
      <select value={card.kind} disabled={locked} onChange={(e) => onPatch({ kind: e.target.value as Card["kind"] })} style={{ width: "auto" }} title="What the card is">
        <option value="text">Text card</option>
        <option value="image">Picture</option>
        <option value="broll">B-roll slot</option>
      </select>
      {card.kind !== "broll" ? (
        <select value={card.place} disabled={locked} onChange={(e) => onPatch({ place: e.target.value as Card["place"] })} style={{ width: "auto" }} title="full: the frame, on the backdrop, and it gives way to any footage playing. over: small, over whatever is playing.">
          <option value="full">on the backdrop</option>
          <option value="over">over the footage</option>
        </select>
      ) : null}
    </div>
    {card.kind === "text" ? <textarea rows={3} value={card.text ?? ""} disabled={locked} onChange={(e) => onPatch({ text: e.target.value })} placeholder="A few words. A new line is a new line on screen." /> : null}
    {card.kind === "broll" ? <textarea rows={2} value={card.note ?? ""} disabled={locked} onChange={(e) => onPatch({ note: e.target.value })} placeholder="What to film here (the shot list reads this)" /> : null}
    {card.kind === "image" ? (
      card.src ? (
        <>
          <img className="sketch" src={api.publicUrl(card.src)} alt="" />
          <div className="small muted mono">{card.src}</div>
        </>
      ) : (
        <div className="small muted">No picture yet. Drag one of the script's sketches from the library's Cards shelf, or the organise step fills it.</div>
      )
    ) : null}
    <div className="small muted">
      {fmtSeconds(card.at)} for {card.seconds.toFixed(1)}s{card.beat ? ` · beat ${card.beat}` : ""}. Drag its edges on the timeline to change how long it shows.
      {card.kind === "broll" ? " A b-roll slot is never drawn: drop footage on the video track under it." : card.place === "full" ? " On the backdrop it isn't drawn while footage plays." : ""}
    </div>
  </div>
);
