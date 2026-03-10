/**
 * Vesta Design System — Pastel Palette
 *
 * Inspired by Claude, ChatGPT, Gemini & Cursor.
 * Warm, hearth-inspired pastels (Pantone references in comments).
 */

export const colors = {
  // ── Backgrounds ──────────────────────────────────
  bg:              "#F8F5F1",   // Warm cream          (Pantone 11-0604 Gardenia)
  surface:         "#FFFFFF",   // Cards, header, input
  surfaceMuted:    "#F0EBE3",   // Assistant bubbles   (Pantone 12-0704 White Smoke)
  surfaceHover:    "#EAE4DA",   // Pressed states

  // ── User messages ───────────────────────────────
  userBubble:      "#C4916E",   // Warm terracotta     (Pantone 16-1327 Toasted Nut)
  userBubbleLight: "#D4A889",   // Lighter variant
  userText:        "#FFFFFF",

  // ── Assistant messages ──────────────────────────
  assistantBubble: "#F0EBE3",   // Warm sand
  assistantText:   "#3D3529",   // Deep warm brown

  // ── Accent (hearth/fire) ────────────────────────
  accent:          "#C07A56",   // Terracotta          (Pantone 16-1429 Sunburn)
  accentSoft:      "#E8CEBE",   // Light terracotta    (Pantone 13-1108 Cream Tan)
  accentMuted:     "#F3E5DA",   // Very light accent bg

  // ── Semantic ────────────────────────────────────
  success:         "#8DAE92",   // Sage green          (Pantone 15-6316 Fair Green)
  successBg:       "rgba(141,174,146,0.12)",
  error:           "#C9736A",   // Soft coral           (Pantone 16-1526 Terra Cotta Rose)
  errorBg:         "rgba(201,115,106,0.10)",
  info:            "#8BA7BE",   // Steel blue pastel   (Pantone 15-4312 Dusty Blue)

  // ── Text ────────────────────────────────────────
  textPrimary:     "#2C2620",   // Near black, warm
  textSecondary:   "#7A7168",   // Warm medium gray
  textMuted:       "#A89E94",   // Warm light gray
  textPlaceholder: "#C4BAB0",   // Subtle

  // ── Borders & Dividers ──────────────────────────
  border:          "#E5DED5",   // Warm border
  borderLight:     "#F0EBE3",   // Subtle divider
  divider:         "rgba(0,0,0,0.06)",

  // ── Misc ────────────────────────────────────────
  disabled:        "#D5CEC5",
  overlay:         "rgba(44,38,32,0.4)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 22,
  full: 999,
} as const;

export const typography = {
  body: {
    fontSize: 15.5,
    lineHeight: 23,
  },
  bodySmall: {
    fontSize: 13,
    lineHeight: 19,
  },
  caption: {
    fontSize: 12,
    lineHeight: 16,
  },
  heading: {
    fontSize: 28,
    fontWeight: "700" as const,
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600" as const,
    letterSpacing: 1.2,
    textTransform: "uppercase" as const,
  },
  button: {
    fontSize: 14,
    fontWeight: "600" as const,
  },
} as const;
