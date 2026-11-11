import { generateObject } from "ai";
import { Extraction } from "./types";

// goes through vercel ai gateway so the model is just an env var
export const EXTRACTION_MODEL = process.env.CLAWBACK_MODEL ?? "google/gemini-2.5-flash";

const PROMPT = `You are reading a U.S. customs broker's billing packet for an importer. It contains a broker invoice and a CBP Form 7501 entry summary.

Transcribe it into the schema. Rules:
- Copy numbers exactly as printed. Do not compute, correct, round or infer any amount or rate, even if the document looks wrong. Mistakes in the document are what the downstream audit is looking for.
- For every merchandise line on the 7501, list every duty row beneath it: the base HTS number and each Chapter 99 (9903.xx.xx) number, with its printed rate and printed duty. "Free" is rate 0.
- For every row, give the 1-based page it is printed on and quote the row's text verbatim.
- List every charge row on the broker invoice in order. If the same charge is printed twice, list it twice.
- kind: "duty" for customs duty advanced, "mpf" for merchandise processing fee, "hmf" for harbor maintenance fee, "brokerage" for the broker's own service fees, "other" otherwise.
- Dates as YYYY-MM-DD. Country of origin as a 2-letter ISO code.`;

export async function extractFromPdf(pdf: Uint8Array): Promise<{ extraction: Extraction; model: string; ms: number }> {
  const t0 = Date.now();
  const { object } = await generateObject({
    model: EXTRACTION_MODEL,
    schema: Extraction,
    temperature: 0,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: pdf, mediaType: "application/pdf" },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  return { extraction: object, model: EXTRACTION_MODEL, ms: Date.now() - t0 };
}
