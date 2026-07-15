import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Candidate,
  ExpandResponse,
  ForgeError,
  ForgeStatus,
  GenerateResponse,
  SaveResponse,
} from "../../forge/protocol";
import { ICON } from "../../forge/styleBible";
import { buildIconSet, type IconSetEntry } from "./iconSet";
import { buildSoundSet, type SoundCategory, type SoundSetEntry } from "./soundSet";

type ForgeType = "sfx-bits" | "icon-bits" | "sfx";

/**
 * The Asset Forge panel (docs/design/asset-forge.md): sentence → (optional LLM
 * prompt expansion) → candidate spread → keep the good takes → saved into the
 * game's assets folder by the dev-server plugin, which also hands back the
 * manifest lines to paste. All generation/processing happens server-side; this
 * panel is pure chrome.
 *
 * Three asset types:
 * - `sfx-bits` (Blood in the Sand): audio takes + a done-tick SOUND manifest
 *   derived from the sim's roster + a static flow/UI list (soundSet.ts) — same
 *   pattern as the icon set. Pick a bank, generate 3 takes, keep the good ones;
 *   files land in Blood in the Sand's assets/audio/sfx as a variation bank.
 * - `icon-bits` (Blood in the Sand): the weapon/ability icon set, derived at
 *   runtime from the SIM's own WEAPONS/ABILITIES tables (iconSet.ts) — a new
 *   weapon/ability appears here automatically, flagged until its art subject
 *   is written in forge/styleBible.ts. Pick a row, generate, keep ONE; every
 *   candidate is previewed at 32px too — roster-row size, the acceptance test.
 * - `sfx` (Enter the Gauntlet): audio takes, variation banks (no manifest yet).
 *
 * The prompt box is the control surface: whatever is in it goes to the provider
 * verbatim. Blank = the style bible's template seeds it from the sentence.
 */

interface Props {
  onClose: () => void;
}

interface Take extends Candidate {
  keep: boolean;
}

/** Suggest a bank name from the sentence: "Sword hits shield!" → "sword_hits_shield". */
const slug = (subject: string): string =>
  subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 48);

const post = async <T,>(url: string, body: unknown): Promise<T> => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as T & Partial<ForgeError>;
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

const CATEGORY_ORDER = ["weapon", "offensive", "defensive", "support"] as const;
const SOUND_CATEGORY_ORDER: readonly SoundCategory[] = ["combat", "ability", "flow", "ui"];

