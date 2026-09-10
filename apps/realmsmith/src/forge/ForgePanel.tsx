import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  Candidate,
  ForgeError,
  ForgeStatus,
  GenerateResponse,
  BankResponse,
  SaveResponse,
} from "../../forge/protocol";
import { BADGE, DEED, HOME, ICON, MODE, SPRITE } from "../../forge/styleBible";
import { buildBadgeSet, type BadgeSetEntry } from "./badgeSet";
import { buildDeedSet, type DeedSetEntry } from "./deedSet";
import { buildHomeSet, type HomeSetEntry } from "./homeSet";
import { buildIconSet, type IconSetEntry } from "./iconSet";
import { buildModeSet, type ModeSetEntry } from "./modeSet";
import { buildSoundSet, type SoundCategory, type SoundSetEntry } from "./soundSet";
import { buildSpriteSet, type SpriteSetEntry } from "./spriteSet";

type ForgeType = "sfx-bits" | "icon-bits" | "sprite-bits" | "mode-bits" | "badge-bits" | "deed-bits" | "home-bits" | "sfx";

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

const get = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  const data = (await res.json()) as T & Partial<ForgeError>;
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
};

const CATEGORY_ORDER = ["weapon", "offensive", "defensive", "support", "currency"] as const;
const SOUND_CATEGORY_ORDER: readonly SoundCategory[] = ["combat", "ability", "flow", "ui"];

