export const paletteIds = [
  "forest",
  "ocean",
  "indigo",
  "plum",
  "amber",
  "slate",
] as const;
export type PaletteId = (typeof paletteIds)[number];
export const palettes: { id: PaletteId; label: string }[] = [
  { id: "forest", label: "Forest" },
  { id: "ocean", label: "Ocean" },
  { id: "indigo", label: "Indigo" },
  { id: "plum", label: "Plum" },
  { id: "amber", label: "Amber" },
  { id: "slate", label: "Slate" },
];
