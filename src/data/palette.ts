import type { BlobConfig, ColorPalette, MeshConfig, PaletteColor } from "../types";

export const paletteGroups: ColorPalette[] = [
  {
    colors: [
      { name: "Deep", value: "#01151e" },
      { name: "Slate", value: "#2f3a61" },
      { name: "Denim", value: "#3a4572" },
      { name: "Violet", value: "#897fd4" },
      { name: "Ink", value: "#03080f" },
      { name: "Navy", value: "#171d35" },
      { name: "Blue", value: "#5666cf" },
      { name: "Lilac", value: "#a681f4" },
      { name: "Acid", value: "#bbff00" },
      { name: "Mist", value: "#f0f7b3" },
      { name: "Paper", value: "#eeeeee" },
    ],
    id: "Outcraft Saturated",
    name: "Outcraft Saturated",
  },
  {
    colors: [
      { name: "Deep Navy", value: "#2a3b53" },
      { name: "Muted Violet Blue", value: "#66647f" },
      { name: "Soft Blue", value: "#7c88ab" },
      { name: "Light Desaturated Blue", value: "#9ea9c4" },
      { name: "Very Light Blue Grey", value: "#babed1" },
      { name: "Warm Pale Grey", value: "#dfd7da" },
    ],
    id: "Outcraft Soft",
    name: "Outcraft Soft",
  },
];

export const paletteColors: PaletteColor[] = paletteGroups[0].colors;

export const initialBackgroundColor = "#01151e";
export const fixedGrainMixer = 0.05;
export const fixedGrainOverlay = 0;

export const initialMesh: MeshConfig = {
  distortion: 0.58,
  frame: 428834.2979991424,
  grainMixer: fixedGrainMixer,
  grainOverlay: fixedGrainOverlay,
  motionBlur: 0,
  scale: 1.21,
  speed: 0.78,
  swirl: 0.1,
};

export const initialBlobs: BlobConfig[] = [
  {
    bend: 0.12,
    color: "#2f3a61",
    id: "blob-a",
    name: "Anchor 1",
    opacity: 0.92,
    rotation: -0.22,
    size: 0.42,
    stretch: 1.2,
    taper: 0.08,
    x: 0.34,
    y: 0.64,
  },
  {
    bend: -0.18,
    color: "#3a4572",
    id: "blob-b",
    name: "Anchor 2",
    opacity: 0.86,
    rotation: 0.48,
    size: 0.36,
    stretch: 1.08,
    taper: -0.12,
    x: 0.68,
    y: 0.42,
  },
  {
    bend: 0.24,
    color: "#897fd4",
    id: "blob-c",
    name: "Anchor 3",
    opacity: 0.78,
    rotation: -0.88,
    size: 0.32,
    stretch: 1.42,
    taper: 0.18,
    x: 0.58,
    y: 0.22,
  },
];