export const ForgePanel = ({ onClose }: Props) => {
  const [status, setStatus] = useState<ForgeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [type, setType] = useState<ForgeType>("sfx-bits");
  const [iconId, setIconId] = useState<string | null>(null);
  const [soundId, setSoundId] = useState<string | null>(null);
  const [spriteId, setSpriteId] = useState<string | null>(null);
  const [modeId, setModeId] = useState<string | null>(null);
  const [badgeId, setBadgeId] = useState<string | null>(null);
  const [deedId, setDeedId] = useState<string | null>(null);
  const [homeId, setHomeId] = useState<string | null>(null);

  const [subject, setSubject] = useState("");
  const [prompt, setPrompt] = useState("");
  const [influence, setInfluence] = useState(0.3);
  const [duration, setDuration] = useState(""); // "" = let the model pick
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);

  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [takes, setTakes] = useState<Take[]>([]);
  const [saved, setSaved] = useState<SaveResponse | null>(null);
  // The picked sound bank as it stands on disk (GET /forge/bank): audition,
  // count, remove. Refetched after every save/remove.
  const [bank, setBank] = useState<BankResponse | null>(null);
  const [bankBusy, setBankBusy] = useState<string | null>(null);
  // Quick filter over the sound set (61 banks — finding one by eye got slow).
  const [soundFilter, setSoundFilter] = useState("");
  const [copied, setCopied] = useState(false);

  const loadStatus = useCallback(() => {
    fetch("/forge/status")
      .then((r) => r.json())
      .then((s: ForgeStatus) => setStatus(s))
      .catch(() => setStatusError("Forge endpoints not reachable — is the dev server running with the forge plugin?"));
  }, []);

  useEffect(loadStatus, [loadStatus]);

  const isIcon = type === "icon-bits";
  const isSprite = type === "sprite-bits";
  const isMode = type === "mode-bits";
  const isBadge = type === "badge-bits";
  const isDeed = type === "deed-bits";
  const isHome = type === "home-bits";
  /** All GPT Image flows: one candidate kept, saved as `<id>.png`. */
  const isImage = isIcon || isSprite || isMode || isBadge || isDeed || isHome;
  const isBits = type === "sfx-bits"; // the SFX type with a done-tick sound manifest
  // The set comes from the game's own tables; the server only says which files exist.
  const icons = useMemo(buildIconSet, []);
  const iconDone = (id: string): boolean => (status?.iconFiles ?? []).includes(`${id}.png`);
  const iconEntry = icons.find((e) => e.id === iconId) ?? null;
  const doneCount = icons.filter((e) => iconDone(e.id)).length;

  // The sprite set — a static checked-in list (spriteSet.ts), done when the PNG exists.
  const sprites = useMemo(buildSpriteSet, []);
  const spriteDone = (id: string): boolean => (status?.spriteFiles ?? []).includes(`${id}.png`);
  const spriteDoneCount = sprites.filter((e) => spriteDone(e.id)).length;

  // The mode-card set — the checked-in MODE_KEYS list (modeSet.ts), same pattern.
  const modes = useMemo(buildModeSet, []);
  const modeDone = (id: string): boolean => (status?.modeFiles ?? []).includes(`${id}.png`);
  const modeDoneCount = modes.filter((e) => modeDone(e.id)).length;

  // The rank-badge set — the checked-in BADGE_KEYS tier list (badgeSet.ts).
  const badges = useMemo(buildBadgeSet, []);
  const badgeDone = (id: string): boolean => (status?.badgeFiles ?? []).includes(`${id}.png`);
  const badgeEntry = badges.find((e) => e.id === badgeId) ?? null;
  const badgeDoneCount = badges.filter((e) => badgeDone(e.id)).length;

  // The deed-icon set — derived from the sim's ACHIEVEMENT_DEFS (deedSet.ts);
  // cast/weapon chains reuse loadout icons in-game, so they never appear here.
  const deeds = useMemo(buildDeedSet, []);
  const deedDone = (id: string): boolean => (status?.deedFiles ?? []).includes(`${id}.png`);
  const deedDoneCount = deeds.filter((e) => deedDone(e.id)).length;
  // STALE = forged, but DEED_SUBJECTS has been rewritten since (the sidecar
  // remembers what the PNG was actually made from). These are the only
  // re-forge candidates — everything else done is done; don't regenerate it.
  const deedForgedFrom = (id: string): string | undefined => status?.deedForged?.[id];
  const deedStale = (e: DeedSetEntry): boolean => {
    const forged = deedForgedFrom(e.id);
    return deedDone(e.id) && !e.missingSubject && forged !== undefined && forged.trim() !== e.subject.trim();
  };
  const deedStaleCount = deeds.filter(deedStale).length;

  // The home-backdrop set — the checked-in HOME_KEYS list (homeSet.ts).
  const homes = useMemo(buildHomeSet, []);
  const homeDone = (id: string): boolean => (status?.homeFiles ?? []).includes(`${id}.png`);
  const homeDoneCount = homes.filter((e) => homeDone(e.id)).length;

  // The sound set — same derive-from-the-sim pattern; a bank is done when any
  // `<id>_<n>.mp3` exists in the destination.
  const sounds = useMemo(buildSoundSet, []);
  const soundDone = (id: string): boolean =>
    (status?.sfxFiles ?? []).some((f) => new RegExp(`^${id}_\\d+\\.mp3$`).test(f));
  const soundDoneCount = sounds.filter((e) => soundDone(e.id)).length;
  // STALE = forged, but the brief has been rewritten since (the sidecar keeps
  // what the mp3 was made from). After the 2026-09-06 Stable Audio rewrite this
  // is the regenerate list — save overwrites the bank in place.
  const soundForgedFrom = (id: string): string | undefined => status?.sfxForged?.[id];
  const soundStale = (e: SoundSetEntry): boolean => {
    const forged = soundForgedFrom(e.id);
    return soundDone(e.id) && !e.missingSubject && forged !== undefined && forged.trim() !== e.subject.trim();
  };
  const soundStaleCount = sounds.filter(soundStale).length;

  const baseName = isIcon
    ? (iconId ?? "")
    : isSprite
      ? (spriteId ?? "")
      : isMode
        ? (modeId ?? "")
        : isBadge
          ? (badgeId ?? "")
          : isDeed
            ? (deedId ?? "")
            : isHome
              ? (homeId ?? "")
              : nameEdited
                ? name
                : slug(subject);
  const kept = takes.filter((t) => t.keep);
  const provider = status?.sfxProvider ?? "elevenlabs";
  const localSfx = provider !== "elevenlabs"; // the local engine is in play
  const sfxReady =
    provider === "stable-audio"
      ? status?.keys.stableAudio === true
      : provider === "both"
        ? status?.keys.stableAudio === true || status?.keys.elevenlabs === true
        : status?.keys.elevenlabs === true;
  const openaiReady = status?.keys.openai === true;
  const generateReady = isImage ? openaiReady : sfxReady;
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
    setBank(null);
    setSpriteId(null);
    setModeId(null);
    setBadgeId(null);
    setDeedId(null);
    setHomeId(null);
    setName("");
    setNameEdited(false);
    resetWork();
  };

  const pickIcon = (entry: IconSetEntry): void => {
    setIconId(entry.id);
    setSubject(entry.subject);
    resetWork();
  };

  const pickSprite = (entry: SpriteSetEntry): void => {
    setSpriteId(entry.id);
    setSubject(entry.subject);
    resetWork();
  };

  const pickMode = (entry: ModeSetEntry): void => {
    setModeId(entry.id);
    setSubject(entry.subject);
    resetWork();
  };

  const pickBadge = (entry: BadgeSetEntry): void => {
    setBadgeId(entry.id);
    setSubject(entry.subject);
    resetWork();
  };

  const pickDeed = (entry: DeedSetEntry): void => {
    setDeedId(entry.id);
    setSubject(entry.subject);
    resetWork();
  };

  const pickHome = (entry: HomeSetEntry): void => {
    setHomeId(entry.id);
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
    // The bank's suggested length (SOUND_DURATIONS) — a starting point, edit freely.
    setDuration(entry.durationSeconds === undefined ? "" : String(entry.durationSeconds));
    void loadBank(entry.id);
  };

  const loadBank = useCallback(
    async (id: string) => {
      try {
        setBank(await get<BankResponse>(`/forge/bank?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`));
      } catch (e) {
        setBank(null);
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [type],
  );

  const removeTake = useCallback(
    async (file: string) => {
      if (!soundId) return;
      setBankBusy(file);
      setError(null);
      try {
        setBank(await post<BankResponse>("/forge/bank/remove", { type, id: soundId, file }));
        loadStatus(); // done-ticks follow the folder
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBankBusy(null);
      }
    },
    [type, soundId, loadStatus],
  );

  const generate = useCallback(async () => {
    setBusy("generate");
    setError(null);
    setSaved(null);
    setCopied(false);
    try {
      // Images: the panel owns the prompt build (sets + accents live client-side).
      const builtPrompt = isIcon
        ? prompt.trim() || ICON.template(subject.trim(), iconEntry?.category ?? "weapon")
        : isSprite
          ? prompt.trim() || SPRITE.template(subject.trim())
          : isMode
            ? prompt.trim() || MODE.template(subject.trim())
            : isBadge
              ? prompt.trim() || BADGE.template(subject.trim(), badgeEntry?.accent)
              : isDeed
                ? prompt.trim() || DEED.template(subject.trim())
                : isHome
                  ? prompt.trim() || HOME.template(subject.trim())
                  : prompt.trim() || undefined;
      const data = await post<GenerateResponse>("/forge/generate", {
        type,
        subject: subject.trim(),
        prompt: builtPrompt,
        ...(isImage ? {} : { durationSeconds, promptInfluence: influence }),
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
  }, [type, isIcon, isSprite, isMode, isBadge, isDeed, isHome, isImage, iconId, badgeId, deedId, homeId, subject, prompt, durationSeconds, influence]);

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
        ...(isImage ? {} : { durationSeconds, promptInfluence: influence }),
        takes: kept.map((t) => t.b64),
        ...(isImage ? {} : { engines: kept.map((t) => t.engine) }),
      });
      setSaved(data);
      if (soundId) void loadBank(soundId);
      // Un-keep what was just saved; leftover SFX takes can still join the bank
      // later (the server continues numbering from disk).
      setTakes((ts) => ts.map((t) => ({ ...t, keep: false })));
      if (isImage || isBits) loadStatus(); // refresh the done ticks
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [type, isImage, isBits, baseName, subject, prompt, durationSeconds, influence, kept, loadStatus, soundId, loadBank]);

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
      {status && !sfxReady && !isImage && !localSfx && (
        <div className="warnbox">
          No ElevenLabs key. Copy <code>apps/realmsmith/.env.example</code> to{" "}
          <code>.env.local</code>, add <code>ELEVENLABS_API_KEY</code>, and restart the dev server.
        </div>
      )}
      {status && !sfxReady && !isImage && localSfx && (
        <div className="warnbox">
          Sound engine isn't ready — missing: {status.sfxProviderMissing.join("; ")}. See
          docs/design/asset-forge.md § Stable Audio.
        </div>
      )}
      {status && sfxReady && !isImage && localSfx && (
        <div className="hint">
          {provider === "both"
            ? "Sound engines: Stable Audio 3 (local) AND ElevenLabs, same prompt and duration — every take is tagged, keep whichever wins."
            : "Sound engine: Stable Audio 3 Small-SFX, running locally (no API cost). The bank briefs are written in its register — generate them as-is."}
          {provider === "both" && status.sfxProviderMissing.length > 0
            ? ` (${status.sfxProviderMissing.join("; ")} — that engine will be skipped)`
            : ""}
          {!status.keys.stableAudioWeights && " First generation downloads ~1GB of weights — give it a few minutes."}
        </div>
      )}
      {status && !openaiReady && isImage && (
        <div className="warnbox">
          No OpenAI key. Add <code>OPENAI_API_KEY</code> to{" "}
          <code>apps/realmsmith/.env.local</code> and restart the dev server.
        </div>
      )}

      <div className="forge-body">
      <aside className="forge-set">
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
            {soundStaleCount > 0 ? `, ${soundStaleCount} stale (brief rewritten since forged — ↻)` : ""}
          </div>
          <input
            type="search"
            className="set-filter"
            value={soundFilter}
            onChange={(e) => setSoundFilter(e.target.value)}
            placeholder="filter sounds…"
          />
          {SOUND_CATEGORY_ORDER.map((cat) => (
            <div key={cat} className="icon-cat-row">
              <span className={`icon-cat sound-cat-${cat}`}>{cat}</span>
              <div className="icon-chips">
                {sounds
                  .filter(
                    (e) =>
                      e.category === cat &&
                      (soundFilter.trim() === "" ||
                        `${e.label} ${e.id}`.toLowerCase().includes(soundFilter.trim().toLowerCase())),
                  )
                  .map((e) => (
                    <button
                      key={e.id}
                      className={`icon-chip${e.id === soundId ? " active" : ""}${soundDone(e.id) ? " done" : ""}${soundStale(e) ? " stale" : ""}`}
                      onClick={() => pickSound(e)}
                      title={
                        e.missingSubject
                          ? "no sound brief yet — add one to SOUND_SUBJECTS in forge/styleBible.ts"
                          : soundStale(e)
                            ? `STALE — forged from: "${soundForgedFrom(e.id)}"\n\nnow: ${e.subject}`
                            : e.subject
                      }
                    >
                      {soundStale(e) ? "↻ " : soundDone(e.id) ? "✓ " : ""}
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

      {isMode && (
        <div className="icon-manifest">
          <div className="icon-manifest-head">
            The mode cards — {modeDoneCount} of {modes.length} done
          </div>
          <div className="icon-cat-row">
            <span className="icon-cat icon-cat-mode">card</span>
            <div className="icon-chips">
              {modes.map((e) => (
                <button
                  key={e.id}
                  className={`icon-chip${e.id === modeId ? " active" : ""}${modeDone(e.id) ? " done" : ""}`}
                  onClick={() => pickMode(e)}
                  title={e.missingSubject ? "no art subject yet — add one to MODE_SUBJECTS in forge/styleBible.ts" : e.subject}
                >
                  {modeDone(e.id) ? "✓ " : ""}
                  {e.name}
                  {e.missingSubject ? " ⚠" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isBadge && (
        <div className="icon-manifest">
          <div className="icon-manifest-head">
            The rank badges — {badgeDoneCount} of {badges.length} done
          </div>
          <div className="icon-cat-row">
            <span className="icon-cat icon-cat-mode">tier</span>
            <div className="icon-chips">
              {badges.map((e) => (
                <button
                  key={e.id}
                  className={`icon-chip${e.id === badgeId ? " active" : ""}${badgeDone(e.id) ? " done" : ""}`}
                  onClick={() => pickBadge(e)}
                  title={e.missingSubject ? "no art subject yet — add one to BADGE_SUBJECTS in forge/styleBible.ts" : e.subject}
                >
                  {badgeDone(e.id) ? "✓ " : ""}
                  {e.name}
                  {e.missingSubject ? " ⚠" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isDeed && (
        <div className="icon-manifest">
          <div className="icon-manifest-head">
            The deed icons — {deedDoneCount} of {deeds.length} done
            {deedStaleCount > 0 ? `, ${deedStaleCount} stale (subject rewritten since forged — ↻)` : ""} (cast/weapon
            chains reuse the loadout icons)
          </div>
          <div className="icon-cat-row">
            <span className="icon-cat icon-cat-mode">deed</span>
            <div className="icon-chips">
              {deeds.map((e) => (
                <button
                  key={e.id}
                  className={`icon-chip${e.id === deedId ? " active" : ""}${deedDone(e.id) ? " done" : ""}${deedStale(e) ? " stale" : ""}`}
                  onClick={() => pickDeed(e)}
                  title={
                    e.missingSubject
                      ? "no art subject yet — add one to DEED_SUBJECTS in forge/styleBible.ts"
                      : deedStale(e)
                        ? `STALE — forged from: "${deedForgedFrom(e.id)}"\n\nnow: ${e.subject}`
                        : e.subject
                  }
                >
                  {deedStale(e) ? "↻ " : deedDone(e.id) ? "✓ " : ""}
                  {e.name}
                  {e.missingSubject ? " ⚠" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isHome && (
        <div className="icon-manifest">
          <div className="icon-manifest-head">
            The home backdrops — {homeDoneCount} of {homes.length} done
          </div>
          <div className="icon-cat-row">
            <span className="icon-cat icon-cat-mode">scene</span>
            <div className="icon-chips">
              {homes.map((e) => (
                <button
                  key={e.id}
                  className={`icon-chip${e.id === homeId ? " active" : ""}${homeDone(e.id) ? " done" : ""}`}
                  onClick={() => pickHome(e)}
                  title={e.missingSubject ? "no art subject yet — add one to HOME_SUBJECTS in forge/styleBible.ts" : e.subject}
                >
                  {homeDone(e.id) ? "✓ " : ""}
                  {e.name}
                  {e.missingSubject ? " ⚠" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isSprite && (
        <div className="icon-manifest">
          <div className="icon-manifest-head">
            The sprites — {spriteDoneCount} of {sprites.length} done
          </div>
          <div className="icon-cat-row">
            <span className="icon-cat icon-cat-sprite">figure</span>
            <div className="icon-chips">
              {sprites.map((e) => (
                <button
                  key={e.id}
                  className={`icon-chip${e.id === spriteId ? " active" : ""}${spriteDone(e.id) ? " done" : ""}`}
                  onClick={() => pickSprite(e)}
                  title={e.missingSubject ? "no art subject yet — add one to SPRITE_SUBJECTS in forge/styleBible.ts" : e.subject}
                >
                  {spriteDone(e.id) ? "✓ " : ""}
                  {e.name}
                  {e.missingSubject ? " ⚠" : ""}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      </aside>
      <section className="forge-work">
      <label>
        {isIcon
          ? "Icon subject (from the manifest — edit freely)"
          : isSprite
            ? "Sprite subject (from the manifest — edit freely)"
            : isMode
              ? "Scene subject (from the manifest — edit freely)"
              : isBadge
                ? "Badge subject (from the manifest — edit freely)"
                : isDeed
                  ? "Deed subject (from the manifest — edit freely)"
                  : isHome
                    ? "Backdrop subject (from the manifest — edit freely)"
                    : isBits
                    ? "Sound brief (from the manifest — edit freely)"
                    : "Describe the sound"}
        <textarea
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder={
            isIcon
              ? "pick an icon above, or describe one"
              : isSprite
                ? "pick a sprite above, or describe one"
                : isMode
                  ? "pick a mode card above, or describe a scene"
                  : isBadge
                    ? "pick a badge above, or describe an emblem"
                    : isDeed
                      ? "pick a deed above, or describe an emblem"
                      : isHome
                        ? "pick a backdrop above, or describe a scene"
                        : isBits
                        ? "pick a sound above, or describe one"
                        : "a heavy sword striking a wooden shield"
          }
          rows={2}
        />
      </label>

      <label>
        Prompt (sent verbatim; blank = built from the {isImage ? "subject + style bible" : "sentence"})
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            isImage
              ? `leave blank — the style bible's ${isSprite ? "sprite" : isMode ? "mode-card" : isBadge ? "badge" : isDeed ? "deed" : isHome ? "home-backdrop" : "icon"} template carries the brand language`
              : "dozens of chitinous spider legs skittering over stone as a nest collapses…"
          }
          rows={4}
        />
      </label>

      {!isImage && (
        <>
          {provider !== "stable-audio" && (
          <label>
            Prompt influence: {influence.toFixed(2)} — higher follows the text more literally{provider === "both" ? " (ElevenLabs only)" : ""}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={influence}
              onChange={(e) => setInfluence(Number(e.target.value))}
            />
          </label>
          )}

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
        disabled={busy !== null || !subject.trim() || !generateReady}
      >
        {busy === "generate"
          ? isImage
            ? "Generating… (30–90s per image)"
            : "Generating… (a few seconds per take)"
          : isImage
            ? "Generate 4 candidates"
            : provider === "both"
              ? "Generate 3 + 3 takes (local + ElevenLabs)"
              : "Generate 3 takes"}
      </button>

      {isBits && soundId && bank && bank.id === soundId && (
        <div className="bank">
          <div className="icon-manifest-head">
            In the bank — {bank.takes.length} take{bank.takes.length === 1 ? "" : "s"} on disk
            {bank.takes.length > 1 ? " (one plays at random per event)" : ""}
          </div>
          {bank.takes.length === 0 && <div className="hint">Nothing saved yet — generate, keep, save.</div>}
          {bank.takes.map((t) => (
            <div key={t.file} className="candidate keep">
              <code>{t.file}</code>
              <audio controls preload="metadata" src={`data:${t.mime};base64,${t.b64}`} />
              <button
                onClick={() => void removeTake(t.file)}
                disabled={busy !== null || bankBusy !== null}
                title="Delete this take from the bank (file, sidecar entry, manifest)"
              >
                {bankBusy === t.file ? "Removing…" : "Remove"}
              </button>
            </div>
          ))}
        </div>
      )}

      {takes.length > 0 && !isImage && (
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
                {t.engine && (
                  <span className={`engine-tag engine-${t.engine}`} title={t.engine === "stable-audio" ? "Stable Audio 3, local" : "ElevenLabs"}>
                    {t.engine === "stable-audio" ? "local" : "11L"}
                  </span>
                )}
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

      {takes.length > 0 && isImage && (
        <>
          <div className="icon-candidates">
            {/* Previews show the SAVE pipeline's output (grid-snapped) when the
                server provides it — judge what will actually ship, not the raw
                generation; save still posts the raw b64. */}
            {takes.map((t) => (
              <button
                key={t.id}
                className={`icon-candidate${isSprite ? " sprite" : ""}${isMode ? " mode" : ""}${isHome ? " home" : ""}${t.keep ? " keep" : ""}`}
                onClick={() => keepOne(t.id)}
              >
                {isMode ? (
                  // The in-game verify: the card's 5:2 crop with its real
                  // scrim gradient and a stand-in title over the left third —
                  // if the title fights the art here, it will in the game.
                  <div className="mode-frame">
                    <img
                      className="icon-full"
                      src={`data:${t.mime};base64,${t.preview ?? t.b64}`}
                      alt={`candidate ${t.id + 1}`}
                    />
                    <div className="mode-frame-scrim" />
                    <span className="mode-frame-title">{(modeId ?? "mode").toUpperCase()}</span>
                  </div>
                ) : isHome ? (
                  // The in-game verify: a phone-shaped cover-crop (the 2:3
                  // canvas loses its outer sixths) with the title over the
                  // sky and a stand-in PLAY over the sand — if the UI fights
                  // the art here, it will on the phone.
                  <div className="home-frame">
                    <img
                      className="icon-full"
                      src={`data:${t.mime};base64,${t.preview ?? t.b64}`}
                      alt={`candidate ${t.id + 1}`}
                    />
                    <div className="home-frame-title">
                      <span className="home-frame-word-a">BLOOD</span>
                      <span className="home-frame-word-b">IN THE SAND</span>
                    </div>
                    <span className="home-frame-play">PLAY</span>
                  </div>
                ) : (
                  <img
                    className="icon-full"
                    src={`data:${t.mime};base64,${t.preview ?? t.b64}`}
                    alt={`candidate ${t.id + 1}`}
                  />
                )}
                <div className="icon-small-row">
                  {!isMode && !isHome && (
                    <img
                      className={isSprite ? "sprite-small" : "icon-small"}
                      src={`data:${t.mime};base64,${t.preview ?? t.b64}`}
                      alt=""
                    />
                  )}
                  <span>
                    {isMode
                      ? "card crop + scrim — does the title read over the left third?"
                      : isHome
                        ? "phone crop — sky clear for the title, sand clear for the menu?"
                        : isSprite
                          ? "~title-screen size, on sand — reads well?"
                          : isBadge
                            ? "32px — reads as a rank crest beside the tier title?"
                            : isDeed
                              ? "32px — reads as a deed medallion on the map?"
                              : "32px — still readable?"}
                  </span>
                </div>
              </button>
            ))}
          </div>

          <button
            className="primary"
            onClick={save}
            disabled={busy !== null || kept.length !== 1 || !baseName}
            title={
              baseName
                ? `saves as ${baseName}.png`
                : `pick a manifest ${isSprite ? "sprite" : isMode ? "mode card" : isBadge ? "badge" : isHome ? "backdrop" : "icon"} to name the file`
            }
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
            {isImage
              ? isMode
                ? ` (${MODE.savedWidth}×${MODE.savedHeight}, opaque 5:2 crop).`
                : isHome
                  ? ` (${HOME.savedWidth}×${HOME.savedHeight}, opaque portrait — phones cover-crop at runtime).`
                  : ` (${isSprite ? SPRITE.savedSize : isBadge ? BADGE.savedSize : isDeed ? DEED.savedSize : ICON.savedSize}px, transparent).`
              : " (trimmed + loudness-normalized)."}
          </div>
          <div>
            {isIcon
              ? "Paste into src/loadout/icons.tsx when switching to image icons:"
              : isSprite
                ? "Require-map line for the consuming screen (title screen, when built):"
                : isMode
                  ? modeId?.startsWith("bracket-")
                    ? "Paste into BRACKET_ART in src/screens/RankedScreen.tsx (replaces null):"
                    : "Paste into MODE_ART in src/screens/ModeSelectScreen.tsx (replaces image: null):"
                  : isBadge
                    ? "Paste into RANK_BADGES in src/components/rankBadges.ts (replaces null):"
                    : isDeed
                      ? "Paste into DEED_ICONS in src/deeds/deedIcons.ts (replaces null):"
                      : isHome
                        ? "Paste into HOME_ART in src/screens/homeArt.ts (replaces null):"
                        : isBits
                          ? `Wired: ${saved.manifest ?? "manifest"} regenerated — the bank is live on next app reload.`
                          : "Paste into src/game/audio/manifest.ts:"}
          </div>
          {!(isBits && saved.manifest) && (
            <>
              <pre>{saved.manifestLines.join("\n")}</pre>
              <button onClick={copyLines}>{copied ? "Copied ✓" : "Copy manifest lines"}</button>
            </>
          )}
        </div>
      )}

      {error && <div className="errbox">{error}</div>}
      </section>
      </div>
    </div>
  );
};
