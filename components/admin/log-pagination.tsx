import { ADMIN_LOG_PAGE_SIZES, pageWindow } from "@/lib/admin-pagination";

export function LogPagination({ label, total, page, pageSize, hrefForPage }: {
  label: string;
  total: number;
  page: number;
  pageSize: number;
  hrefForPage: (page: number) => string;
}) {
  const window = pageWindow(total, page, pageSize);
  if (total === 0) return null;

  return <nav className="admin-log-pagination" aria-label={`${label} pages`}>
    {page > 0 ? <a href={hrefForPage(page - 1)}>Previous</a> : <span aria-hidden="true" />}
    <small>Showing {window.first.toLocaleString()}–{window.last.toLocaleString()} of {total.toLocaleString()} · Page {page + 1} of {window.pages}</small>
    {page + 1 < window.pages ? <a href={hrefForPage(page + 1)}>Next</a> : <span aria-hidden="true" />}
  </nav>;
}

export function LogPageSizeSelect({ name, value, label = "Rows per page" }: { name: string; value: number; label?: string }) {
  return <label className="admin-page-size"><span>{label}</span><select name={name} defaultValue={String(value)} aria-label={label}>
    {ADMIN_LOG_PAGE_SIZES.map((size) => <option key={size} value={size}>{size} rows</option>)}
  </select></label>;
}

