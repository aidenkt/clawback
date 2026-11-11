# Clawback

Checks customs broker bills before you pay them. Built for the BBS x Ramp hackathon.

Demo: https://clawback.aidenkt.dev

## what it does

If you import stuff, a customs broker pays your duty and bills you for it. Nobody checks those bills. And this year the IEEPA tariffs got revoked, so a lot of that duty is refundable, but only if you file for it before each shipment's deadline.

Clawback:

- reads the broker bill + the CBP 7501 with a model (every number comes with the page it was read from)
- recomputes the duty in regular code and compares it to what was filed / billed
- flags what's refundable and what the broker overcharged
- holds the bill in Ramp and drafts the email to the broker
- builds the refund claim CSV and tracks the deadline for each entry

## try it

Open the demo and click `PCB-48390`. The broker used an old tariff rate and also billed $2,400 more than they paid customs. Click the little `p.2` buttons to see where each number came from. "Hold in Ramp" actually hits the Ramp sandbox. "Re-read live" reruns the model on the PDF. You can also upload your own PDF.

## how it's built

- Next.js on Vercel
- model call goes through Vercel AI Gateway (`lib/extract.ts`), currently gemini 2.5 flash, change it with `CLAWBACK_MODEL`
- `lib/engine.ts` is all the math, no AI in there
- `lib/rates.ts` is the tariff table
- `lib/ramp.ts` + `app/api/ramp` talk to the Ramp sandbox (bills live there as drafts, a hold writes the reason to the memo)

The main idea is the model only reads. It never does math. Finance people don't trust AI numbers so every dollar amount comes from code and links back to the page.

## running it

```
pnpm install
vercel link && vercel env pull .env.local
pnpm dev
```

For Ramp add `RAMP_CLIENT_ID`, `RAMP_CLIENT_SECRET`, `RAMP_API_BASE=https://demo-api.ramp.com` to `.env.local` then `pnpm seed:ramp`. Without those it just fakes the Ramp part.

`pnpm check` tests the math, `pnpm eval` tests the model against the sample PDFs (4/5 exact last run, all 5 totals right).

## heads up

- the 5 sample bills are fake, I generated them (`scripts/gen-pdfs.ts`)
- rate table only has a few tariff codes
- the claim CSV columns are my guess at the format, not CBP's official template
- bills get seeded with a script, no webhook yet

## todo

- ramp webhooks
- full tariff schedule
- real broker paperwork
- duty drawback
