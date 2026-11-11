import { ramp } from "../lib/ramp";
import { SAMPLES } from "../lib/samples";

interface Vendor { id: string; name: string }
interface Bill { id: string; invoice_number: string; entity_id: string; bill_owner?: { id: string } }

// puts the sample bills in the ramp sandbox as drafts. safe to rerun
async function main() {
  const bills = (await ramp<{ data: Bill[] }>("/bills?page_size=100")).data;
  const drafts = (await ramp<{ data: Bill[] }>("/bills/drafts?page_size=100")).data;
  const entityId = process.env.RAMP_ENTITY_ID ?? bills[0]?.entity_id;
  if (!entityId) throw new Error("No entity id: set RAMP_ENTITY_ID");
  const ownerId = process.env.RAMP_OWNER_ID ?? bills.find((b) => b.bill_owner)?.bill_owner?.id;
  const vendors = (await ramp<{ data: Vendor[] }>("/vendors?page_size=100")).data;

  for (const s of SAMPLES) {
    const x = s.truth;
    let vendor = vendors.find((v) => v.name === x.broker.name);
    if (!vendor) {
      const slug = x.broker.name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-$/, "");
      vendor = await ramp<Vendor>("/vendors", {
        method: "POST",
        body: JSON.stringify({
          name: x.broker.name,
          country: "US",
          vendor_owner_id: ownerId,
          business_vendor_contacts: { email: `billing@${slug}.example.com`, first_name: "Billing", last_name: "Desk" },
        }),
      });
      vendor.name = x.broker.name;
      vendors.push(vendor);
      console.log("created vendor", x.broker.name, vendor.id);
    }
    await ramp(`/vendors/${vendor.id}`, { method: "PATCH", body: JSON.stringify({ vendor_owner_id: ownerId }) });
    if (drafts.some((b) => b.invoice_number === x.broker.invoiceNumber)) {
      console.log("bill exists", x.broker.invoiceNumber);
      continue;
    }
    const created = await ramp<{ id: string }>("/bills/drafts", {
      method: "POST",
      body: JSON.stringify({
        entity_id: entityId,
        vendor_id: vendor.id,
        invoice_number: x.broker.invoiceNumber,
        invoice_currency: "USD",
        use_default_payment_method: true,
        use_default_vendor_contact: true,
        issued_at: x.broker.invoiceDate,
        due_at: x.broker.dueDate,
        memo: `Customs entry ${x.entry.entryNumber}`,
        line_items: x.invoice.charges.map((c) => ({ amount: c.amount, memo: c.label })),
      }),
    });
    console.log("created draft bill", x.broker.invoiceNumber, JSON.stringify(created).slice(0, 120));
  }
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
