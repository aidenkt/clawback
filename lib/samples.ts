import type { Extraction } from "./types";


// fake broker packets. also the ground truth for the eval
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

type T = [code: string, description: string, ratePct: number, dutyOverride?: number];
interface LineSpec {
  description: string;
  hts: string;
  origin: string;
  value: number;
  tariffs: T[];
}
interface Spec {
  id: string;
  broker: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  entryNumber: string;
  entryDate: string;
  port: string;
  mode: "ocean" | "air";
  lines: LineSpec[];
  billedDuty?: number;
  billedMpf?: number;
  brokerage: [label: string, amount: number][];
}

const IMPORTER = { name: "Northgate Home Goods, Inc.", importerNumber: "84-2917465-00" };

export const rateText = (ratePct: number) => (ratePct === 0 ? "Free" : `${ratePct}%`);
export const tariffQuote = (code: string, description: string, ratePct: number, duty: number) =>
  `${code}  ${description}  ${rateText(ratePct)}  $${money(duty)}`;
export const chargeQuote = (label: string, amount: number) => `${label}  $${money(amount)}`;

function build(s: Spec): Extraction {
  const lines = s.lines.map((l, i) => ({
    lineNo: i + 1,
    description: l.description,
    hts: l.hts,
    origin: l.origin,
    enteredValue: l.value,
    page: 2,
    tariffs: l.tariffs.map(([code, description, ratePct, override]) => {
      const dutyFiled = override ?? r2((l.value * ratePct) / 100);
      return { code, description, ratePct, dutyFiled, page: 2, quote: tariffQuote(code, description, ratePct, dutyFiled) };
    }),
  }));
  const totalValue = s.lines.reduce((a, l) => a + l.value, 0);
  const totalDuty = r2(lines.flatMap((l) => l.tariffs).reduce((a, t) => a + t.dutyFiled, 0));
  const mpf = r2(Math.min(651.5, Math.max(33.58, totalValue * 0.003464)));
  const hmf = s.mode === "ocean" ? r2(totalValue * 0.00125) : 0;

  const charges: Extraction["invoice"]["charges"] = [];
  const add = (label: string, kind: Extraction["invoice"]["charges"][number]["kind"], amount: number) =>
    charges.push({ label, kind, amount, page: 1, quote: chargeQuote(label, amount) });
  add("Customs duty advanced on your behalf", "duty", s.billedDuty ?? totalDuty);
  add("Merchandise processing fee (MPF)", "mpf", s.billedMpf ?? mpf);
  if (hmf) add("Harbor maintenance fee (HMF)", "hmf", hmf);
  for (const [label, amount] of s.brokerage) add(label, "brokerage", amount);

  return {
    broker: { name: s.broker, invoiceNumber: s.invoiceNumber, invoiceDate: s.invoiceDate, dueDate: s.dueDate },
    importer: IMPORTER,
    entry: { entryNumber: s.entryNumber, entryDate: s.entryDate, port: s.port, mode: s.mode },
    lines,
    cbp: { totalDuty, mpf, hmf, page: 2 },
    invoice: { charges, total: r2(charges.reduce((a, c) => a + c.amount, 0)), page: 1 },
  };
}

const PCB = "Pacific Crest Customs Brokerage";
const HBL = "Harborline Logistics LLC";

