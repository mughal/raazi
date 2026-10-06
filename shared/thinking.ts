export type ThinkingControl = "none" | "enable_thinking" | "thinking";

/** Separate explicitly marked model reasoning; leave ordinary prose and code intact. */
export function splitThinking(content: string, reasoning = "") {
  const thoughts: string[] = reasoning.trim() ? [reasoning.trim()] : [];
  let answer = content;
  // Some chat templates prefill <think>, so generated content includes only its
  // closing delimiter. Accept a standalone closing line, never a code example.
  if (!/^\s*<think>/i.test(answer)) {
    const closing = /(?:^|\n)[ \t]*<\/think>[ \t]*(?:\r?\n|$)/i.exec(answer);
    if (closing) {
      const prefix = answer.slice(0, closing.index);
      const fences = prefix.match(/^\s*(?:```|~~~)/gm) ?? [];
      if (fences.length % 2 === 0) {
        const thought = prefix.trim();
        if (thought && !thoughts.includes(thought)) thoughts.push(thought);
        answer = answer.slice(closing.index + closing[0].length).trimStart();
      }
    }
  }
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
