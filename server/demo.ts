/** Static sample text for local layout testing. Never sent to a model. */
const ipsum =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae velit sed ipsum feugiat consequat. Praesent at urna id augue luctus malesuada. Sed posuere, justo et feugiat volutpat, neque eros dictum libero, vitae consequat orci lorem non sem.";
export const demoAnswer = [
  "## Demo response",
  "> Sample text for layout testing only. No model was called. This is not an answer to your question. Documents and images were not analyzed.",
  "Use this long reply to test scrolling. The composer should stay visible while you read earlier messages.",
  ...Array.from(
    { length: 8 },
    (_, index) =>
      "### Sample section " + (index + 1) + "\n\n" + ipsum + "\n\n" + ipsum,
  ),
  "### Example checklist\n\n- Scroll up to the question.\n- Keep the composer visible.\n- Send another message.\n- Open this chat from history.",
  "| Layout item | Expected behavior |\n| --- | --- |\n| Messages | Scroll above the composer |\n| Composer | Stays at the bottom |\n| Chat history | Saves the demo exchange |",
  "**End of demo response.** Configure a model in Administration for real answers.",
].join("\n\n");
