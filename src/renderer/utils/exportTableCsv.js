function escapeCsvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * @param {{ key: string, label: string, accessor: (row: object) => unknown }[]} columns
 * @param {object[]} rows
 */
export function buildCsvContent(columns, rows) {
  const header = columns.map((column) => escapeCsvCell(column.label)).join(',');
  const body = rows.map((row) => (
    columns.map((column) => escapeCsvCell(column.accessor(row))).join(',')
  ));

  return `\uFEFF${[header, ...body].join('\r\n')}`;
}
