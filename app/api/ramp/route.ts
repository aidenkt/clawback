import { ramp, rampConfigured, rampToken } from "@/lib/ramp";
import { SAMPLES } from "@/lib/samples";

// only touch the 5 demo drafts
const DEMO_INVOICES = new Set(SAMPLES.map((s) => s.truth.broker.invoiceNumber));


interface RampBill {
  id: string;
  invoice_number?: string;
  memo?: string | null;
  status?: string;
  amount?: { amount: number; currency_code: string };
  vendor?: { name?: string; id?: string };
}

export async function GET() {
  if (!rampConfigured()) return Response.json({ mode: "simulated", reason: "No Ramp credentials configured." });
  try {
    const { scope } = await rampToken();
    const bills = await ramp<{ data: RampBill[] }>("/bills/drafts?page_size=100");
    return Response.json({
      mode: "live",
      scope,
      bills: bills.data.filter((b) => DEMO_INVOICES.has(b.invoice_number ?? "")).map((b) => ({
        id: b.id,
        invoiceNumber: b.invoice_number,
        memo: b.memo,
        status: b.status,
        amount: b.amount,
        vendor: b.vendor?.name,
      })),
    });
  } catch (e) {
    return Response.json({ mode: "error", reason: e instanceof Error ? e.message : String(e) });
  }
}

// hold = leave it as a draft and put the reason in the memo
export async function POST(req: Request) {
  const { action, invoiceNumber, reason } = (await req.json()) as {
    action: "hold" | "release";
    invoiceNumber: string;
    reason?: string;
  };
  if (!rampConfigured() || !DEMO_INVOICES.has(invoiceNumber)) return Response.json({ mode: "simulated", ok: true });
  try {
    const bills = await ramp<{ data: RampBill[] }>("/bills/drafts?page_size=100");
    const bill = bills.data.find((b) => b.invoice_number === invoiceNumber);
    if (!bill) return Response.json({ mode: "live", ok: false, reason: `No Ramp bill with invoice number ${invoiceNumber}.` });
    const memo = action === "hold" ? `CLAWBACK HOLD: ${reason ?? "under review"}`.slice(0, 250) : "Clawback: hold released, cleared to pay";
    await ramp(`/bills/drafts/${bill.id}`, { method: "PATCH", body: JSON.stringify({ memo }) });
    return Response.json({ mode: "live", ok: true, billId: bill.id, memo });
  } catch (e) {
    return Response.json({ mode: "error", ok: false, reason: e instanceof Error ? e.message : String(e) });
  }
}
