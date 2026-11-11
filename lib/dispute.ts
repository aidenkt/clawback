import type { Audit, Extraction } from "./types";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

// template on purpose, numbers come straight from the audit
export function draftDispute(x: Extraction, a: Audit): { subject: string; body: string } | null {
  const disputes = a.findings.filter((f) => f.recovery === "BROKER_DISPUTE");
  const filingErrors = a.findings.filter((f) => f.kind === "STACKING" || (f.kind === "WRONG_RATE" && f.recovery === "CAPE_CLAIM"));
  if (!disputes.length && !filingErrors.length) return null;

  const corrected = Math.round((x.invoice.total - a.disputable) * 100) / 100;
  const parts: string[] = [];
  parts.push(`Hello ${x.broker.name} billing team,`);
  parts.push(
    `We reviewed invoice ${x.broker.invoiceNumber} (entry ${x.entry.entryNumber}, dated ${x.broker.invoiceDate}) against the attached CBP Form 7501 and found the following.`,
  );
  if (disputes.length) {
    parts.push(
      "Billing differences:\n" +
        disputes.map((f, i) => `${i + 1}. ${f.title} (${usd(f.amount)}). ${f.detail} [invoice packet p.${f.page}: "${f.quote}"]`).join("\n"),
    );
    parts.push(
      `These total ${usd(a.disputable)}. We have placed the invoice on hold in our payables system. Please send a corrected invoice for ${usd(corrected)} and we will release payment the same day.`,
    );
  }
  if (filingErrors.length) {
    parts.push(
      "Filing errors on the entry summary:\n" +
        filingErrors.map((f, i) => `${i + 1}. ${f.title} (${usd(f.amount)}). ${f.detail} [p.${f.page}: "${f.quote}"]`).join("\n"),
    );
    parts.push(
      "Please confirm the correct Chapter 99 reporting for this entry and file a post-summary correction if the entry is still unliquidated, so our refund claim matches CBP's record.",
    );
  }
  parts.push(`Thank you,\nAccounts Payable\n${x.importer.name}`);
  return {
    subject: `Invoice ${x.broker.invoiceNumber} on hold: ${usd(a.disputable)} to correct (entry ${x.entry.entryNumber})`,
    body: parts.join("\n\n"),
  };
}
