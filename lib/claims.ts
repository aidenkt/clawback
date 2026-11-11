import { CAPE_MAX_ENTRIES } from "./rates";
import type { Audit, Extraction } from "./types";

export interface ClaimRow {
  billId: string;
  entryNumber: string;
  importerNumber: string;
  entryDate: string;
  lineNo: number;
  hts: string;
  ch99: string;
  dutyPaid: number;
  basis: string;
  deadline: string;
}

export function claimRows(billId: string, x: Extraction, a: Audit): ClaimRow[] {
  const rows = new Map<string, ClaimRow>();
  for (const f of a.findings) {
    if (f.recovery !== "CAPE_CLAIM" || !f.code || !f.lineNo) continue;
    const key = `${f.lineNo}|${f.code}`;
    const line = x.lines.find((l) => l.lineNo === f.lineNo);
    const prev = rows.get(key);
    const basis =
      f.kind === "STACKING" ? "IEEPA paid in error (232 exempt)" : f.kind === "WRONG_RATE" ? "IEEPA over-rated" : "IEEPA revoked";
    if (prev) {
      prev.dutyPaid = Math.round((prev.dutyPaid + f.amount) * 100) / 100;
      if (f.kind !== "REFUNDABLE_IEEPA") prev.basis = basis;
    } else {
      rows.set(key, {
        billId,
        entryNumber: x.entry.entryNumber,
        importerNumber: x.importer.importerNumber,
        entryDate: x.entry.entryDate,
        lineNo: f.lineNo,
        hts: line?.hts ?? "",
        ch99: f.code,
        dutyPaid: f.amount,
        basis,
        deadline: a.clock.deadline,
      });
    }
  }
  return [...rows.values()];
}

const HEADER = [
  "entry_number",
  "importer_number",
  "entry_date",
  "line_number",
  "hts_number",
  "chapter_99_number",
  "ieepa_duty_paid_usd",
  "refund_claimed_usd",
  "basis",
];

export function buildClaimFiles(rows: ClaimRow[]): { name: string; csv: string; entries: number }[] {
  const byEntry = new Map<string, ClaimRow[]>();
  for (const r of rows) byEntry.set(r.entryNumber, [...(byEntry.get(r.entryNumber) ?? []), r]);
  const entries = [...byEntry.values()];
  const files = [];
  for (let i = 0; i < entries.length; i += CAPE_MAX_ENTRIES) {
    const chunk = entries.slice(i, i + CAPE_MAX_ENTRIES);
    const lines = [HEADER.join(",")];
    for (const e of chunk)
      for (const r of e)
        lines.push(
          [
            r.entryNumber,
            r.importerNumber,
            r.entryDate,
            r.lineNo,
            r.hts,
            r.ch99,
            r.dutyPaid.toFixed(2),
            r.dutyPaid.toFixed(2),
            `"${r.basis}"`,
          ].join(","),
        );
    files.push({
      name: `clawback-claim-${String(files.length + 1).padStart(3, "0")}.csv`,
      csv: lines.join("\n") + "\n",
      entries: chunk.length,
    });
  }
  return files;
}
