import { useRef } from "react";

export function UploadForm({
  pending,
  error,
  onUpload,
}: {
  pending: boolean;
  error?: string;
  onUpload: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <form
      className="form upload-form"
      onSubmit={(event) => {
        event.preventDefault();
        const file = fileRef.current?.files?.[0];
        if (file) onUpload(file);
      }}
    >
      <label>
        Upload a document
        <input ref={fileRef} type="file" />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? "Uploading…" : "Upload"}
      </button>
      <p className="hint">PDF, images, text, CSV, DOCX, or XLSX. 25 MiB maximum.</p>
    </form>
  );
}
