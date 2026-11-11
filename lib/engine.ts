import {
  APPROVAL_THRESHOLD,
  BASE_RATES,
  CH99,
  CLAIM_WINDOW_DAYS,
  HMF_RATE_PCT,
  LIQUIDATION_DAYS,
  MPF,
  PROTEST_WINDOW_DAYS,
} from "./rates";
import type { Audit, Clock, ComponentAudit, Extraction, Finding, LineAudit } from "./types";

const TOLERANCE = 0.5;
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const addDays = (iso: string, days: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export function computeClock(entryDate: string, today: string): Clock {
  const liquidationDate = addDays(entryDate, LIQUIDATION_DAYS);
  const deadline = addDays(liquidationDate, CLAIM_WINDOW_DAYS);
  const daysLeft = daysBetween(today, deadline);
  const status = daysLeft < 0 ? "expired" : daysLeft <= 21 ? "urgent" : "open";
  const protestBy = addDays(liquidationDate, PROTEST_WINDOW_DAYS);
  const route =
    status === "expired"
      ? `Claim window closed. File a protest (CBP Form 19) by ${protestBy}.`
      : `File the CAPE claim by ${deadline}.`;
  return { entryDate, liquidationDate, deadline, daysLeft, status, route };
}

// no model in here, just math on what got extracted
export function audit(x: Extraction, today = new Date().toISOString().slice(0, 10)): Audit {
  const findings: Finding[] = [];
  const lines: LineAudit[] = [];
  const entryDate = x.entry.entryDate;
  let n = 0;
  const id = () => `F${++n}`;

  for (const line of x.lines) {
    const base = BASE_RATES[line.hts];
    const has232 = line.tariffs.some((t) => CH99[t.code]?.program === "S232");
    const components: ComponentAudit[] = [];

    for (const t of line.tariffs) {
      const rule = CH99[t.code];
      const isBase = !rule;
      let correctRate: number;
      let program: string;
      let refundable = false;
      let note: string | undefined;
      let status: ComponentAudit["status"] = "ok";

      if (isBase) {
        program = "Base duty";
        correctRate = base ? base.rate : t.ratePct;
        if (!base) note = "HTS not in the rate table snapshot; filed rate accepted as-is.";
      } else {
        program = rule.label;
        refundable = rule.refundable;
        correctRate = rule.rate({ origin: line.origin, entryDate });
        if (rule.program === "IEEPA_RECIPROCAL" && has232) correctRate = 0;
      }

      const correctAmount = round2((line.enteredValue * correctRate) / 100);
      const over = round2(t.dutyFiled - correctAmount);

      if (!isBase && rule.program === "IEEPA_RECIPROCAL" && has232 && t.dutyFiled > TOLERANCE) {
        status = "error";
        note = "Section 232 articles are exempt from the reciprocal tariff. This line should carry 9903.01.33 at 0%.";
        findings.push({
          id: id(),
          kind: "STACKING",
          recovery: "CAPE_CLAIM",
          title: `Reciprocal tariff stacked on a Section 232 article`,
          detail: `Line ${line.lineNo} (${line.hts}) already pays Section 232. ${t.code} should not apply; the broker should have filed 9903.01.33. ${usd(t.dutyFiled)} was paid to CBP in error and is recoverable as IEEPA duty.`,
          amount: t.dutyFiled,
          page: t.page,
          quote: t.quote,
          lineNo: line.lineNo,
          code: t.code,
        });
      } else if (Math.abs(over) > TOLERANCE) {
        status = "error";
        note = `Filed at ${t.ratePct}%, rate table says ${correctRate}% for ${line.origin} on ${entryDate}.`;
        findings.push({
          id: id(),
          kind: "WRONG_RATE",
          recovery: refundable ? "CAPE_CLAIM" : "BROKER_DISPUTE",
          title: `${program}: filed at ${t.ratePct}%, should be ${correctRate}%`,
          detail: `Line ${line.lineNo}: ${usd(line.enteredValue)} × ${correctRate}% = ${usd(correctAmount)}, but ${usd(t.dutyFiled)} was filed. Difference ${usd(over)}.${
            refundable
              ? " The full amount is IEEPA duty, so it comes back through the refund claim."
              : " Not IEEPA, so this needs a post-summary correction from the broker."
          }`,
          amount: over,
          page: t.page,
          quote: t.quote,
          lineNo: line.lineNo,
          code: t.code,
        });
      } else if (refundable && t.dutyFiled > 0) {
        status = "refundable";
      }

      if (refundable && t.dutyFiled > 0 && status !== "error") {
        findings.push({
          id: id(),
          kind: "REFUNDABLE_IEEPA",
          recovery: "CAPE_CLAIM",
          title: `${program} refundable`,
          detail: `Line ${line.lineNo}: ${t.code} at ${t.ratePct}% on ${usd(line.enteredValue)}. IEEPA duties were revoked; this amount is claimable.`,
          amount: t.dutyFiled,
          page: t.page,
          quote: t.quote,
          lineNo: line.lineNo,
          code: t.code,
        });
      } else if (refundable && status === "error" && findings[findings.length - 1]?.kind === "WRONG_RATE") {
        // the part that was rated right is still ieepa, so still refundable
        findings.push({
          id: id(),
          kind: "REFUNDABLE_IEEPA",
          recovery: "CAPE_CLAIM",
          title: `${program} refundable`,
          detail: `Line ${line.lineNo}: the correctly rated portion of ${t.code} (${usd(correctAmount)}) is also claimable.`,
          amount: correctAmount,
          page: t.page,
          quote: t.quote,
          lineNo: line.lineNo,
          code: t.code,
        });
      }

      components.push({
        code: t.code,
        description: t.description,
        program,
        filedRate: t.ratePct,
        filedAmount: t.dutyFiled,
        correctRate,
        correctAmount,
        refundable,
        status,
        note,
        page: t.page,
        quote: t.quote,
      });
    }

    lines.push({
      lineNo: line.lineNo,
      description: line.description,
      hts: line.hts,
      origin: line.origin,
      enteredValue: line.enteredValue,
      page: line.page,
      components,
    });
  }

  const dutyFiled = round2(lines.flatMap((l) => l.components).reduce((s, c) => s + c.filedAmount, 0));
  const dutyCorrect = round2(lines.flatMap((l) => l.components).reduce((s, c) => s + c.correctAmount, 0));
  const totalValue = x.lines.reduce((s, l) => s + l.enteredValue, 0);

  // does the 7501 add up
  if (Math.abs(dutyFiled - x.cbp.totalDuty) > TOLERANCE) {
    findings.push({
      id: id(),
      kind: "MATH",
      recovery: "BROKER_DISPUTE",
      title: "7501 duty total does not foot",
      detail: `Line duties add to ${usd(dutyFiled)} but the 7501 total reads ${usd(x.cbp.totalDuty)}.`,
      amount: round2(Math.abs(x.cbp.totalDuty - dutyFiled)),
      page: x.cbp.page,
      quote: `Total duty ${x.cbp.totalDuty}`,
    });
  }

  // invoice vs what cbp actually got
  const charge = (kind: string) => x.invoice.charges.filter((c) => c.kind === kind);
  const dutyCharges = charge("duty");
  const billedDuty = round2(dutyCharges.reduce((s, c) => s + c.amount, 0));
  if (dutyCharges.length && billedDuty - x.cbp.totalDuty > TOLERANCE) {
    findings.push({
      id: id(),
      kind: "BROKER_OVERBILL",
      recovery: "BROKER_DISPUTE",
      title: "Broker billed more duty than it paid CBP",
      detail: `Invoice bills ${usd(billedDuty)} in duty. The 7501 shows ${usd(x.cbp.totalDuty)} paid to CBP. Difference ${usd(billedDuty - x.cbp.totalDuty)}.`,
      amount: round2(billedDuty - x.cbp.totalDuty),
      page: dutyCharges[0].page,
      quote: dutyCharges[0].quote,
    });
  }

  const expectedMpf = round2(Math.min(MPF.max, Math.max(MPF.min, (totalValue * MPF.ratePct) / 100)));
  const mpfCharges = charge("mpf");
  const billedMpf = round2(mpfCharges.reduce((s, c) => s + c.amount, 0));
  if (mpfCharges.length && billedMpf - expectedMpf > TOLERANCE) {
    findings.push({
      id: id(),
      kind: "FEE_OVER_CAP",
      recovery: "BROKER_DISPUTE",
      title: "Merchandise processing fee billed above the cap",
      detail: `MPF is ${MPF.ratePct}% of entered value, capped at ${usd(MPF.max)} per entry. Correct fee is ${usd(expectedMpf)}; the invoice bills ${usd(billedMpf)}.`,
      amount: round2(billedMpf - expectedMpf),
      page: mpfCharges[0].page,
      quote: mpfCharges[0].quote,
    });
  }

  const expectedHmf = x.entry.mode === "ocean" ? round2((totalValue * HMF_RATE_PCT) / 100) : 0;
  const hmfCharges = charge("hmf");
  const billedHmf = round2(hmfCharges.reduce((s, c) => s + c.amount, 0));
  if (hmfCharges.length && billedHmf - expectedHmf > TOLERANCE) {
    findings.push({
      id: id(),
      kind: "FEE_OVER_CAP",
      recovery: "BROKER_DISPUTE",
      title: x.entry.mode === "ocean" ? "Harbor maintenance fee overbilled" : "Harbor maintenance fee billed on a non-ocean entry",
      detail: `Correct HMF is ${usd(expectedHmf)}; the invoice bills ${usd(billedHmf)}.`,
      amount: round2(billedHmf - expectedHmf),
      page: hmfCharges[0].page,
      quote: hmfCharges[0].quote,
    });
  }

  // dupes
  const seen = new Map<string, number>();
  for (const c of x.invoice.charges) {
    if (c.kind !== "brokerage" && c.kind !== "other") continue;
    const key = `${c.label.trim().toLowerCase()}|${c.amount}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) {
      findings.push({
        id: id(),
        kind: "DUPLICATE_CHARGE",
        recovery: "BROKER_DISPUTE",
        title: `"${c.label}" billed twice`,
        detail: `The same ${usd(c.amount)} charge appears twice on one invoice for a single entry.`,
        amount: c.amount,
        page: c.page,
        quote: c.quote,
      });
    }
  }

  const sumCharges = round2(x.invoice.charges.reduce((s, c) => s + c.amount, 0));
  if (Math.abs(sumCharges - x.invoice.total) > TOLERANCE) {
    findings.push({
      id: id(),
      kind: "MATH",
      recovery: "BROKER_DISPUTE",
      title: "Invoice total does not match its own lines",
      detail: `Charges add to ${usd(sumCharges)} but the invoice total reads ${usd(x.invoice.total)}.`,
      amount: round2(Math.abs(x.invoice.total - sumCharges)),
      page: x.invoice.page,
      quote: `Total ${x.invoice.total}`,
    });
  }

  const refundable = round2(findings.filter((f) => f.recovery === "CAPE_CLAIM").reduce((s, f) => s + f.amount, 0));
  const disputable = round2(findings.filter((f) => f.recovery === "BROKER_DISPUTE").reduce((s, f) => s + f.amount, 0));

  return {
    lines,
    findings,
    dutyFiled,
    dutyCorrect,
    refundable,
    disputable,
    recommendHold: disputable > TOLERANCE,
    needsApproval: refundable > APPROVAL_THRESHOLD || disputable > APPROVAL_THRESHOLD,
    clock: computeClock(entryDate, today),
  };
}
