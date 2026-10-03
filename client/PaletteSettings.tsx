import { useState } from "react";
import { palettes, type PaletteId } from "../shared/palettes";
import { api } from "./api";
export function PaletteSettings({
  palette,
  onSaved,
}: {
  palette: PaletteId;
  onSaved: (palette: PaletteId) => void;
}) {
  const [pending, setPending] = useState<PaletteId | null>(null);
  const selected = pending ?? palette;
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(value: PaletteId) {
    setPending(value);
    setBusy(true);
    setError("");
    try {
      const result = await api<{ palette: PaletteId }>(
        "/api/preferences",
        "PUT",
        { palette: value },
      );
      onSaved(result.palette);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }
  return (
    <section className="card palette-settings">
      <h3>Color palette</h3>
      <p>Choose your workspace colors. Your choice follows your account.</p>
      <fieldset disabled={busy}>
        <legend>Workspace color palette</legend>
        <div className="palette-grid">
          {palettes.map((p) => (
            <label
              className={
                "palette-option " + (selected === p.id ? "selected" : "")
              }
              data-palette={p.id}
              key={p.id}
            >
              <input
                type="radio"
                name="palette"
                value={p.id}
                checked={selected === p.id}
                onChange={() => void save(p.id)}
              />
              <span className="palette-swatch" aria-hidden="true" />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {busy && <p role="status">Saving colors…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
