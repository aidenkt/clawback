"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildClaimFiles, claimRows } from "@/lib/claims";
import { draftDispute } from "@/lib/dispute";
import { audit } from "@/lib/engine";
import evalResults from "@/lib/eval-results.json";
import { APPROVAL_THRESHOLD } from "@/lib/rates";
import { SAMPLES } from "@/lib/samples";
import type { Audit, Extraction, Finding } from "@/lib/types";

interface Bill {
  id: string;
  pdf: string;
  x: Extraction;
  a: Audit;
  source: { model: string; ms: number; cached: boolean };
}
type Tab = "bills" | "claim" | "clocks" | "how";
interface RampStatus {
  mode: "live" | "simulated" | "error" | "loading";
  reason?: string;
  bills?: { id: string; invoiceNumber?: string; memo?: string | null; status?: string }[];
}

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const day = (iso: string) =>
  new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function initialBills(): Bill[] {
  const cached = new Map((evalResults.results as { id: string; ms: number; model: string; extraction: Extraction }[]).map((r) => [r.id, r]));
  return SAMPLES.map((s) => {
    const r = cached.get(s.id);
    const x = r?.extraction ?? s.truth;
    return { id: s.id, pdf: s.pdf, x, a: audit(x), source: { model: r?.model ?? "ground truth", ms: r?.ms ?? 0, cached: true } };
  });
}

