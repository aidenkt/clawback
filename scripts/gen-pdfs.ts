import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { SAMPLES, rateText } from "../lib/samples";

const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const W = 612;
const H = 792;
const M = 48;
const ink = rgb(0.1, 0.1, 0.12);
const grey = rgb(0.45, 0.45, 0.5);
const rule = rgb(0.8, 0.8, 0.82);

async function main() {
  mkdirSync("public/samples", { recursive: true });
  for (const s of SAMPLES) {
    const x = s.truth;
    const doc = await PDFDocument.create();
    doc.setTitle(`${x.broker.name} invoice ${x.broker.invoiceNumber}`);
    const reg = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const mono = await doc.embedFont(StandardFonts.Courier);

    const text = (p: PDFPage, t: string, x0: number, y: number, size = 10, font: PDFFont = reg, color = ink) =>
      p.drawText(t, { x: x0, y, size, font, color });
    const right = (p: PDFPage, t: string, xr: number, y: number, size = 10, font: PDFFont = reg) =>
      p.drawText(t, { x: xr - font.widthOfTextAtSize(t, size), y, size, font, color: ink });
    const line = (p: PDFPage, y: number) =>
      p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rule });

    // page 1: invoice
    const p1 = doc.addPage([W, H]);
    let y = H - 60;
    text(p1, x.broker.name, M, y, 18, bold);
    right(p1, "INVOICE", W - M, y, 18, bold);
    y -= 16;
    text(p1, "Licensed U.S. Customs Broker", M, y, 9, reg, grey);
    y -= 34;
    const meta: [string, string][] = [
      ["Invoice no.", x.broker.invoiceNumber],
      ["Invoice date", x.broker.invoiceDate],
      ["Payment due", x.broker.dueDate],
      ["Entry no.", x.entry.entryNumber],
      ["Entry date", x.entry.entryDate],
      ["Port of entry", x.entry.port],
      ["Mode", x.entry.mode.toUpperCase()],
    ];
    text(p1, "Bill to", M, y, 9, reg, grey);
    text(p1, x.importer.name, M, y - 14, 11, bold);
    text(p1, `Importer of record no. ${x.importer.importerNumber}`, M, y - 28, 9);
    let my = y;
    for (const [k, v] of meta) {
      text(p1, k, 340, my, 9, reg, grey);
      right(p1, v, W - M, my, 9, bold);
      my -= 14;
    }
    y = my - 26;
    text(p1, "Description", M, y, 9, bold);
    right(p1, "Amount (USD)", W - M, y, 9, bold);
    y -= 8;
    line(p1, y);
    y -= 18;
    for (const c of x.invoice.charges) {
      text(p1, c.label, M, y, 10);
      right(p1, `$${money(c.amount)}`, W - M, y, 10, mono);
      y -= 20;
    }
    line(p1, y + 8);
    y -= 12;
    text(p1, "Total due", M, y, 12, bold);
    right(p1, `$${money(x.invoice.total)}`, W - M, y, 12, bold);
    y -= 44;
    text(p1, "Duties and fees were advanced to U.S. Customs and Border Protection on your behalf.", M, y, 9, reg, grey);
    text(p1, "See the attached CBP Form 7501 entry summary for the duty computation.", M, y - 13, 9, reg, grey);
    text(p1, "Page 1 of 2", M, 36, 8, reg, grey);

    // page 2: 7501
    const p2 = doc.addPage([W, H]);
    y = H - 56;
    text(p2, "DEPARTMENT OF HOMELAND SECURITY · U.S. Customs and Border Protection", M, y, 8, reg, grey);
    y -= 20;
    text(p2, "ENTRY SUMMARY", M, y, 16, bold);
    right(p2, "CBP Form 7501", W - M, y, 10, bold);
    y -= 26;
    const boxes: [string, string][] = [
      ["1. Filer code / Entry no.", x.entry.entryNumber],
      ["2. Entry type", "01 Consumption"],
      ["3. Summary date", x.entry.entryDate],
      ["7. Entry date", x.entry.entryDate],
      ["9. Mode of transport", x.entry.mode === "ocean" ? "11 Vessel" : "40 Air"],
      ["20. Port of entry", x.entry.port],
      ["23. Importer no.", x.importer.importerNumber],
      ["26. Importer of record", x.importer.name],
    ];
    boxes.forEach(([k, v], i) => {
      const bx = M + (i % 2) * 262;
      const by = y - Math.floor(i / 2) * 30;
      text(p2, k, bx, by, 7.5, reg, grey);
      text(p2, v, bx, by - 11, 9.5, bold);
    });
    y -= 4 * 30 + 12;
    line(p2, y);
    y -= 14;
    text(p2, "29. HTSUS no.", M, y, 8, bold);
    text(p2, "28. Description", M + 86, y, 8, bold);
    right(p2, "33. Rate", 468, y, 8, bold);
    right(p2, "34. Duty (USD)", W - M, y, 8, bold);
    y -= 6;
    line(p2, y);
    y -= 16;
    for (const l of x.lines) {
      text(p2, `Line ${String(l.lineNo).padStart(3, "0")}`, M, y, 9, bold);
      text(p2, l.description, M + 86, y, 9, bold);
      y -= 13;
      text(p2, `Country of origin: ${l.origin}     32. Entered value: $${money(l.enteredValue)}`, M + 86, y, 8.5, reg, grey);
      y -= 15;
      for (const t of l.tariffs) {
        text(p2, t.code, M, y, 9, mono);
        text(p2, t.description, M + 86, y, 9);
        right(p2, rateText(t.ratePct), 468, y, 9, mono);
        right(p2, `$${money(t.dutyFiled)}`, W - M, y, 9, mono);
        y -= 14;
      }
      y -= 8;
    }
    line(p2, y + 6);
    y -= 12;
    const totals: [string, number][] = [
      ["37. Duty", x.cbp.totalDuty],
      ["39. Other: 499 Merchandise processing fee", x.cbp.mpf],
      ...(x.cbp.hmf ? ([["39. Other: 501 Harbor maintenance fee", x.cbp.hmf]] as [string, number][]) : []),
      ["40. Total", Math.round((x.cbp.totalDuty + x.cbp.mpf + x.cbp.hmf) * 100) / 100],
    ];
    for (const [k, v] of totals) {
      const f = k.startsWith("40") ? bold : reg;
      text(p2, k, 300, y, 9, f);
      right(p2, `$${money(v)}`, W - M, y, 9, k.startsWith("40") ? bold : mono);
      y -= 14;
    }
    text(p2, "Synthetic document generated for the Clawback demo. Not a real filing.", M, 50, 7.5, reg, grey);
    text(p2, "Page 2 of 2", M, 36, 8, reg, grey);

    writeFileSync(`public/samples/${s.id}.pdf`, await doc.save());
    console.log("wrote", s.id);
  }
}
main();
