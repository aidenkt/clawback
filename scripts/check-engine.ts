import { audit } from "../lib/engine";
import { SAMPLES } from "../lib/samples";

const expected: Record<string, { refundable: number; disputable: number; kinds: string[] }> = {
  "pcb-48211": { refundable: 34710, disputable: 0, kinds: ["REFUNDABLE_IEEPA"] },
  "hbl-20931": { refundable: 18400, disputable: 0, kinds: ["REFUNDABLE_IEEPA", "STACKING"] },
  "pcb-48390": { refundable: 18000, disputable: 2400, kinds: ["BROKER_OVERBILL", "REFUNDABLE_IEEPA", "WRONG_RATE"] },
  "hbl-21007": { refundable: 5600, disputable: 165, kinds: ["DUPLICATE_CHARGE", "REFUNDABLE_IEEPA"] },
  "pcb-48455": { refundable: 24000, disputable: 179.86, kinds: ["FEE_OVER_CAP", "REFUNDABLE_IEEPA"] },
};

let failed = 0;
for (const s of SAMPLES) {
  const a = audit(s.truth, "2026-11-10");
  const e = expected[s.id];
  const kinds = [...new Set(a.findings.map((f) => f.kind))].sort();
  const ok = a.refundable === e.refundable && a.disputable === e.disputable && kinds.join() === e.kinds.join();
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${s.id} refundable=${a.refundable} disputable=${a.disputable} kinds=${kinds.join(",")} clock=${a.clock.status}(${a.clock.daysLeft}d)`,
  );
}
if (failed) {
  console.error(`${failed} sample(s) failed`);
  process.exit(1);
}
