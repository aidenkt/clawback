import { z } from "zod";

export const TariffComponent = z.object({
  code: z.string().describe("HTS or Chapter 99 number exactly as printed, e.g. 9903.01.24"),
  description: z.string().describe("Short label as printed next to the code"),
  ratePct: z.number().describe("Ad valorem rate printed, in percent. 0 if Free."),
  dutyFiled: z.number().describe("Duty amount in USD printed for this code on the CBP 7501"),
  page: z.number().int().describe("1-based page number where this row is printed"),
  quote: z.string().describe("The exact text of the row, copied verbatim"),
});

export const EntryLine = z.object({
  lineNo: z.number().int(),
  description: z.string(),
  hts: z.string().describe("The 10-digit merchandise HTS number, e.g. 8516.71.0020"),
  origin: z.string().describe("ISO country code of origin, e.g. CN"),
  enteredValue: z.number().describe("Entered value in USD"),
  page: z.number().int(),
  tariffs: z.array(TariffComponent).describe("Every duty row for this line, including the base HTS rate and each Chapter 99 number"),
});

export const InvoiceCharge = z.object({
  label: z.string(),
  kind: z.enum(["duty", "mpf", "hmf", "brokerage", "other"]),
  amount: z.number(),
  page: z.number().int(),
  quote: z.string(),
});

export const Extraction = z.object({
  broker: z.object({
    name: z.string(),
    invoiceNumber: z.string(),
    invoiceDate: z.string().describe("YYYY-MM-DD"),
    dueDate: z.string().describe("YYYY-MM-DD"),
  }),
  importer: z.object({ name: z.string(), importerNumber: z.string() }),
  entry: z.object({
    entryNumber: z.string(),
    entryDate: z.string().describe("YYYY-MM-DD"),
    port: z.string(),
    mode: z.enum(["ocean", "air", "truck", "rail"]),
  }),
  lines: z.array(EntryLine),
  cbp: z.object({
    totalDuty: z.number().describe("Total duty on the 7501"),
    mpf: z.number().describe("Merchandise processing fee on the 7501"),
    hmf: z.number().describe("Harbor maintenance fee on the 7501, 0 if none"),
    page: z.number().int(),
  }),
  invoice: z.object({
    charges: z.array(InvoiceCharge).describe("Every charge row on the broker invoice, in order, including repeats"),
    total: z.number(),
    page: z.number().int(),
  }),
});

export type Extraction = z.infer<typeof Extraction>;
export type EntryLine = z.infer<typeof EntryLine>;
export type TariffComponent = z.infer<typeof TariffComponent>;

export type FindingKind =
  | "REFUNDABLE_IEEPA"
  | "STACKING"
  | "WRONG_RATE"
  | "BROKER_OVERBILL"
  | "FEE_OVER_CAP"
  | "DUPLICATE_CHARGE"
  | "MATH";

export type Recovery = "CAPE_CLAIM" | "BROKER_DISPUTE";

export interface Finding {
  id: string;
  kind: FindingKind;
  recovery: Recovery;
  title: string;
  detail: string;
  amount: number;
  page: number;
  quote: string;
  lineNo?: number;
  code?: string;
}

export interface ComponentAudit {
  code: string;
  description: string;
  program: string;
  filedRate: number;
  filedAmount: number;
  correctRate: number;
  correctAmount: number;
  refundable: boolean;
  status: "ok" | "refundable" | "error";
  note?: string;
  page: number;
  quote: string;
}

export interface LineAudit {
  lineNo: number;
  description: string;
  hts: string;
  origin: string;
  enteredValue: number;
  page: number;
  components: ComponentAudit[];
}

export interface Audit {
  lines: LineAudit[];
  findings: Finding[];
  dutyFiled: number;
  dutyCorrect: number;
  refundable: number;
  disputable: number;
  recommendHold: boolean;
  needsApproval: boolean;
  clock: Clock;
}

export interface Clock {
  entryDate: string;
  liquidationDate: string;
  deadline: string;
  daysLeft: number;
  status: "open" | "urgent" | "expired";
  route: string;
}
