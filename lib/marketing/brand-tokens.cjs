/** 30grow identity. Source for CSS, Tailwind, exports and generated app icons. */
const GROW = {
  primary: '#22C55E', primaryHover: '#16A34A', teal: '#14B8A6', navy: '#111827',
  background: '#F8FAFC', surface: '#FFFFFF', border: '#E5E7EB', inputBorder: '#D1D5DB',
  textPrimary: '#111827', textSecondary: '#5A6980', textMuted: '#94A3B8',
  // White on Grow green is only 2.28:1. These action tones exceed AA for small text.
  action: '#15803D', actionHover: '#166534', onAction: '#FFFFFF',
};
const GREEN = {50:'#F0FDF4',100:'#DCFCE7',200:'#BBF7D0',300:'#86EFAC',400:'#4ADE80',500:GROW.primary,600:GROW.primaryHover,700:GROW.action,800:GROW.actionHover,900:'#14532D'};
const FONT_UI = "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const SHADOWS = {card:'0 1px 2px rgb(17 24 39 / 0.04)', dialog:'0 16px 48px rgb(17 24 39 / 0.14)', toast:'0 8px 24px rgb(17 24 39 / 0.10)', menu:'0 8px 24px rgb(17 24 39 / 0.08)'};
// Official vectors from the 30grow brand kit. Symbol viewBox 140x110, full logo 368x114 (same coordinates).
const LOGO_PATHS = {
  three: 'M 10,17 L 57,17 Q 60,17 60,20 L 60,29 Q 60,31 58,33 L 41,49 C 54,50 63,58 63,70 C 63,85 51,95 34,95 C 18,95 7,86 4,74 L 19,70 C 21,77 26,81 34,81 C 42,81 47,77 47,71 C 47,64 41,61 29,61 L 24,53 L 44,32 L 10,32 Q 8,32 8,30 L 8,19 Q 8,17 10,17 Z',
  zero: 'M 76,83 C 67,76 64,66 65,55 C 66,32 81,16 100,16 C 121,16 135,31 135,54 C 135,78 120,95 100,95 C 92,95 86,93 81,90 L 111,60 L 111,69 Q 111,72 114,72 L 120,72 Q 123,72 123,69 L 123,40 Q 123,37 120,37 L 91,37 Q 88,37 88,40 L 88,46 Q 88,49 91,49 L 101,49 Z',
  grow: [
    'M 194,37 L 194,78 C 194,95 184,104 170,104 C 159,104 151,99 147,92 L 155,86 C 158,91 163,95 170,95 C 179,95 184,90 184,81 L 184,78 C 180,82 175,84 168,84 C 155,84 145,74 145,60 C 145,46 155,36 168,36 C 175,36 180,38 184,42 L 184,37 Z M 184,60 C 184,51 178,46 170,46 C 161,46 155,51 155,60 C 155,69 161,75 170,75 C 178,75 184,69 184,60 Z',
    'M 202,83 L 202,55 C 202,43 210,36 223,36 L 230,36 L 230,46 L 224,46 C 216,46 212,49 212,57 L 212,83 Z',
    'M 258,36 C 272,36 283,46 283,60 C 283,74 272,84 258,84 C 244,84 233,74 233,60 C 233,46 244,36 258,36 Z M 258,46 C 249,46 243,52 243,60 C 243,68 249,74 258,74 C 267,74 273,68 273,60 C 273,52 267,46 258,46 Z',
    'M 284,37 L 295,37 L 306,69 L 317,37 L 327,37 L 338,69 L 349,37 L 360,37 L 343,83 L 333,83 L 322,53 L 311,83 L 301,83 Z',
  ],
};
module.exports = { GROW, GREEN, FONT_UI, SHADOWS, LOGO_PATHS };
