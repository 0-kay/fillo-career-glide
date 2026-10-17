// Deno-only: text extraction for uploaded résumés (PDF, DOCX, plain text).
import { extractText as extractPdfText, getDocumentProxy } from "npm:unpdf@0.12.1";
import mammoth from "npm:mammoth@1.8.0";
import { Buffer } from "node:buffer";

export async function extractResumeText(bytes: Uint8Array, fileName: string, fileType: string): Promise<string> {
  const name = fileName.toLowerCase();
  if (fileType === "application/pdf" || name.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractPdfText(pdf, { mergePages: true });
    return text;
  }
  if (name.endsWith(".docx") || fileType.includes("wordprocessingml")) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return value;
  }
  if (name.endsWith(".doc") || fileType === "application/msword") {
    throw new Error("Legacy .doc files can't be read; please upload a PDF or DOCX");
  }
  return new TextDecoder().decode(bytes);
}
