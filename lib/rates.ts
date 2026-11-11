// small sample table, not the full HTS
export type Program = "BASE" | "IEEPA_FENTANYL" | "IEEPA_RECIPROCAL" | "S301" | "S232" | "EXEMPTION";

export interface Ch99Rule {
  program: Program;
  label: string;
  refundable: boolean;
  rate: (ctx: { origin: string; entryDate: string }) => number;
}

export const BASE_RATES: Record<string, { rate: number; s232?: "steel" | "aluminum" }> = {
  "8516.71.0020": { rate: 3.7 },
  "4202.92.3131": { rate: 17.6 },
  "7318.15.2065": { rate: 0, s232: "steel" },
  "9403.60.8081": { rate: 0 },
  "6109.10.0012": { rate: 16.5 },
  "7616.99.5190": { rate: 2.5, s232: "aluminum" },
};

// 20% -> 10% on this date
export const FENTANYL_STEP_DOWN = "2025-11-10";

export const CH99: Record<string, Ch99Rule> = {
  "9903.01.24": {
    program: "IEEPA_FENTANYL",
    label: "IEEPA fentanyl (China)",
    refundable: true,
    rate: ({ origin, entryDate }) => (origin !== "CN" ? 0 : entryDate >= FENTANYL_STEP_DOWN ? 10 : 20),
  },
  "9903.01.25": {
    program: "IEEPA_RECIPROCAL",
    label: "IEEPA reciprocal (baseline)",
    refundable: true,
    rate: () => 10,
  },
  "9903.02.69": {
    program: "IEEPA_RECIPROCAL",
    label: "IEEPA reciprocal (Vietnam)",
    refundable: true,
    rate: ({ origin }) => (origin === "VN" ? 20 : 0),
  },
  "9903.01.33": {
    program: "EXEMPTION",
    label: "Reciprocal exemption for Section 232 articles",
    refundable: false,
    rate: () => 0,
  },
  "9903.88.03": { program: "S301", label: "Section 301 List 3", refundable: false, rate: () => 25 },
  "9903.88.15": { program: "S301", label: "Section 301 List 4A", refundable: false, rate: () => 7.5 },
  "9903.81.90": { program: "S232", label: "Section 232 steel derivatives", refundable: false, rate: () => 50 },
  "9903.85.08": { program: "S232", label: "Section 232 aluminum derivatives", refundable: false, rate: () => 50 },
};

export const MPF = { ratePct: 0.3464, min: 33.58, max: 651.5 };
export const HMF_RATE_PCT = 0.125;

// simplified: liquidates ~314 days after entry, 80 days to claim after that
export const LIQUIDATION_DAYS = 314;
export const CLAIM_WINDOW_DAYS = 80;
export const PROTEST_WINDOW_DAYS = 180;

export const CAPE_MAX_ENTRIES = 9999;

export const APPROVAL_THRESHOLD = 5000;
