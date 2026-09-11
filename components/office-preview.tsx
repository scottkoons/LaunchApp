'use client';
import { useEffect, useState } from 'react';

type Preview =
  | { html: string }
  | { sheets: { name: string; rows: string[][] }[] };
export function OfficePreview({ url, name }: { url: string; name: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    setError('');
    setSheet(0);
    async function load() {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('The document could not be loaded.');
        const arrayBuffer = await response.arrayBuffer();
        let result: Preview;
        if (/\.docx$/i.test(name)) {
          const [{ default: mammoth }, { default: DOMPurify }] =
            await Promise.all([import('mammoth'), import('dompurify')]);
          const converted = await mammoth.convertToHtml({ arrayBuffer });
          result = {
            html: DOMPurify.sanitize(converted.value, {
              USE_PROFILES: { html: true },
              FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe'],
            }),
          };
        } else {
          const xlsx = await import('xlsx');
          const book = xlsx.read(arrayBuffer, {
            type: 'array',
            sheetRows: 1000,
          });
          result = {
            sheets: book.SheetNames.map((title) => ({
              name: title,
              rows: xlsx.utils
                .sheet_to_json<string[]>(book.Sheets[title], {
                  header: 1,
                  raw: false,
                  defval: '',
                })
                .map((row) => row.slice(0, 100).map(String)),
            })),
          };
        }
        if (!controller.signal.aborted) setPreview(result);
      } catch (reason) {
        if (!controller.signal.aborted) setError((reason as Error).message);
      }
    }
    if (url) void load();
    return () => controller.abort();
  }, [url, name]);
  if (error)
    return (
      <p role="alert">
        {error} Download the original to open it in its usual app.
      </p>
    );
  if (!preview) return <output>Loading document…</output>;
  if ('html' in preview)
    return (
      <iframe
        className="address-office-preview"
        title={name}
        sandbox=""
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{font:15px/1.5 Georgia,serif;background:white;color:#222;padding:24px;overflow-wrap:anywhere}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px}</style></head><body>${preview.html}</body></html>`}
      />
    );
  const selected = preview.sheets[sheet];
  return (
    <div className="address-sheet-preview">
      <label>
        Sheet{' '}
        <select
          value={sheet}
          onChange={(event) => setSheet(Number(event.target.value))}
        >
          {preview.sheets.map((s, i) => (
            <option key={s.name} value={i}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div className="address-sheet-scroll">
        <table>
          <tbody>
            {selected?.rows.map((row, i) => (
              <tr key={i}>
                <th>{i + 1}</th>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Preview shows up to 1,000 rows and 100 columns per sheet. Download the
        original for the complete workbook.
      </p>
    </div>
  );
}
