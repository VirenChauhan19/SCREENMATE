import { unzipSync, strFromU8 } from "fflate";

/**
 * Plain-text extraction from a CV.
 *
 * Deliberately dependency-light and forgiving: a CV that cannot be read should
 * produce a clear message, never a crash, because the user can always fall back
 * to typing their profile by hand.
 */

export type CvKind = "pdf" | "docx" | "text";

export function kindFromName(name: string, mime: string): CvKind | null {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (n.endsWith(".docx") || mime.includes("wordprocessingml")) return "docx";
  if (n.endsWith(".txt") || n.endsWith(".md") || mime.startsWith("text/")) {
    return "text";
  }
  return null;
}

async function extractPdf(buf: ArrayBuffer): Promise<string> {
  // unpdf ships a worker-free pdfjs build. The stock one resolves its worker at
  // runtime, which survives neither bundling nor serverless file tracing — it
  // parsed locally and failed in production, which is the worst way to find out.
  const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await pdfText(pdf, { mergePages: true });
  const joined = Array.isArray(text) ? text.join("\n\n") : text;
  return joined.replace(/[^\S\n]+/g, " ");
}

function extractDocx(buf: ArrayBuffer): string {
  const files = unzipSync(new Uint8Array(buf));
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("No document body in this .docx");
  return strFromU8(xml)
    // Paragraph and line breaks become real ones before tags are stripped.
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(
  buf: ArrayBuffer,
  kind: CvKind,
): Promise<string> {
  if (kind === "pdf") return extractPdf(buf);
  if (kind === "docx") return extractDocx(buf);
  return new TextDecoder().decode(buf);
}
