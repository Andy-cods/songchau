'use client';

interface ExcelPreviewProps {
  data: {
    headers: string[];
    rows: string[][];
    total_rows: number;
    truncated: boolean;
    sheet_names?: string[];
    error?: string;
  };
}

export default function ExcelPreview({ data }: ExcelPreviewProps) {
  if (data.error) {
    return (
      <div className="p-4 text-sm text-red-600 bg-red-50 rounded-lg">
        Không thể xem trước: {data.error}
      </div>
    );
  }

  if (!data.headers || data.headers.length === 0) {
    return (
      <div className="p-4 text-sm text-slate-400 text-center">
        File Excel trống.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Sheet info */}
      {data.sheet_names && data.sheet_names.length > 1 && (
        <p className="text-xs text-slate-400 px-1">
          Sheet: {data.sheet_names[0]} ({data.sheet_names.length} sheets)
        </p>
      )}

      {/* Table */}
      <div className="overflow-auto max-h-[400px] border border-slate-200 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 sticky top-0">
            <tr>
              <th className="px-2 py-1.5 text-left text-slate-500 font-medium border-b border-slate-200 w-8">
                #
              </th>
              {data.headers.map((h, i) => (
                <th
                  key={i}
                  className="px-2 py-1.5 text-left text-slate-500 font-medium border-b border-slate-200 whitespace-nowrap"
                >
                  {h || `Col ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, ri) => (
              <tr key={ri} className="hover:bg-slate-50 border-b border-slate-50">
                <td className="px-2 py-1 text-slate-400">{ri + 1}</td>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-2 py-1 text-slate-700 whitespace-nowrap max-w-[200px] truncate">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Truncation notice */}
      {data.truncated && (
        <p className="text-xs text-slate-400 text-center">
          Hiển thị {data.rows.length} / {data.total_rows} dòng. Tải về để xem toàn bộ.
        </p>
      )}
    </div>
  );
}
