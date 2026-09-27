import { describe, expect, it } from "vitest";
import { sanitizeFilename, sanitizeRenamedFilename, validateUpload } from "../src/storage/file-validation";
import { assertSafeObjectKey, buildObjectKey } from "../src/storage/object-keys";
import { MAX_UPLOAD_BYTES } from "../src/storage/storage.types";

describe("file validation", () => {
  it("strips path segments and control characters from filenames", () => {
    expect(sanitizeFilename("C:\\\\temp\\\\notes.txt")).toBe("notes.txt");
    expect(sanitizeFilename("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(() => sanitizeFilename("..")).toThrow(/Invalid filename/);
  });

  it("rejects disallowed types, MIME mismatch, and oversized files", () => {
    expect(() => validateUpload("virus.exe", "application/octet-stream", 12)).toThrow(
      /not allowed/,
    );
    expect(() => validateUpload("photo.png", "application/pdf", 12)).toThrow(/does not match/);
    expect(() => validateUpload("ok.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1)).toThrow(
      /25 MiB/,
    );
    expect(validateUpload("Report.PDF", "application/pdf", 8)).toMatchObject({
      filename: "Report.PDF",
      mimeType: "application/pdf",
    });
    expect(sanitizeRenamedFilename("memo.txt", "text/plain")).toBe("memo.txt");
    expect(() => sanitizeRenamedFilename("memo.pdf", "text/plain")).toThrow(/same allowed type/);
    expect(() =>
      validateUpload("ok.pdf", "application/pdf", 9, Buffer.from("not-a-pdf")),
    ).toThrow(/contents do not match/);
    expect(() =>
      validateUpload("notes.txt", "text/plain", 4, Buffer.from([0x00, 0x01, 0x02, 0x03])),
    ).toThrow(/contents do not match/);
    expect(
      validateUpload("ok.pdf", "application/pdf", 5, Buffer.from("%PDF-")),
    ).toMatchObject({ filename: "ok.pdf", mimeType: "application/pdf" });
  });

  it("rejects path-traversal object keys", () => {
    expect(() => assertSafeObjectKey("workspaces/../secret")).toThrow(/Invalid storage key/);
    const key = buildObjectKey(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(key).toMatch(
      /^workspaces\/11111111-1111-4111-8111-111111111111\/documents\/22222222-2222-4222-8222-222222222222\/[a-f0-9]{32}$/,
    );
  });
});