export default function Clawback() {
  const [bills, setBills] = useState<Bill[]>(initialBills);
  const [sel, setSel] = useState(bills[2]?.id ?? bills[0].id);
  const [tab, setTab] = useState<Tab>("bills");
  const [page, setPage] = useState(1);
  const [cite, setCite] = useState<string | null>(null);
  const [held, setHeld] = useState<Record<string, boolean>>({});
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rampStatus, setRampStatus] = useState<RampStatus>({ mode: "loading" });
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/ramp")
      .then((r) => r.json())
      .then((s: RampStatus) => {
        setRampStatus(s);
        const h: Record<string, boolean> = {};
        for (const b of s.bills ?? []) if (b.memo?.startsWith("CLAWBACK HOLD") && b.invoiceNumber) h[b.invoiceNumber] = true;
        if (Object.keys(h).length) setHeld((p) => ({ ...h, ...p }));
      })
      .catch(() => setRampStatus({ mode: "error", reason: "Could not reach /api/ramp" }));
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const bill = bills.find((b) => b.id === sel) ?? bills[0];
  const inv = bill.x.broker.invoiceNumber;
  const rows = useMemo(() => bills.flatMap((b) => claimRows(b.id, b.x, b.a)), [bills]);
  // expired entries need a protest, keep them out of the csv
  const approvedRows = rows.filter((r) => approved[r.billId] && r.deadline >= today);
  const totals = useMemo(() => {
    const refundable = bills.reduce((s, b) => s + b.a.refundable, 0);
    const disputable = bills.reduce((s, b) => s + b.a.disputable, 0);
    const next = bills.filter((b) => b.a.clock.status !== "expired").sort((p, q) => p.a.clock.daysLeft - q.a.clock.daysLeft)[0];
    return { refundable, disputable, next };
  }, [bills]);

  const select = (id: string) => {
    setSel(id);
    setPage(1);
    setCite(null);
    setError(null);
  };
  const jump = (f: { page: number; quote: string }) => {
    setPage(f.page);
    setCite(f.quote);
  };

  async function rerun() {
    setBusy("Reading the PDF…");
    setError(null);
    try {
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleId: bill.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      setBills((bs) => bs.map((b) => (b.id === bill.id ? { ...b, x: j.extraction, a: j.audit, source: { model: j.model, ms: j.ms, cached: false } } : b)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy(`Reading ${file.name}…`);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error);
      const id = `upload-${Date.now()}`;
      setBills((bs) => [{ id, pdf: URL.createObjectURL(file), x: j.extraction, a: j.audit, source: { model: j.model, ms: j.ms, cached: false } }, ...bs]);
      setTab("bills");
      select(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggleHold() {
    const releasing = held[inv];
    setBusy(releasing ? "Releasing…" : "Placing hold in Ramp…");
    try {
      const res = await fetch("/api/ramp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: releasing ? "release" : "hold",
          invoiceNumber: inv,
          reason: `${usd(bill.a.disputable)} overbilled; ${bill.a.findings.filter((f) => f.recovery === "BROKER_DISPUTE").map((f) => f.title).join("; ")}`,
        }),
      });
      const j = await res.json();
      if (j.mode !== "simulated" && !j.ok) throw new Error(j.reason);
      setHeld((h) => ({ ...h, [inv]: !releasing }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const dispute = draftDispute(bill.x, bill.a);
  const files = buildClaimFiles(approvedRows);
  const issues = bill.a.findings.filter((f) => f.kind !== "REFUNDABLE_IEEPA");
  const plain = bill.a.findings.filter((f) => f.kind === "REFUNDABLE_IEEPA");
  const c = bill.a.clock;

  return (
    <div className="mx-auto w-full max-w-[1360px] px-5 pb-20 sm:px-8">
      <header className="flex flex-wrap items-center gap-x-8 gap-y-3 border-b border-line py-4">
        <span className="rounded-[5px] bg-zest px-2 py-0.5 text-[17px] font-semibold tracking-tight">Clawback</span>
        <nav className="flex gap-6 text-sm">
          {(
            [
              ["bills", "Bills"],
              ["claim", "Claim file"],
              ["clocks", "Clocks"],
              ["how", "How it works"],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={`-mb-[17px] border-b-2 pb-[15px] ${tab === k ? "border-ink font-medium text-ink" : "border-transparent text-mute hover:text-ink"}`}>
              {label}
              {k === "claim" && approvedRows.length > 0 && <span className="num ml-1.5 text-xs text-mute">{approvedRows.length}</span>}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-sm">
          <RampPill s={rampStatus} />
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) upload(f);
              e.target.value = "";
            }}
          />
          <button onClick={() => fileRef.current?.click()} className="rounded-md border border-line px-3 py-1.5 font-medium shadow-[0_1px_0_rgba(0,0,0,0.03)] hover:border-ink">
            Upload PDF
          </button>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-y-4 border-b border-line py-5 lg:grid-cols-4">
        <Stat label="Refundable" value={usd0(totals.refundable)} tone="good" />
        <Stat label="Overbilled" value={usd(totals.disputable)} tone="bad" />
        <Stat label="Approved for claim" value={usd0(approvedRows.reduce((s, r) => s + r.dutyPaid, 0))} />
        <Stat label="Next deadline" value={totals.next ? `${totals.next.a.clock.daysLeft} days` : "—"} sub={totals.next?.x.entry.entryNumber} />
      </section>

      {(busy || error) && (
        <div className={`mt-4 flex items-center gap-2 rounded-md px-3 py-2 text-sm ${error ? "bg-badbg text-bad" : "bg-paper text-ink"}`}>
          {busy && !error && <span className="h-3 w-3 animate-spin rounded-full border-2 border-ink border-t-transparent" />}
          {error ?? busy}
        </div>
      )}

      {tab === "bills" && (
        <div className="mt-6 grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)_minmax(0,440px)]">
          <aside>
            <Label>Bill Pay · drafts</Label>
            <div className="mt-2 divide-y divide-line border-y border-line">
              {bills.map((b) => {
                const n = b.x.broker.invoiceNumber;
                const on = b.id === bill.id;
                return (
                  <button key={b.id} onClick={() => select(b.id)} className={`relative block w-full py-3 pl-3 pr-1 text-left ${on ? "bg-paper" : "hover:bg-paper/60"}`}>
                    {on && <span className="absolute inset-y-0 left-0 w-0.5 bg-ink" />}
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="num text-[13px] font-medium">{n}</span>
                      <span className="num text-[13px] text-mute">{usd0(b.x.invoice.total)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs">
                      {held[n] ? (
                        <span className="text-bad">On hold</span>
                      ) : b.a.recommendHold ? (
                        <span className="text-bad">{usd0(b.a.disputable)} over</span>
                      ) : (
                        <span className="text-good">Clear</span>
                      )}
                      <span className="text-line">·</span>
                      <span className={b.a.clock.status === "open" ? "text-mute" : "text-warn"}>
                        {b.a.clock.status === "expired" ? "window closed" : `${b.a.clock.daysLeft}d left`}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="num text-2xl font-semibold tracking-tight">{inv}</h1>
                  {held[inv] ? <Chip tone="bad">On hold in Ramp</Chip> : bill.a.recommendHold ? <Chip tone="warn">Needs review</Chip> : <Chip tone="good">Clear to pay</Chip>}
                </div>
                <p className="mt-1 text-sm text-mute">
                  {bill.x.broker.name} · <span className="num text-ink">{usd(bill.x.invoice.total)}</span> · due {day(bill.x.broker.dueDate)}
                </p>
              </div>
              <div className="flex gap-2">
                {(bill.a.recommendHold || held[inv]) && (
                  <button onClick={toggleHold} disabled={!!busy} className={`rounded-md px-3.5 py-2 text-sm font-medium disabled:opacity-50 ${held[inv] ? "border border-line hover:border-ink" : "bg-bad text-white hover:opacity-90"}`}>
                    {held[inv] ? "Release hold" : "Hold in Ramp"}
                  </button>
                )}
                {bill.a.refundable > 0 && (
                  <button
                    onClick={() => setApproved((p) => ({ ...p, [bill.id]: !p[bill.id] }))}
                    className={`rounded-md px-3.5 py-2 text-sm font-medium ${approved[bill.id] ? "border border-line text-good" : "bg-ink text-white hover:opacity-90"}`}
                  >
                    {approved[bill.id] ? "Approved ✓" : "Approve for claim"}
                  </button>
                )}
              </div>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-y border-line py-4 sm:grid-cols-4">
              <KV k="Entry" v={bill.x.entry.entryNumber} mono />
              <KV k="Duty paid to CBP" v={usd(bill.a.dutyFiled)} mono />
              <KV k="Refundable" v={usd(bill.a.refundable)} mono tone="good" />
              <KV k="Overbilled" v={usd(bill.a.disputable)} mono tone={bill.a.disputable ? "bad" : undefined} />
              <KV k="Entered" v={day(c.entryDate)} />
              <KV k="Liquidates" v={day(c.liquidationDate)} />
              <KV k={c.status === "expired" ? "Claim window" : "Claim by"} v={c.status === "expired" ? "Closed, protest" : `${day(c.deadline)} · ${c.daysLeft}d`} tone={c.status === "open" ? undefined : "warn"} />
              <KV k="Approval" v={bill.a.needsApproval ? `Required over ${usd0(APPROVAL_THRESHOLD)}` : "Auto"} />
            </dl>

            <h2 className="mt-8 text-[15px] font-semibold">Findings</h2>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {issues.map((f) => (
                <FindingRow key={f.id} f={f} onCite={() => jump(f)} />
              ))}
              {plain.length > 0 && (
                <li className="flex items-center gap-3 py-3">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-good" />
                  <span className="min-w-0 flex-1 text-sm">
                    Refundable IEEPA duty <span className="text-mute">· {plain.length} {plain.length === 1 ? "line" : "lines"}</span>
                  </span>
                  <Cite page={plain[0].page} onClick={() => jump(plain[0])} />
                  <span className="num w-28 text-right text-sm font-medium text-good">{usd(plain.reduce((s, f) => s + f.amount, 0))}</span>
                </li>
              )}
              {!bill.a.findings.length && <li className="py-3 text-sm text-mute">Nothing to flag.</li>}
            </ul>

            <h2 className="mt-8 text-[15px] font-semibold">Filed vs. correct duty</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[540px] text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-xs text-mute">
                    <th className="py-2 font-normal">Tariff</th>
                    <th className="py-2 pl-5 text-right font-normal">Rate</th>
                    <th className="py-2 pl-5 text-right font-normal">Filed</th>
                    <th className="py-2 pl-5 text-right font-normal">Correct</th>
                    <th className="w-12 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {bill.a.lines.map((l) => (
                    <LineRows key={l.lineNo} l={l} onCite={jump} />
                  ))}
                </tbody>
              </table>
            </div>

            {dispute && (
              <details className="group mt-8 border-y border-line">
                <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-[15px] font-semibold">
                  Draft note to the broker
                  <span className="text-xs font-normal text-mute group-open:hidden">Show</span>
                  <span className="hidden text-xs font-normal text-mute group-open:inline">Hide</span>
                </summary>
                <div className="pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-sm font-medium">{dispute.subject}</p>
                    <button onClick={() => navigator.clipboard.writeText(`${dispute.subject}\n\n${dispute.body}`)} className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs hover:border-ink">
                      Copy
                    </button>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink/80">{dispute.body}</pre>
                </div>
              </details>
            )}

            <p className="mt-6 text-xs text-mute">
              Read by <span className="num">{bill.source.model}</span>
              {bill.source.ms ? ` in ${(bill.source.ms / 1000).toFixed(1)}s` : ""}
              {bill.source.cached ? "" : ", just now"} · math by code
              {!bill.id.startsWith("upload") && (
                <>
                  {" · "}
                  <button onClick={rerun} disabled={!!busy} className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink disabled:opacity-50">
                    Re-read live
                  </button>
                </>
              )}
            </p>
          </main>

          <aside className="lg:sticky lg:top-6 lg:self-start">
            <div className="flex items-center justify-between">
              <Label>Source</Label>
              <div className="flex gap-3 text-xs">
                {[1, 2].map((p) => (
                  <button key={p} onClick={() => { setPage(p); setCite(null); }} className={page === p ? "font-medium text-ink underline underline-offset-4" : "text-mute hover:text-ink"}>
                    {p === 1 ? "Invoice" : "CBP 7501"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 overflow-hidden rounded-lg border border-line">
              {cite && <div className="num border-b border-line bg-zest/50 px-3 py-2 text-xs">{cite}</div>}
              <iframe key={`${bill.pdf}-${page}`} src={`${bill.pdf}#page=${page}&view=FitH&toolbar=0&navpanes=0`} title="Source PDF" className="h-[72vh] w-full bg-white" />
            </div>
          </aside>
        </div>
      )}

      {tab === "claim" && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Claim file</h1>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setApproved(Object.fromEntries(bills.filter((b) => b.a.refundable > 0).map((b) => [b.id, true])))} className="rounded-md border border-line px-3.5 py-2 text-sm font-medium hover:border-ink">
                Approve all
              </button>
              {files.map((f) => (
                <a key={f.name} href={`data:text/csv;charset=utf-8,${encodeURIComponent(f.csv)}`} download={f.name} className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-white hover:opacity-90">
                  Download CSV · {f.entries} entries
                </a>
              ))}
            </div>
          </div>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs text-mute">
                  <th className="py-2 font-normal">Entry</th>
                  <th className="py-2 font-normal">Line</th>
                  <th className="py-2 font-normal">Chapter 99</th>
                  <th className="py-2 font-normal">Basis</th>
                  <th className="py-2 font-normal">Claim by</th>
                  <th className="py-2 pl-5 text-right font-normal">Amount</th>
                  <th className="py-2 pl-6 font-normal">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={`${r.entryNumber}-${r.lineNo}-${r.ch99}`}>
                    <td className="num py-2.5">{r.entryNumber}</td>
                    <td className="num py-2.5 text-mute">{r.lineNo}</td>
                    <td className="num py-2.5">{r.ch99}</td>
                    <td className="py-2.5 text-mute">{r.basis}</td>
                    <td className="py-2.5 text-mute">{day(r.deadline)}</td>
                    <td className="num py-2.5 text-right">{usd(r.dutyPaid)}</td>
                    <td className="py-2.5 pl-6">{r.deadline < today ? <Chip tone="warn">Protest</Chip> : approved[r.billId] ? <Chip tone="good">Approved</Chip> : <Chip>Pending</Chip>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink font-medium">
                  <td colSpan={5} className="py-2.5">Total</td>
                  <td className="num py-2.5 text-right">{usd(rows.reduce((s, r) => s + r.dutyPaid, 0))}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-xs text-mute">Split at 9,999 entries per file. Draft column layout.</p>
        </div>
      )}

      {tab === "clocks" && (
        <div className="mt-6">
          <h1 className="text-2xl font-semibold tracking-tight">Clocks</h1>
          <div className="mt-5 divide-y divide-line border-y border-line">
            {[...bills].sort((p, q) => p.a.clock.daysLeft - q.a.clock.daysLeft).map((b) => {
              const k = b.a.clock;
              const pct = k.status === "expired" ? 0 : Math.max(3, Math.min(100, (k.daysLeft / 120) * 100));
              return (
                <button key={b.id} onClick={() => { setTab("bills"); select(b.id); }} className="grid w-full grid-cols-[150px_1fr_110px_110px] items-center gap-6 py-3.5 text-left text-sm hover:bg-paper/60">
                  <span className="num font-medium">{b.x.entry.entryNumber}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-line">
                    <span className={`block h-full rounded-full ${k.status === "open" ? "bg-ink" : "bg-warn"}`} style={{ width: `${pct}%` }} />
                  </span>
                  <span className={k.status === "open" ? "text-mute" : "text-warn"}>{k.status === "expired" ? "Closed · protest" : `${k.daysLeft} days`}</span>
                  <span className="num text-right">{usd0(b.a.refundable)}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-mute">Claim window: 80 days after liquidation.</p>
        </div>
      )}

      {tab === "how" && <How rampStatus={rampStatus} />}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-mute">{children}</div>;
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div>
      <div className="text-xs text-mute">{label}</div>
      <div className={`num mt-1 text-[26px] font-semibold leading-none tracking-tight ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</div>
      {sub && <div className="num mt-1.5 text-xs text-mute">{sub}</div>}
    </div>
  );
}

function KV({ k, v, mono, tone }: { k: string; v: string; mono?: boolean; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "";
  return (
    <div>
      <dt className="text-xs text-mute">{k}</dt>
      <dd className={`mt-0.5 text-sm ${mono ? "num" : ""} ${color}`}>{v}</dd>
    </div>
  );
}

function Chip({ children, tone }: { children: React.ReactNode; tone?: "good" | "bad" | "warn" }) {
  const cls = tone === "good" ? "bg-goodbg text-good" : tone === "bad" ? "bg-badbg text-bad" : tone === "warn" ? "bg-warnbg text-warn" : "bg-paper text-mute";
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Cite({ page, onClick }: { page: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="num shrink-0 rounded border border-line px-1.5 py-0.5 text-[11px] text-mute hover:border-ink hover:bg-zest/60 hover:text-ink" title="Show this row in the source PDF">
      p.{page}
    </button>
  );
}

function FindingRow({ f, onCite }: { f: Finding; onCite: () => void }) {
  const [open, setOpen] = useState(false);
  const dispute = f.recovery === "BROKER_DISPUTE";
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dispute ? "bg-bad" : "bg-warn"}`} />
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left text-sm font-medium hover:underline hover:decoration-line hover:underline-offset-4">
          {f.title}
        </button>
        <span className="hidden text-xs text-mute sm:inline">{dispute ? "Dispute" : "Claim"}</span>
        <Cite page={f.page} onClick={onCite} />
        <span className={`num w-28 text-right text-sm font-medium ${dispute ? "text-bad" : "text-good"}`}>{usd(f.amount)}</span>
      </div>
      {open && <p className="ml-[18px] mt-1.5 max-w-xl text-[13px] leading-relaxed text-mute">{f.detail}</p>}
    </li>
  );
}

function LineRows({ l, onCite }: { l: Audit["lines"][number]; onCite: (c: { page: number; quote: string }) => void }) {
  return (
    <>
      <tr>
        <td colSpan={5} className="pb-1 pt-4 text-xs text-mute">
          <span className="font-medium text-ink">{l.description}</span> · {l.origin} · <span className="num">{usd(l.enteredValue)}</span>
        </td>
      </tr>
      {l.components.map((c) => {
        const wrong = c.status === "error";
        return (
          <tr key={c.code} className="border-b border-line/60">
            <td className="py-1.5 pr-2">
              <span className="num">{c.code}</span> <span className="text-mute">{c.program}</span>
            </td>
            <td className="num py-1.5 pl-5 text-right text-mute">
              {wrong && c.filedRate !== c.correctRate ? (
                <>
                  <s>{c.filedRate}%</s> <span className="text-ink">{c.correctRate}%</span>
                </>
              ) : (
                `${c.filedRate}%`
              )}
            </td>
            <td className={`num py-1.5 pl-5 text-right ${wrong ? "text-bad" : ""}`}>{usd(c.filedAmount)}</td>
            <td className={`num py-1.5 pl-5 text-right ${c.refundable && c.filedAmount > 0 ? "text-good" : ""}`}>{usd(c.correctAmount)}</td>
            <td className="py-1.5 text-right"><Cite page={c.page} onClick={() => onCite(c)} /></td>
          </tr>
        );
      })}
    </>
  );
}

function RampPill({ s }: { s: RampStatus }) {
  const live = s.mode === "live";
  return (
    <span title={s.reason} className="flex items-center gap-1.5 text-xs text-mute">
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-good" : s.mode === "error" ? "bg-bad" : "bg-line"}`} />
      {s.mode === "loading" ? "Ramp…" : live ? "Ramp sandbox connected" : s.mode === "error" ? "Ramp error" : "Ramp simulated"}
    </span>
  );
}

function How({ rampStatus }: { rampStatus: RampStatus }) {
  const ev = evalResults as { pass: number; total: number; ranAt: string; results: { model: string }[] };
  const steps: [string, string][] = [
    ["Bill lands in Ramp", "Broker invoice plus the CBP 7501 behind it."],
    ["Model reads", "Every row, with page and exact text. No math."],
    ["Code computes", "Duty rebuilt from a versioned rate table."],
    ["Two piles", "Refundable goes to the claim. Overbilling goes to a dispute."],
    ["Person approves", `Anything over ${usd0(APPROVAL_THRESHOLD)}.`],
    ["Clock runs", "Each entry sorted by its own deadline."],
  ];
  return (
    <div className="mt-6">
      <h1 className="text-2xl font-semibold tracking-tight">How it works</h1>
      <ol className="mt-6 grid gap-x-8 gap-y-6 border-y border-line py-6 sm:grid-cols-2 lg:grid-cols-6">
        {steps.map(([t, d], i) => (
          <li key={t}>
            <div className="num text-xs text-mute">{String(i + 1).padStart(2, "0")}</div>
            <div className="mt-1 text-sm font-medium">{t}</div>
            <p className="mt-1 text-[13px] leading-snug text-mute">{d}</p>
          </li>
        ))}
      </ol>
      <dl className="mt-6 grid gap-6 sm:grid-cols-3">
        <KV k="Extraction eval" v={`${ev.pass}/${ev.total} packets exact · ${ev.total}/${ev.total} audit totals`} />
        <KV k="Model" v={ev.results[0]?.model ?? ""} mono />
        <KV k="Ramp" v={rampStatus.mode === "live" ? "Sandbox API · holds written to draft bills" : "Simulated"} />
      </dl>
      <p className="mt-8 text-xs text-mute">Sample packets are synthetic. The rate table is a small snapshot.</p>
    </div>
  );
}
