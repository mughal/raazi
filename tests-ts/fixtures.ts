import { PDFDocument, StandardFonts } from "pdf-lib";
import { zipSync, strToU8 } from "fflate";
export async function policyPDF() {
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of [
    "Annual leave allowance is 25 days.",
    "Travel expenses require manager approval.",
  ])
    pdf.addPage([600, 800]).drawText(text, { x: 40, y: 700, font, size: 14 });
  return Buffer.from(await pdf.save());
}
export function policyDOCX() {
  return Buffer.from(
    zipSync({
      "word/document.xml": strToU8(
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Travel policy</w:t></w:r></w:p><w:p><w:r><w:t>Manager approval is required for travel.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Hotel limit</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>200</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>',
      ),
    }),
  );
}
export function vector(text: string) {
  return /travel|manager/i.test(text) ? [0, 1, 0] : [1, 0, 0];
}
export const mockRequest = async (url: string, body: any) =>
  url.endsWith("/embeddings")
    ? {
        data: body.input.map((text: string, index: number) => ({
          index,
          embedding: vector(text),
        })),
      }
    : {
        choices: [
          {
            message: {
              content: body.messages?.[0]?.content.startsWith(
                "You answer only from the supplied DOCUMENTS",
              )
                ? JSON.stringify({
                    answerable: true,
                    answer:
                      "The answer is supported by the retrieved policy [1].",
                    evidence: [
                      {
                        source: 1,
                        quote: body.messages[0].content
                          .split("\nDOCUMENTS:\n")[1]
                          .split("\n")
                          .slice(1)
                          .join("\n")
                          .split("\n\n")[0],
                      },
                    ],
                  })
                : "The answer is supported by the retrieved policy [1].",
            },
          },
        ],
      };
