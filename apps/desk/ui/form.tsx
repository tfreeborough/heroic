/**
 * A form straight from a template's zod schema — so a new prop on a
 * template is a new field here with no Desk change. Reads zod v4's
 * internals: string / number / boolean / enum, optionally wrapped in
 * optional / default.
 */
import type * as React from "react";
import { useEffect, useRef } from "react";
import type { ZodObject, ZodType } from "zod";

type Def = { type: string; innerType?: ZodType; entries?: Record<string, string>; defaultValue?: unknown };
const def = (t: ZodType): Def => (t as unknown as { _zod: { def: Def } })._zod.def;
const describe = (t: ZodType): string | undefined => (t as unknown as { description?: string }).description;

export type FieldSpec = { key: string; kind: "string" | "number" | "boolean" | "enum"; options?: string[]; hint?: string; optional: boolean };

export const fieldsOf = (schema: ZodObject): FieldSpec[] =>
  Object.entries(schema.shape as Record<string, ZodType>).map(([key, t]) => {
    let hint = describe(t);
    let optional = false;
    let d = def(t);
    while ((d.type === "optional" || d.type === "default" || d.type === "nullable") && d.innerType) {
      optional = true;
      hint ??= describe(d.innerType);
      d = def(d.innerType);
    }
    if (d.type === "enum") return { key, kind: "enum", options: Object.values(d.entries ?? {}), hint, optional };
    if (d.type === "number") return { key, kind: "number", hint, optional };
    if (d.type === "boolean") return { key, kind: "boolean", hint, optional };
    return { key, kind: "string", hint, optional };
  });

export const SchemaForm: React.FC<{
  schema: ZodObject;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Fields the screen handles itself (clip picker, format chips…). */
  hide?: string[];
  /** Replace a field's control with a select (e.g. an id from the roster). */
  options?: Record<string, { value: string; label: string }[]>;
}> = ({ schema, value, onChange, hide = [], options = {} }) => {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className="fields">
      {fieldsOf(schema)
        .filter((f) => !hide.includes(f.key))
        .map((f) => {
          const v = value[f.key];
          const wide = f.kind === "string" && !options[f.key] && !f.optional;
          if (f.kind === "boolean") {
            return (
              <div key={f.key} className="field inline">
                <input type="checkbox" checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} />
                <label title={f.hint}>{f.key}</label>
              </div>
            );
          }
          const opts = options[f.key] ?? (f.kind === "enum" ? f.options!.map((o) => ({ value: o, label: o })) : null);
          return (
            <div key={f.key} className={`field${wide ? " wide" : ""}`}>
              <label>{f.key}</label>
              {opts ? (
                <select value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)}>
                  {f.optional ? <option value="">—</option> : null}
                  {opts.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.kind === "number" ? (
                <input type="number" step="any" value={v === undefined || v === null ? "" : String(v)} onChange={(e) => set(f.key, e.target.value === "" ? undefined : Number(e.target.value))} />
              ) : (
                <input type="text" value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />
              )}
              {f.hint ? <div className="hint">{f.hint}</div> : null}
            </div>
          );
        })}
    </div>
  );
};

/** A variant field's value as rows: the list the Desk keeps, or a single
 * string (a re-opened batch's render, or a template default). */
export const listOf = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.length ? v.map(String) : [""];
  return [typeof v === "string" ? v : ""];
};

/**
 * Alternatives added one line at a time (hooks to test against each other):
 * Enter adds a row below, Backspace on an empty row removes it, × drops one.
 */
export const VariantList: React.FC<{
  label: string;
  rows: string[];
  placeholder?: string;
  onChange: (rows: string[]) => void;
  onFocusRow?: (i: number) => void;
}> = ({ label, rows, placeholder, onChange, onFocusRow }) => {
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusNext = useRef<number | null>(null);
  useEffect(() => {
    if (focusNext.current === null) return;
    inputs.current[focusNext.current]?.focus();
    focusNext.current = null;
  });
  const set = (i: number, v: string) => onChange(rows.map((r, j) => (j === i ? v : r)));
  const add = (at: number) => {
    focusNext.current = at;
    onChange([...rows.slice(0, at), "", ...rows.slice(at)]);
  };
  const remove = (i: number) => {
    const next = rows.filter((_, j) => j !== i);
    focusNext.current = Math.max(0, i - 1);
    onChange(next.length ? next : [""]);
  };
  const filled = rows.filter((r) => r.trim()).length;
  return (
    <div className="field variants">
      <label>{label}</label>
      {rows.map((r, i) => (
        <div className="row variant" key={i}>
          <span className="small muted mono">{i + 1}</span>
          <input
            ref={(el) => {
              inputs.current[i] = el;
            }}
            type="text"
            value={r}
            placeholder={i === 0 ? placeholder : "another one to test"}
            onChange={(e) => set(i, e.target.value)}
            onFocus={() => onFocusRow?.(i)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(i + 1);
              } else if (e.key === "Backspace" && r === "" && rows.length > 1) {
                e.preventDefault();
                remove(i);
              }
            }}
          />
          {rows.length > 1 ? (
            <button className="ghost small" title="Remove" onClick={() => remove(i)}>
              ×
            </button>
          ) : null}
        </div>
      ))}
      <div className="row">
        <button className="ghost small" onClick={() => add(rows.length)}>
          + Add another
        </button>
        <span className="hint">{filled > 1 ? `${filled} ${label}: one press renders each as its own video` : "Add more to test them against each other: each renders as its own video"}</span>
      </div>
    </div>
  );
};