const SPECS: Spec[] = [
  {
    id: "pcb-48211",
    broker: PCB,
    invoiceNumber: "PCB-48211",
    invoiceDate: "2025-10-24",
    dueDate: "2025-11-23",
    entryNumber: "PC7-4821104-6",
    entryDate: "2025-10-20",
    port: "2704 Los Angeles, CA",
    mode: "ocean",
    lines: [
      {
        description: "Drip coffee makers, household",
        hts: "8516.71.0020",
        origin: "CN",
        value: 84200,
        tariffs: [
          ["8516.71.0020", "Coffee makers, general rate", 3.7],
          ["9903.88.15", "Section 301 List 4A", 7.5],
          ["9903.01.24", "IEEPA fentanyl (China)", 20],
          ["9903.01.25", "IEEPA reciprocal", 10],
        ],
      },
      {
        description: "Backpacks, man-made fiber",
        hts: "4202.92.3131",
        origin: "CN",
        value: 31500,
        tariffs: [
          ["4202.92.3131", "Backpacks, general rate", 17.6],
          ["9903.88.03", "Section 301 List 3", 25],
          ["9903.01.24", "IEEPA fentanyl (China)", 20],
          ["9903.01.25", "IEEPA reciprocal", 10],
        ],
      },
    ],
    brokerage: [["Entry filing fee", 185], ["ISF filing", 45]],
  },
  {
    id: "hbl-20931",
    broker: HBL,
    invoiceNumber: "HL-20931",
    invoiceDate: "2025-12-19",
    dueDate: "2026-01-18",
    entryNumber: "HB2-2093117-3",
    entryDate: "2025-12-15",
    port: "2809 San Francisco / Oakland, CA",
    mode: "ocean",
    lines: [
      {
        description: "Steel hex bolts and fasteners",
        hts: "7318.15.2065",
        origin: "CN",
        value: 52000,
        tariffs: [
          ["7318.15.2065", "Steel bolts, general rate", 0],
          ["9903.81.90", "Section 232 steel derivatives", 50],
          ["9903.88.03", "Section 301 List 3", 25],
          ["9903.01.24", "IEEPA fentanyl (China)", 10],
          ["9903.01.25", "IEEPA reciprocal", 10],
        ],
      },
      {
        description: "Wooden bedroom furniture",
        hts: "9403.60.8081",
        origin: "CN",
        value: 40000,
        tariffs: [
          ["9403.60.8081", "Wood furniture, general rate", 0],
          ["9903.88.03", "Section 301 List 3", 25],
          ["9903.01.24", "IEEPA fentanyl (China)", 10],
          ["9903.01.25", "IEEPA reciprocal", 10],
        ],
      },
    ],
    brokerage: [["Customs entry service", 165], ["ISF filing", 40]],
  },
  {
    id: "pcb-48390",
    broker: PCB,
    invoiceNumber: "PCB-48390",
    invoiceDate: "2026-01-27",
    dueDate: "2026-02-26",
    entryNumber: "PC7-4839002-1",
    entryDate: "2026-01-22",
    port: "2704 Los Angeles, CA",
    mode: "ocean",
    lines: [
      {
        description: "Backpacks, man-made fiber",
        hts: "4202.92.3131",
        origin: "CN",
        value: 60000,
        tariffs: [
          ["4202.92.3131", "Backpacks, general rate", 17.6],
          ["9903.88.03", "Section 301 List 3", 25],
          ["9903.01.24", "IEEPA fentanyl (China)", 20],
          ["9903.01.25", "IEEPA reciprocal", 10],
        ],
      },
    ],
    billedDuty: 45960,
    brokerage: [["Entry filing fee", 185], ["ISF filing", 45]],
  },
  {
    id: "hbl-21007",
    broker: HBL,
    invoiceNumber: "HL-21007",
    invoiceDate: "2025-10-09",
    dueDate: "2025-11-08",
    entryNumber: "HB2-2100708-9",
    entryDate: "2025-10-05",
    port: "2720 Los Angeles Intl Airport, CA",
    mode: "air",
    lines: [
      {
        description: "Men's cotton T-shirts, knit",
        hts: "6109.10.0012",
        origin: "VN",
        value: 28000,
        tariffs: [
          ["6109.10.0012", "Cotton T-shirts, general rate", 16.5],
          ["9903.02.69", "IEEPA reciprocal (Vietnam)", 20],
        ],
      },
    ],
    brokerage: [["Customs entry service", 165], ["Customs entry service", 165], ["Air import handling", 60]],
  },
  {
    id: "pcb-48455",
    broker: PCB,
    invoiceNumber: "PCB-48455",
    invoiceDate: "2026-02-06",
    dueDate: "2026-03-08",
    entryNumber: "PC7-4845509-4",
    entryDate: "2026-02-03",
    port: "2704 Los Angeles, CA",
    mode: "ocean",
    lines: [
      {
        description: "Aluminum shelving brackets",
        hts: "7616.99.5190",
        origin: "CN",
        value: 240000,
        tariffs: [
          ["7616.99.5190", "Aluminum articles, general rate", 2.5],
          ["9903.85.08", "Section 232 aluminum derivatives", 50],
          ["9903.88.03", "Section 301 List 3", 25],
          ["9903.01.24", "IEEPA fentanyl (China)", 10],
          ["9903.01.33", "Reciprocal exemption (232 article)", 0],
        ],
      },
    ],
    billedMpf: 831.36,
    brokerage: [["Entry filing fee", 185], ["ISF filing", 45]],
  },
];

export interface Sample {
  id: string;
  pdf: string;
  truth: Extraction;
}

export const SAMPLES: Sample[] = SPECS.map((s) => ({ id: s.id, pdf: `/samples/${s.id}.pdf`, truth: build(s) }));
export const sampleById = (id: string) => SAMPLES.find((s) => s.id === id);