export const ForgePanel = ({ onClose }: Props) => {
  const [status, setStatus] = useState<ForgeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [type, setType] = useState<ForgeType>("sfx-bits");
  const [iconId, setIconId] = useState<string | null>(null);
  const [soundId, setSoundId] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [prompt, setPrompt] = useState("");
  const [influence, setInfluence] = useState(0.3);
  const [duration, setDuration] = useState(""); // "" = let the model pick
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);

  const [busy, setBusy] = useState<"expand" | "generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [saved, setSaved] = useState<SaveResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(() => {
    fetch("/forge/status")
      .then((r) => r.json())
      .then((s: ForgeStatus) => setStatus(s))
      .catch(() => setStatusError("Forge endpoints not reachable — is the dev server running with the forge plugin?"));
  }, []);

  useEffect(loadStatus, [loadStatus]);

  const isIcon = type === "icon-bits";
  const isBits = type === "sfx-bits"; // the SFX type with a done-tick sound manifest
  // The set comes from the game's own tables; the server only says which files exist.
  const icons = useMemo(buildIconSet, []);
  const iconDone = (id: string): boolean => (status?.iconFiles ?? []).includes(`${id}.png`);
  const iconEntry = icons.find((e) => e.id === iconId) ?? null;
  const doneCount = icons.filter((e) => iconDone(e.id)).length;

  // The sound set — same derive-from-the-sim pattern; a bank is done when any
  // `<id>_<n>.mp3` exists in the destination.
  const sounds = useMemo(buildSoundSet, []);
  const soundDone = (id: string): boolean =>
    (status?.sfxFiles ?? []).some((f) => new RegExp(`^${id}_\\d+\\.mp3$`).test(f));
  const soundDoneCount = sounds.filter((e) => soundDone(e.id)).length;

  const baseName = isIcon ? (iconId ?? "") : nameEdited ? name : slug(subject);
  const kept = takes.filter((t) => t.keep);
  const sfxReady = status?.keys.elevenlabs === true;
  const openaiReady = status?.keys.openai === true;
  const generateReady = isIcon ? openaiReady : sfxReady;
  const durationSeconds = duration ? Number(duration) : undefined;

  const resetWork = (): void => {
    setTakes([]);
    setSaved(null);
    setError(null);
    setCopied(false);
    setPrompt("");
  };

  const switchType = (t: ForgeType): void => {
    setType(t);
    setSubject("");
    setIconId(null);
    setSoundId(null);
    setName("");
    setNameEdited(false);
    resetWork();
  };

  const pickIcon = (entry: IconSetEntry): void => {
    setIconId(entry.id);
    setSubject(entry.subject);
    resetWork();
  };

  /** Pick a sound bank: seed the prompt subject and lock the bank name to its id
   * (still editable in the takes section). Reuses the whole SFX save flow. */
  const pickSound = (entry: SoundSetEntry): void => {
    setSoundId(entry.id);
    setSubject(entry.subject);
    setName(entry.id);
    setNameEdited(true);
    resetWork();
  };

  const expand = useCallback(async () => {
    setBusy("expand");
    setError(null);
    try {
      const data = await post<ExpandResponse>("/forge/expand", {
        type,
        subject: subject.trim(),
        durationSeconds,
      });
      setPrompt(data.prompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [subject, durationSeconds]);

  const generate = useCallback(async () => {
    setBusy("generate");
    setError(null);
    setSaved(null);
    setCopied(false);
    try {
      // Icons: the panel owns the prompt build (set + accent live client-side).
      const builtPrompt = isIcon
        ? prompt.trim() || ICON.template(subject.trim(), iconEntry?.category ?? "weapon")
        : prompt.trim() || undefined;
      const data = await post<GenerateResponse>("/forge/generate", {
        type,
        subject: subject.trim(),
        prompt: builtPrompt,
        ...(isIcon ? {} : { durationSeconds, promptInfluence: influence }),
      });
      // Refill the box with what was actually sent (fills in the template on a
      // blank box) so the next round starts from editable ground truth.
      setPrompt(data.prompt);
      setTakes(data.candidates.map((c) => ({ ...c, keep: false })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [type, isIcon, iconId, subject, prompt, durationSeconds, influence]);

  const save = useCallback(async () => {
    setBusy("save");
    setError(null);
    setCopied(false);
    try {
      const data = await post<SaveResponse>("/forge/save", {
        type,
        baseName,
        subject: subject.trim(),
        prompt: prompt.trim(),
        ...(isIcon ? {} : { durationSeconds, promptInfluence: influence }),
        takes: kept.map((t) => t.b64),
      });
      setSaved(data);
      // Un-keep what was just saved; leftover SFX takes can still join the bank
      // later (the server continues numbering from disk).
      setTakes((ts) => ts.map((t) => ({ ...t, keep: false })));
      if (isIcon || isBits) loadStatus(); // refresh the done ticks
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [type, isIcon, baseName, subject, prompt, durationSeconds, influence, kept, loadStatus]);

  const copyLines = useCallback(() => {
    if (!saved) return;
    navigator.clipboard
      .writeText(saved.manifestLines.join("\n"))
      .then(() => setCopied(true))
      .catch(() => setError("Clipboard write failed — select the lines and copy manually."));
  }, [saved]);

  /** Icons keep exactly one candidate — clicking selects exclusively. */
  const keepOne = (id: number): void =>
    setTakes((ts) => ts.map((t) => ({ ...t, keep: t.id === id && !t.keep })));

  return (
    <div className="forge">
      <div className="forge-head">
        <h3>Asset Forge</h3>
        <button onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {statusError && <div className="errbox">{statusError}</div>}
      {status && !sfxReady && !isIcon && (
        <div className="warnbox">
          No ElevenLabs key. Copy <code>apps/realmsmith/.env.example</code> to{" "}
          <code>.env.local</code>, add <code>ELEVENLABS_API_KEY</code>, and restart the dev server.
        </div>
      )}
      {status && !openaiReady && isIcon && (
        <div className="warnbox">
          No OpenAI key. Add <code>OPENAI_API_KEY</code> to{" "}
          <code>apps/realmsmith/.env.local</code> and restart the dev server.
        </div>
      )}

      <label>
        Asset type
        <select value={type} onChange={(e) => switchType(e.target.value as ForgeType)}>
          {(status?.types ?? [{ id: "sfx-bits", label: "Sound (Blood in the Sand)" }]).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      {isBits && (
        <div className="icon-manifest">
          <div className="icon-manifest-head">
            The sounds — {soundDoneCount} of {sounds.length} done
          </div>
          {SOUND_CATEGORY_ORDER.map((cat) => (
            <div key={cat} className="icon-cat-row">
              <span className={`icon-cat sound-cat-${cat}`}>{cat}</span>
              <div className="icon-chips">
                {sounds
                  .filter((e) => e.category === cat)
                  .map((e) => (
                    <button
                      key={e.id}
                      className={`icon-chip${e.id === soundId ? " active" : ""}${soundDone(e.id) ? " done" : ""}`}
                      onClick={() => pickSound(e)}
                      title={e.missingSubject ? "no sound brief yet — add one to SOUND_SUBJECTS in forge/styleBible.ts" : e.subject}
                    >
                      {soundDone(e.id) ? "✓ " : ""}
                      {e.label}
                      {e.missingSubject ? " ⚠" : ""}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {isIcon && (
        <div className="icon-manifest">
          <div className="icon-manifest-head">
            The set — {doneCount} of {icons.length} done
          </div>
          {CATEGORY_ORDER.map((cat) => (
            <div key={cat} className="icon-cat-row">
              <span className={`icon-cat icon-cat-${cat}`}>{cat}</span>
              <div className="icon-chips">
                {icons
                  .filter((e) => e.category === cat)
                  .map((e) => (
                    <button
                      key={e.id}
                      className={`icon-chip${e.id === iconId ? " active" : ""}${iconDone(e.id) ? " done" : ""}`}
                      onClick={() => pickIcon(e)}
                      title={e.missingSubject ? "no art subject yet — add one to ICON_SUBJECTS in forge/styleBible.ts" : e.subject}
                    >
                      {iconDone(e.id) ? "✓ " : ""}
                      {e.name}
                      {e.missingSubject ? " ⚠" : ""}
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <label>
        {isIcon
          ? "Icon subject (from the manifest — edit freely)"
          : isBits
            ? "Sound brief (from the manifest — edit freely)"
            : "Describe the sound"}
        <textarea
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={
            isIcon
              ? "pick an icon above, or describe one"
              : isBits
                ? "pick a sound above, or describe one"
                : "a heavy sword striking a wooden shield"
          }
          rows={2}
        />
      </label>

      {!isIcon && (
        <button
          onClick={expand}
          disabled={busy !== null || !subject.trim() || !openaiReady}
          title={
            openaiReady
              ? "An LLM rewrites the sentence into proper SFX prompt-craft (sources, textures, shape)"
              : "Needs OPENAI_API_KEY in apps/realmsmith/.env.local"
          }
        >
          {busy === "expand" ? "Expanding…" : "✨ Expand into a crafted prompt"}
        </button>
      )}

      <label>
        Prompt (sent verbatim; blank = built from the {isIcon ? "subject + style bible" : "sentence"})
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            isIcon
              ? "leave blank — the style bible's icon template carries the brand language"
              : "dozens of chitinous spider legs skittering over stone as a nest collapses…"
          }
          rows={4}
        />
      </label>

      {!isIcon && (
        <>
          <label>
            Prompt influence: {influence.toFixed(2)} — higher follows the text more literally
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={influence}
              onChange={(e) => setInfluence(Number(e.target.value))}
            />
          </label>

          <label>
            Duration (seconds, blank = auto)
            <input
              type="number"
              min={0.5}
              max={30}
              step={0.5}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="auto"
            />
          </label>
        </>
      )}

      <button
        className="primary"
        onClick={generate}
        disabled={busy !== null || !(subject.trim() || (isIcon && iconEntry)) || !generateReady}
      >
        {busy === "generate"
          ? isIcon
            ? "Generating… (30–90s per image)"
            : "Generating… (a few seconds per take)"
          : isIcon
            ? "Generate 2 candidates"
            : "Generate 3 takes"}
      </button>

      {takes.length > 0 && !isIcon && (
        <>
          <div className="takes">
            {takes.map((t) => (
              <div key={t.id} className={`candidate${t.keep ? " keep" : ""}`}>
                <input
                  type="checkbox"
                  checked={t.keep}
                  title="Keep this take"
                  onChange={(e) =>
                    setTakes((ts) =>
                      ts.map((x) => (x.id === t.id ? { ...x, keep: e.target.checked } : x)),
                    )
                  }
                />
                <audio controls preload="metadata" src={`data:${t.mime};base64,${t.b64}`} />
              </div>
            ))}
          </div>

          <label>
            Bank name (files save as name_1, name_2, …)
            <input
              type="text"
              value={baseName}
              onChange={(e) => {
                setName(e.target.value);
                setNameEdited(true);
              }}
              placeholder="sword_hit"
            />
          </label>

          <button className="primary" onClick={save} disabled={busy !== null || kept.length === 0 || !baseName}>
            {busy === "save"
              ? "Processing & saving…"
              : `Save ${kept.length || "…"} take${kept.length === 1 ? "" : "s"} to assets/audio/sfx`}
          </button>
        </>
      )}

      {takes.length > 0 && isIcon && (
        <>
          <div className="icon-candidates">
            {takes.map((t) => (
              <button key={t.id} className={`icon-candidate${t.keep ? " keep" : ""}`} onClick={() => keepOne(t.id)}>
                <img className="icon-full" src={`data:${t.mime};base64,${t.b64}`} alt={`candidate ${t.id + 1}`} />
                <div className="icon-small-row">
                  <img className="icon-small" src={`data:${t.mime};base64,${t.b64}`} alt="" />
                  <span>32px — still readable?</span>
                </div>
              </button>
            ))}
          </div>

          <button
            className="primary"
            onClick={save}
            disabled={busy !== null || kept.length !== 1 || !baseName}
            title={iconId ? `saves as ${iconId}.png` : "pick a manifest icon to name the file"}
          >
            {busy === "save"
              ? "Processing & saving…"
              : kept.length === 1
                ? `Save as ${baseName || "…"}.png`
                : "Pick ONE candidate to save"}
          </button>
        </>
      )}

      {saved && (
        <div className="okbox">
          <div>
            Saved <strong>{saved.files.join(", ")}</strong>
            {isIcon ? " (512px, transparent)." : " (trimmed + loudness-normalized)."}
          </div>
          <div>
            {isIcon
              ? "Paste into src/loadout/icons.tsx when switching to image icons:"
              : isBits
                ? "Paste into src/audio/manifest.ts:"
                : "Paste into src/game/audio/manifest.ts:"}
          </div>
          <pre>{saved.manifestLines.join("\n")}</pre>
          <button onClick={copyLines}>{copied ? "Copied ✓" : "Copy manifest lines"}</button>
        </div>
      )}

      {error && <div className="errbox">{error}</div>}
    </div>
  );
};
