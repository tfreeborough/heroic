import type { Tool } from "./Board";

const TOOLS: { tool: Tool; key: string; label: string; icon: string }[] = [
  { tool: "select", key: "V", label: "Select", icon: "M4 2 L4 18 L8.5 13.5 L11 20 L13.5 19 L11 12.5 L17 12.5 Z" },
  { tool: "hand", key: "H", label: "Hand (or hold Space)", icon: "M7 11 V4 a1.5 1.5 0 0 1 3 0 V10 M10 9 V3 a1.5 1.5 0 0 1 3 0 V10 M13 10 V5 a1.5 1.5 0 0 1 3 0 V12 M7 11 L5 9 a1.5 1.5 0 0 0 -2.5 1.5 L7 16 a6 6 0 0 0 9 2 V12" },
  { tool: "pen", key: "P", label: "Pen", icon: "M3 17 L5 12 L14 3 L17 6 L8 15 Z M5 12 L8 15" },
  { tool: "rect", key: "R", label: "Rectangle", icon: "M3 4 H17 V16 H3 Z" },
  { tool: "ellipse", key: "O", label: "Ellipse", icon: "M10 3 a7 7 0 1 0 0.01 0 Z" },
  { tool: "diamond", key: "D", label: "Diamond", icon: "M10 2 L18 10 L10 18 L2 10 Z" },
  { tool: "arrow", key: "A", label: "Arrow", icon: "M3 17 L17 3 M9 3 H17 V11" },
  { tool: "line", key: "L", label: "Line", icon: "M3 17 L17 3" },
  { tool: "text", key: "T", label: "Text", icon: "M4 4 H16 M10 4 V17 M7 17 H13" },
  { tool: "frame", key: "F", label: "Frame (what the clip shows)", icon: "M6 2 V18 M14 2 V18 M2 6 H18 M2 14 H18" },
  { tool: "eraser", key: "E", label: "Eraser", icon: "M3 13 L11 5 L17 11 L11 17 H7 Z M7 17 L3 13" },
];

export const Toolbar = ({ tool, setTool, locked, setLocked, stampsOpen, toggleStamps }: { tool: Tool; setTool: (t: Tool) => void; locked: boolean; setLocked: (b: boolean) => void; stampsOpen: boolean; toggleStamps: () => void }) => (
  <div className="toolbar">
    <button className={`tool ${locked ? "on" : ""}`} title={locked ? "The tool stays after each draw (Q to go back to select after each one)" : "Back to select after each draw (Q to keep the tool)"} onClick={() => setLocked(!locked)}>
      <svg viewBox="0 0 20 20"><path d={locked ? "M5 9 V6 a5 5 0 0 1 10 0 V9 M4 9 H16 V18 H4 Z" : "M5 9 V6 a5 5 0 0 1 9.5 -2 M4 9 H16 V18 H4 Z"} /></svg>
    </button>
    <span className="sep" />
    {TOOLS.map((t) => (
      <button key={t.tool} className={`tool ${tool === t.tool ? "on" : ""}`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.tool)}>
        <svg viewBox="0 0 20 20"><path d={t.icon} /></svg>
        <small>{t.key}</small>
      </button>
    ))}
    <span className="sep" />
    <button className={`tool ${stampsOpen || tool === "stamp" ? "on" : ""}`} title="Stamps: the game's art and diagram pictures (S)" onClick={toggleStamps}>
      <svg viewBox="0 0 20 20"><path d="M10 2 L12.4 7.2 L18 7.8 L13.8 11.6 L15 17.2 L10 14.4 L5 17.2 L6.2 11.6 L2 7.8 L7.6 7.2 Z" /></svg>
      <small>S</small>
    </button>
  </div>
);
