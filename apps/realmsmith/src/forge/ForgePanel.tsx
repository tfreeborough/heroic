import { useCallback, useEffect, useState } from "react";
import type {
  Candidate,
  ExpandResponse,
  ForgeError,
  ForgeStatus,
  GenerateResponse,
  SaveResponse,
} from "../../forge/protocol";

/**
 * The Asset Forge panel (docs/design/asset-forge.md): sentence → (optional LLM
 * prompt expansion) → candidate spread → keep the good takes → saved into the
 * game's assets folder by the dev-server plugin, which also hands back the
 * manifest lines to paste. All generation/processing happens server-side; this
 * panel is pure chrome.
 *
 * The prompt box is the control surface: whatever is in it goes to the provider
 * verbatim. Blank = the style bible's template seeds it from the sentence;
 * Expand = an LLM rewrites the sentence into proper SFX prompt-craft. Either
 * way the box is refilled with what was actually sent, so iterating means
 * editing text, not guessing.
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

export const ForgePanel = ({ onClose }: Props) => {
  const [status, setStatus] = useState<ForgeStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

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

  useEffect(() => {
    fetch("/forge/status")
      .then((r) => r.json())
      .then((s: ForgeStatus) => setStatus(s))
      .catch(() => setStatusError("Forge endpoints not reachable — is the dev server running with the forge plugin?"));
  }, []);

  const baseName = nameEdited ? name : slug(subject);
  const kept = takes.filter((t) => t.keep);
  const keyReady = status?.keys.elevenlabs === true;
  const expandReady = status?.keys.openai === true;
  const durationSeconds = duration ? Number(duration) : undefined;

  const expand = useCallback(async () => {
    setBusy("expand");
    setError(null);
    try {
      const data = await post<ExpandResponse>("/forge/expand", {
        type: "sfx",
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
      const data = await post<GenerateResponse>("/forge/generate", {
        type: "sfx",
        subject: subject.trim(),
        prompt: prompt.trim() || undefined,
        durationSeconds,
        promptInfluence: influence,
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
  }, [subject, prompt, durationSeconds, influence]);

  const save = useCallback(async () => {
    setBusy("save");
    setError(null);
    setCopied(false);
    try {
      const data = await post<SaveResponse>("/forge/save", {
        type: "sfx",
        baseName,
        subject: subject.trim(),
        prompt: prompt.trim(),
        durationSeconds,
        promptInfluence: influence,
        takes: kept.map((t) => t.b64),
      });
      setSaved(data);
      // Un-keep what was just saved; leftover takes can still join the bank later
      // (the server continues numbering from disk).
      setTakes((ts) => ts.map((t) => ({ ...t, keep: false })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [baseName, subject, prompt, durationSeconds, influence, kept]);

  const copyLines = useCallback(() => {
    if (!saved) return;
    navigator.clipboard
      .writeText(saved.manifestLines.join("\n"))
      .then(() => setCopied(true))
      .catch(() => setError("Clipboard write failed — select the lines and copy manually."));
  }, [saved]);

  return (
    <div className="forge">
      <div className="forge-head">
        <h3>Asset Forge</h3>
        <button onClick={onClose} title="Close">
          ×
        </button>
      </div>

      {statusError && <div className="errbox">{statusError}</div>}
      {status && !keyReady && (
        <div className="warnbox">
          No ElevenLabs key. Copy <code>apps/realmsmith/.env.example</code> to{" "}
          <code>.env.local</code>, add <code>ELEVENLABS_API_KEY</code>, and restart the dev server.
        </div>
      )}

      <label>
        Asset type
        <select value="sfx" disabled title="More types land with the icon pass (asset-forge.md)">
          {(status?.types ?? [{ id: "sfx", label: "Sound effect (one-shot)" }]).map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Describe the sound
        <textarea
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="a heavy sword striking a wooden shield"
          rows={2}
        />
      </label>

      <button
        onClick={expand}
        disabled={busy !== null || !subject.trim() || !expandReady}
        title={
          expandReady
            ? "An LLM rewrites the sentence into proper SFX prompt-craft (sources, textures, shape)"
            : "Needs OPENAI_API_KEY in apps/realmsmith/.env.local"
        }
      >
        {busy === "expand" ? "Expanding…" : "✨ Expand into a crafted prompt"}
      </button>

      <label>
        Prompt (sent verbatim; blank = built from the sentence)
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="dozens of chitinous spider legs skittering over stone as a nest collapses…"
          rows={4}
        />
      </label>

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

      <button
        className="primary"
        onClick={generate}
        disabled={busy !== null || !subject.trim() || !keyReady}
      >
        {busy === "generate" ? "Generating… (a few seconds per take)" : "Generate 3 takes"}
      </button>

      {takes.length > 0 && (
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

      {saved && (
        <div className="okbox">
          <div>
            Saved <strong>{saved.files.join(", ")}</strong> (trimmed + loudness-normalized).
          </div>
          <div>Paste into src/game/audio/manifest.ts:</div>
          <pre>{saved.manifestLines.join("\n")}</pre>
          <button onClick={copyLines}>{copied ? "Copied ✓" : "Copy manifest lines"}</button>
        </div>
      )}

      {error && <div className="errbox">{error}</div>}
    </div>
  );
};
