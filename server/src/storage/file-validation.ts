import { PayloadTooLargeError, ValidationError } from "../common/errors";
import { MAX_UPLOAD_BYTES } from "./storage.types";

const ALLOWED = new Map<string, string>([
  ["pdf", "application/pdf"],
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["txt", "text/plain"],
  ["csv", "text/csv"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
]);

export function sanitizeFilename(raw: string): string {
  const stripped = raw.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = stripped
    .split("")
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code > 31 && code !== 127;
    })
    .join("")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new ValidationError("Invalid filename");
  }
  return cleaned.slice(0, 255);
}

function startsWith(contents: Buffer, bytes: number[] | string) {
  const expected = typeof bytes === "string" ? Buffer.from(bytes) : Buffer.from(bytes);
  return contents.length >= expected.length && contents.subarray(0, expected.length).equals(expected);
}

export function assertContentsMatchType(ext: string, contents: Buffer) {
  switch (ext) {
    case "pdf":
      if (!startsWith(contents, "%PDF-")) {
        throw new ValidationError("File contents do not match the filename");
      }
      return;
    case "png":
      if (!startsWith(contents, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        throw new ValidationError("File contents do not match the filename");
      }
      return;
    case "jpg":
    case "jpeg":
      if (!startsWith(contents, [0xff, 0xd8, 0xff])) {
        throw new ValidationError("File contents do not match the filename");
      }
      return;
    case "gif":
      if (!startsWith(contents, "GIF87a") && !startsWith(contents, "GIF89a")) {
        throw new ValidationError("File contents do not match the filename");
      }
      return;
    case "webp":
      if (!startsWith(contents, "RIFF") || contents.subarray(8, 12).toString() !== "WEBP") {
        throw new ValidationError("File contents do not match the filename");
      }
      return;
    case "docx":
    case "xlsx":
      if (!startsWith(contents, [0x50, 0x4b, 0x03, 0x04])) {
        throw new ValidationError("File contents do not match the filename");
      }
      return;
    case "txt":
    case "csv":
      if (contents.includes(0)) {
        throw new ValidationError("File contents do not match the filename");
      }
      return;
    default:
      throw new ValidationError("File type is not allowed");
  }
}

export function validateUpload(
  filename: string,
  mimeType: string,
  byteSize: number,
  contents?: Buffer,
) {
  if (byteSize <= 0) {
    throw new ValidationError("File is empty");
  }
  if (byteSize > MAX_UPLOAD_BYTES) {
    throw new PayloadTooLargeError();
  }

  const safeName = sanitizeFilename(filename);
  const ext = safeName.includes(".") ? safeName.split(".").pop()?.toLowerCase() ?? "" : "";
  const expectedMime = ALLOWED.get(ext);
  if (!expectedMime) {
    throw new ValidationError("File type is not allowed");
  }

  const declared = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (declared !== expectedMime) {
    throw new ValidationError("File type does not match the filename");
  }

  if (contents) {
    if (contents.length !== byteSize) {
      throw new ValidationError("File size does not match the upload");
    }
    assertContentsMatchType(ext, contents);
  }

  return { filename: safeName, mimeType: expectedMime, byteSize };
}

export function sanitizeRenamedFilename(filename: string, mimeType: string) {
  const safeName = sanitizeFilename(filename);
  const ext = safeName.includes(".") ? safeName.split(".").pop()?.toLowerCase() ?? "" : "";
  const expectedMime = ALLOWED.get(ext);
  if (!expectedMime || expectedMime !== mimeType) {
    throw new ValidationError("Renamed file must keep the same allowed type");
  }
  return safeName;
}
