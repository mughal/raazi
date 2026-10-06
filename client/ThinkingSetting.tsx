import { Field } from "./ui";
import type { ThinkingControl } from "../shared/thinking";

export function ThinkingSetting({
  name = "thinking_control",
  value = "none",
}: {
  name?: string;
  value?: ThinkingControl;
}) {
  return (
    <Field label="Thinking control">
      <select aria-label="Thinking control" name={name} defaultValue={value}>
        <option value="none">Unavailable / engine default</option>
        <option value="enable_thinking">
          Switchable (vLLM / Qwen: enable_thinking)
        </option>
        <option value="thinking">Switchable (chat template: thinking)</option>
      </select>
      <small>
        Select only a control supported by this model and endpoint. The composer
        switch starts off.
      </small>
    </Field>
  );
}
