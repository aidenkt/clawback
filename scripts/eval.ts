import { readFileSync, writeFileSync } from "node:fs";
import { audit } from "../lib/engine";
import { extractFromPdf } from "../lib/extract";
import { SAMPLES } from "../lib/samples";

async function main() {
  const results = [];
  let pass = 0;
  for (const s of SAMPLES) {
    const pdf = new Uint8Array(readFileSync(`public/samples/${s.id}.pdf`));
    const { extraction, model, ms } = await extractFromPdf(pdf);
    const truth = s.truth;
    const diffs: string[] = [];
    const eq = (label: string, a: unknown, b: unknown) => {
      if (a !== b) diffs.push(`${label}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);
    };
    eq("entryNumber", extraction.entry.entryNumber, truth.entry.entryNumber);
    eq("entryDate", extraction.entry.entryDate, truth.entry.entryDate);
    eq("mode", extraction.entry.mode, truth.entry.mode);
    eq("lines", extraction.lines.length, truth.lines.length);
    truth.lines.forEach((tl, i) => {
      const gl = extraction.lines[i];
      if (!gl) return;
      eq(`L${i + 1}.hts`, gl.hts, tl.hts);
      eq(`L${i + 1}.origin`, gl.origin, tl.origin);
      eq(`L${i + 1}.value`, gl.enteredValue, tl.enteredValue);
      eq(`L${i + 1}.tariffs`, gl.tariffs.length, tl.tariffs.length);
      tl.tariffs.forEach((tt, j) => {
        const gt = gl.tariffs[j];
        if (!gt) return;
        eq(`L${i + 1}.T${j + 1}.code`, gt.code, tt.code);
        eq(`L${i + 1}.T${j + 1}.rate`, gt.ratePct, tt.ratePct);
        eq(`L${i + 1}.T${j + 1}.duty`, gt.dutyFiled, tt.dutyFiled);
        eq(`L${i + 1}.T${j + 1}.page`, gt.page, tt.page);
      });
    });
    eq("cbp.totalDuty", extraction.cbp.totalDuty, truth.cbp.totalDuty);
    eq("charges", extraction.invoice.charges.length, truth.invoice.charges.length);
    truth.invoice.charges.forEach((tc, i) => {
      const gc = extraction.invoice.charges[i];
      if (!gc) return;
      eq(`C${i + 1}.kind`, gc.kind, tc.kind);
      eq(`C${i + 1}.amount`, gc.amount, tc.amount);
    });
    eq("invoice.total", extraction.invoice.total, truth.invoice.total);
    const a = audit(extraction, "2026-11-10");
    const t = audit(truth, "2026-11-10");
    eq("audit.refundable", a.refundable, t.refundable);
    eq("audit.disputable", a.disputable, t.disputable);
    const ok = diffs.length === 0;
    if (ok) pass++;
    console.log(`${ok ? "PASS" : "FAIL"} ${s.id} (${ms} ms)${ok ? "" : "\n  " + diffs.join("\n  ")}`);
    results.push({ id: s.id, ok, ms, model, diffs, extraction });
  }
  console.log(`${pass}/${SAMPLES.length} packets extracted exactly`);
  writeFileSync(
    "lib/eval-results.json",
    JSON.stringify({ ranAt: new Date().toISOString(), pass, total: SAMPLES.length, results }, null, 2),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
