import { useState } from "react";
import {
  palettes,
  composerShades,
  composerSizes,
  type Appearance,
} from "../shared/palettes";
import { api } from "./api";
export function PaletteSettings({
  palette,
  composer_shade,
  composer_size,
  onSaved,
}: Appearance & { onSaved: (appearance: Appearance) => void }) {
  const [pending, setPending] = useState<Partial<Appearance> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const selected = pending?.palette ?? palette,
    shade = pending?.composer_shade ?? composer_shade,
    size = pending?.composer_size ?? composer_size;
  async function save(value: Partial<Appearance>) {
    setPending(value);
    setBusy(true);
    setError("");
    try {
      onSaved(await api<Appearance>("/api/preferences", "PUT", value));
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
      <p>
        Choose your workspace colors, composer shade, and composer size. Your
        choice follows your account.
      </p>
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
                onChange={() => void save({ palette: p.id })}
              />
              <span className="palette-swatch" aria-hidden="true" />
              <span>{p.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Composer shade</legend>
        <div className="palette-grid">
          {composerShades.map((s) => (
            <label
              className={
                "palette-option shade-option " +
                (shade === s.id ? "selected" : "")
              }
              data-composer-shade={s.id}
              key={s.id}
            >
              <input
                type="radio"
                name="composer-shade"
                value={s.id}
                checked={shade === s.id}
                onChange={() => void save({ composer_shade: s.id })}
              />
              <span className="shade-swatch" aria-hidden="true" />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        <legend>Composer size</legend>
        <div className="palette-grid">
          {composerSizes.map((s) => (
            <label
              key={s.id}
              className={"palette-option " + (size === s.id ? "selected" : "")}
            >
              <input
                type="radio"
                name="composer-size"
                value={s.id}
                checked={size === s.id}
                onChange={() => void save({ composer_size: s.id })}
              />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
        <p className="help">
          Compact uses about half the previous height. Choose more room for
          longer questions.
        </p>
      </fieldset>
      <div
        className="composer-preview"
        data-composer-shade={shade}
        data-composer-size={size}
        aria-label="Composer shade preview"
      >
        <span>Ask Raazi anything about your work…</span>
        <div>
          <span>+</span>
          <span className="preview-send" aria-hidden="true">
            ↑
          </span>
        </div>
      </div>
      {busy && <p role="status">Saving colors…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
