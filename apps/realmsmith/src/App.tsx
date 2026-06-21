import { Viewport } from "./viewport/Viewport";

export const App = () => (
  <div className="app">
    <div className="toolbar">
      <span className="title">Realmsmith</span>
      <span className="muted">realm-00 · read-only (M1)</span>
      <span className="spacer" />
      <span className="muted">Canvas2D · @heroic/core</span>
    </div>
    <Viewport />
  </div>
);
