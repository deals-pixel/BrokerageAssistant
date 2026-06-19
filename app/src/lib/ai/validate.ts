import type { MergedField } from "./merge";

/**
 * Deterministic sanity checks on merged fields. Adds notes / flags rather than
 * rejecting values — the admin makes the final call on the review screen.
 */
type ValidationContext = {
  scenarioKey?: string | null;
  scenarioLabel?: string | null;
};

type CommissionPerspective = {
  listingSide: boolean;
  cooperatingSide: boolean;
  specialSide: boolean;
};

export function validateFields(
  fields: MergedField[],
  transactionType: string,
  context: ValidationContext = {},
): MergedField[] {
  const get = (k: string) => fields.find((f) => f.key === k);

  const flag = (f: MergedField | undefined, note: string) => {
    if (!f) return;
    f.needsReview = true;
    f.notes = f.notes ? `${f.notes}; ${note}` : note;
  };

  normalizeCommissionFields(fields, commissionPerspective(context));

  if (transactionType === "lease") {
    const leaseStart = get("lease_start_date");
    if (leaseStart?.value) {
      const closing = get("closing_date");
      if (closing) {
        closing.value = leaseStart.value;
        closing.confidence = leaseStart.confidence;
        closing.sourceDocumentType = leaseStart.sourceDocumentType;
        closing.sourcePage = leaseStart.sourcePage;
        closing.needsReview = leaseStart.needsReview;
        closing.notes = leaseStart.notes ?? "Lease closing date set from lease start date";
      } else {
        fields.push({
          key: "closing_date",
          value: leaseStart.value,
          confidence: leaseStart.confidence,
          sourceDocumentType: leaseStart.sourceDocumentType,
          sourcePage: leaseStart.sourcePage,
          needsReview: leaseStart.needsReview,
          notes: leaseStart.notes ?? "Lease closing date set from lease start date",
        });
      }
    }
  }

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

function normalizeCommissionFields(fields: MergedField[], perspective: CommissionPerspective) {
  const get = (key: string) => fields.find((field) => field.key === key);
  const remove = (field: MergedField | undefined) => {
    if (!field) return;
    const index = fields.indexOf(field);
    if (index >= 0) fields.splice(index, 1);
  };

  let total = get("total_commission_pct");
  let listing = get("listing_commission_pct");
  let cooperating = get("cooperating_commission_pct");

  if (perspective.listingSide && total?.sourceDocumentType === "listing_agreement" && !listing) {
    listing = {
      ...total,
      key: "listing_commission_pct",
      notes: appendNote(
        total.notes,
        "Commission from listing agreement moved to Your Commission; listing-side commission is not the total commission.",
      ),
    };
    fields.push(listing);
  }

  if (!perspective.listingSide && total?.sourceDocumentType === "listing_agreement") {
    total.notes = appendNote(
      total.notes,
      "Listing agreement commission is not treated as Your Commission for this scenario.",
    );
    remove(total);
  }

  total = get("total_commission_pct");
  listing = get("listing_commission_pct");
  cooperating = get("cooperating_commission_pct");

  if (perspective.cooperatingSide && !perspective.listingSide && cooperating && !listing) {
    listing = {
      ...cooperating,
      key: "listing_commission_pct",
      notes: appendNote(
        cooperating.notes,
        "Co-operating side commission moved to Your Commission for this scenario.",
      ),
    };
    fields.push(listing);
    remove(cooperating);
    cooperating = undefined;
  }

  total = get("total_commission_pct");
  listing = get("listing_commission_pct");
  cooperating = get("cooperating_commission_pct");

  if (!listing || !cooperating) {
    if (listing && total?.sourceDocumentType === "listing_agreement" && valuesEquivalent(total.value, listing.value)) {
      remove(total);
    }
    return;
  }

  const calculatedTotal = addCommissionValues(listing.value, cooperating.value);
  if (!calculatedTotal) {
    if (
      total?.sourceDocumentType === "listing_agreement" &&
      (valuesEquivalent(total.value, listing.value) || valuesEquivalent(total.value, cooperating.value))
    ) {
      remove(total);
    }
    return;
  }

  if (total) {
    total.value = calculatedTotal;
    total.confidence = lowerConfidence(listing.confidence, cooperating.confidence);
    total.sourceDocumentType = listing.sourceDocumentType;
    total.sourcePage = listing.sourcePage;
    total.sourceBox = listing.sourceBox;
    total.needsReview = true;
    total.notes = appendNote(total.notes, "Total commission calculated from listing and co-operating commission.");
    return;
  }

  fields.push({
    key: "total_commission_pct",
    value: calculatedTotal,
    confidence: lowerConfidence(listing.confidence, cooperating.confidence),
    sourceDocumentType: listing.sourceDocumentType,
    sourcePage: listing.sourcePage,
    sourceBox: listing.sourceBox,
    needsReview: true,
    notes: "Total commission calculated from listing and co-operating commission.",
  });
}

function commissionPerspective(context: ValidationContext): CommissionPerspective {
  const key = context.scenarioKey ?? "";
  const label = (context.scenarioLabel ?? "").toLowerCase();

  const listingSide =
    key.startsWith("sale_seller") ||
    key.startsWith("lease_landlord") ||
    key === "sale_same_agent_both_sides" ||
    key === "lease_same_agent_both_sides" ||
    label.includes("seller rep") ||
    label.includes("landlord rep");

  const cooperatingSide =
    key.startsWith("sale_buyer") ||
    key.startsWith("lease_tenant") ||
    key === "sale_same_agent_both_sides" ||
    key === "lease_same_agent_both_sides" ||
    key === "sale_seller_rep_buyer_sga" ||
    key === "lease_landlord_rep_tenant_sga" ||
    key === "pre_construction" ||
    label.includes("buyer rep") ||
    label.includes("tenant rep");

  const specialSide =
    key === "referral_paid_by_other_brokerage" ||
    key === "co_brokerage_paid_by_other_brokerage" ||
    label.includes("referral") ||
    label.includes("co-brokerage");

  return { listingSide, cooperatingSide, specialSide };
}

function appendNote(existing: string | undefined, note: string) {
  return existing ? `${existing}; ${note}` : note;
}

function lowerConfidence(a: MergedField["confidence"], b: MergedField["confidence"]) {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[a] <= rank[b] ? a : b;
}

function valuesEquivalent(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  return normalizeCommissionText(a) === normalizeCommissionText(b);
}

function addCommissionValues(a: string | null | undefined, b: string | null | undefined) {
  const numericA = num(a);
  const numericB = num(b);
  if (numericA !== null && numericB !== null) return String(roundCommission(numericA + numericB));

  const monthRentA = parseMonthRentFraction(a);
  const monthRentB = parseMonthRentFraction(b);
  if (monthRentA !== null && monthRentB !== null) {
    const total = monthRentA + monthRentB;
    if (Math.abs(total - 1) < 0.0001) return "1 month rent";
    return `${formatFraction(total)} month rent`;
  }

  return null;
}

function normalizeCommissionText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function parseMonthRentFraction(value: string | null | undefined) {
  if (!value) return null;
  const normalized = normalizeCommissionText(value);
  if (!normalized.includes("month") || !normalized.includes("rent")) return null;

  const fraction = normalized.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (denominator !== 0) return numerator / denominator;
  }

  const decimal = normalized.match(/(\d+(?:\.\d+)?)/);
  return decimal ? Number(decimal[1]) : null;
}

function formatFraction(value: number) {
  const rounded = roundCommission(value);
  if (Number.isInteger(rounded)) return String(rounded);
  if (Math.abs(rounded - 0.5) < 0.0001) return "1/2";
  if (Math.abs(rounded - 1.5) < 0.0001) return "1 1/2";
  return String(rounded);
}

function roundCommission(value: number) {
  return Math.round(value * 1000) / 1000;
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
