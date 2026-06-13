import type { MergedField } from "./merge";

/**
 * Deterministic sanity checks on merged fields. Adds notes / flags rather than
 * rejecting values — the admin makes the final call on the review screen.
 */
export function validateFields(fields: MergedField[], transactionType: string): MergedField[] {
  const get = (k: string) => fields.find((f) => f.key === k);

  const flag = (f: MergedField | undefined, note: string) => {
    if (!f) return;
    f.needsReview = true;
    f.notes = f.notes ? `${f.notes}; ${note}` : note;
  };

  // Deposit should not exceed price
  const price = num(get("sale_price")?.value);
  const deposit = num(get("deposit_amount")?.value);
  if (price !== null && deposit !== null && deposit > price) {
    flag(get("deposit_amount"), "Deposit exceeds price — verify");
  }

  // Date ordering: offer <= acceptance <= closing
  const offer = date(get("offer_date")?.value);
  const acceptance = date(get("acceptance_date")?.value);
  const closing = date(get("closing_date")?.value);
  if (offer && acceptance && offer > acceptance) flag(get("acceptance_date"), "Acceptance before offer date");
  if (acceptance && closing && acceptance > closing) flag(get("closing_date"), "Closing before acceptance");

  // Lease dates
  const ls = date(get("lease_start_date")?.value);
  const le = date(get("lease_end_date")?.value);
  if (ls && le && ls >= le) flag(get("lease_end_date"), "Lease end not after start");

  // Commission sanity
  for (const k of ["total_commission_pct", "listing_commission_pct", "cooperating_commission_pct"]) {
    const v = num(get(k)?.value);
    if (v !== null && (v <= 0 || v > 10)) flag(get(k), "Unusual commission % — verify");
  }

  // Transaction-type specific
  if (transactionType === "lease" && price !== null && price > 50000) {
    flag(get("sale_price"), "Rent value unusually high for a lease — verify");
  }

  // Email format
  for (const k of fields.filter((f) => f.key.includes("email"))) {
    if (k.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+(\s*;\s*[^\s@]+@[^\s@]+\.[^\s@]+)*$/.test(k.value)) {
      flag(k, "Email format looks invalid");
    }
  }

  return fields;
}

function num(s: string | null | undefined): number | null {
  if (!s) return null;
  const cleaned = s.replace(/[$,%\s]/g, "");
  return cleaned !== "" && !isNaN(Number(cleaned)) ? Number(cleaned) : null;
}

function date(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
