export type ThinkingControl = "none" | "enable_thinking" | "thinking";

/** Separate explicitly marked model reasoning; leave ordinary prose and code intact. */
export function splitThinking(content: string, reasoning = "") {
  const thoughts: string[] = reasoning.trim() ? [reasoning.trim()] : [];
  let answer = content;
  while (/^\s*<think>/i.test(answer)) {
    const opening = answer.match(/^\s*<think>/i)![0];
    const closing = answer.toLowerCase().indexOf("</think>", opening.length);
    if (closing < 0) {
      thoughts.push(answer.slice(opening.length).trim());
      answer = "";
      break;
    }
    const thought = answer.slice(opening.length, closing).trim();
    if (thought && !thoughts.includes(thought)) thoughts.push(thought);
    answer = answer.slice(closing + 8).trimStart();
  }
  return { content: answer, reasoning: thoughts.filter(Boolean).join("\n\n") };
}

export function thinkingParameters(control: ThinkingControl, enabled: boolean) {
  return control === "none"
    ? {}
    : { chat_template_kwargs: { [control]: enabled } };
}
