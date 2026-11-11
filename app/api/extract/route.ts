import { readFile } from "node:fs/promises";
import path from "node:path";
import { audit } from "@/lib/engine";
import { extractFromPdf } from "@/lib/extract";
import { sampleById } from "@/lib/samples";

export const maxDuration = 60;

export async function POST(req: Request) {
  let pdf: Uint8Array;
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) return Response.json({ error: "Attach a PDF as 'file'." }, { status: 400 });
      if (file.size > 8_000_000) return Response.json({ error: "PDF is larger than 8 MB." }, { status: 413 });
      pdf = new Uint8Array(await file.arrayBuffer());
    } else {
      const { sampleId } = await req.json();
      const sample = sampleById(sampleId);
      if (!sample) return Response.json({ error: "Unknown sample." }, { status: 404 });
      pdf = new Uint8Array(await readFile(path.join(process.cwd(), "public", "samples", `${sample.id}.pdf`)));
    }
    const { extraction, model, ms } = await extractFromPdf(pdf);
    return Response.json({ extraction, audit: audit(extraction), model, ms });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ error: `Extraction failed: ${message.slice(0, 300)}` }, { status: 502 });
  }
}
