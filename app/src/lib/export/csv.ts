import { FIELD_SECTIONS, FIELD_LABELS } from "@/lib/types";

type FieldRow = { field_key: string; value: string | null };

// One-row CSV in section order — ready for Lone Wolf entry.
export function dealToCsv(fields: FieldRow[]): string {
  const byKey = new Map(fields.map((f) => [f.field_key, f.value ?? ""]));
  const keys = FIELD_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));
  const header = keys.map((k) => escapeCsv(FIELD_LABELS[k] ?? k)).join(",");
  const row = keys.map((k) => escapeCsv(byKey.get(k) ?? "")).join(",");
  return `${header}\r\n${row}\r\n`;
}

export function dealToSummaryText(
  fields: FieldRow[],
  meta: { fileName: string; transactionType: string },
): string {
  const byKey = new Map(fields.map((f) => [f.field_key, f.value]));
  const lines: string[] = [
    `DEAL SUMMARY — ${meta.transactionType.toUpperCase()}`,
    `Package: ${meta.fileName}`,
    "",
  ];
  for (const section of FIELD_SECTIONS) {
    const present = section.fields.filter((f) => byKey.get(f.key));
    if (present.length === 0) continue;
    lines.push(`${section.title}:`);
    for (const f of present) lines.push(`  ${f.label}: ${byKey.get(f.key)}`);
    lines.push("");
  }
  return lines.join("\n");
}

function escapeCsv(v: string): string {
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
