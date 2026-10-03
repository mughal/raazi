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

export const composerShadeIds = [
  "mist",
  "ivory",
  "mint",
  "sky",
  "lavender",
] as const;
export type ComposerShadeId = (typeof composerShadeIds)[number];
export const composerSizeIds = ["compact", "comfortable", "spacious"] as const;
export type ComposerSizeId = (typeof composerSizeIds)[number];
export const composerSizes: { id: ComposerSizeId; label: string }[] = [
  { id: "compact", label: "Compact" },
  { id: "comfortable", label: "Comfortable" },
  { id: "spacious", label: "Spacious" },
];
export interface Appearance {
  palette: PaletteId;
  composer_shade: ComposerShadeId;
  composer_size: ComposerSizeId;
}
export const composerShades: { id: ComposerShadeId; label: string }[] = [
  { id: "mist", label: "Mist" },
  { id: "ivory", label: "Ivory" },
  { id: "mint", label: "Mint" },
  { id: "sky", label: "Sky" },
  { id: "lavender", label: "Lavender" },
];
