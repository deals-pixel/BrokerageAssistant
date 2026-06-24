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

  const perspective = commissionPerspective(context);
  normalizeCanonicalDealSheetFields(fields, perspective);
  normalizeCommissionFields(fields, perspective);

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
  for (const k of [
    "total_commission_pct",
    "your_commission_pct",
    "outside_brokerage_commission_pct",
    "listing_commission_pct",
    "cooperating_commission_pct",
  ]) {
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
  const existingYourCommission = get("your_commission_pct");
  const existingOutsideCommission = get("outside_brokerage_commission_pct");
  const remove = (field: MergedField | undefined) => {
    if (!field) return;
    const index = fields.indexOf(field);
    if (index >= 0) fields.splice(index, 1);
  };
  const removeDerived = () => {
    for (const field of fields.filter(
      (candidate) =>
        candidate.key === "your_commission_pct" || candidate.key === "outside_brokerage_commission_pct",
    )) {
      remove(field);
    }
  };

  removeDerived();

  const total = get("total_commission_pct");
  const listing = get("listing_commission_pct");
  const cooperating = get("cooperating_commission_pct");

  deriveScenarioCommissionFields(fields, perspective, listing, cooperating, total);
  preserveExistingDerivedCommission(fields, "your_commission_pct", existingYourCommission);
  preserveExistingDerivedCommission(fields, "outside_brokerage_commission_pct", existingOutsideCommission);

  if (!listing || !cooperating) return;

  const calculatedTotal = addCommissionValues(listing.value, cooperating.value);
  if (!calculatedTotal) {
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

function normalizeCanonicalDealSheetFields(fields: MergedField[], perspective: CommissionPerspective) {
  const get = (key: string) => fields.find((field) => field.key === key);
  const existing = new Map<string, MergedField | undefined>();
  for (const key of [
    "price_or_rent",
    "seller_landlord_names",
    "seller_landlord_emails",
    "seller_landlord_phone",
    "seller_landlord_is_corporation",
    "seller_landlord_address",
    "buyer_tenant_names",
    "buyer_tenant_emails",
    "buyer_tenant_phone",
    "buyer_tenant_is_corporation",
    "buyer_tenant_address",
    "outside_agent_name",
    "outside_brokerage",
    "deposit_holder",
    "deposit_held_by_sutton",
  ]) {
    existing.set(key, get(key));
  }
  const remove = (field: MergedField | undefined) => {
    if (!field) return;
    const index = fields.indexOf(field);
    if (index >= 0) fields.splice(index, 1);
  };
  const reset = (keys: string[]) => {
    for (const field of fields.filter((candidate) => keys.includes(candidate.key))) {
      remove(field);
    }
  };

  reset([
    "price_or_rent",
    "seller_landlord_names",
    "seller_landlord_emails",
    "seller_landlord_phone",
    "seller_landlord_is_corporation",
    "seller_landlord_address",
    "buyer_tenant_names",
    "buyer_tenant_emails",
    "buyer_tenant_phone",
    "buyer_tenant_is_corporation",
    "buyer_tenant_address",
    "outside_agent_name",
    "outside_brokerage",
    "deposit_holder",
    "deposit_held_by_sutton",
  ]);

  deriveFromSource(fields, "price_or_rent", get("sale_price") ?? existing.get("price_or_rent"), "Derived from source price/rent.");
  deriveFromSource(
    fields,
    "seller_landlord_names",
    get("seller_names") ?? existing.get("seller_landlord_names"),
    "Derived from source seller/landlord names.",
  );
  deriveFromSource(
    fields,
    "seller_landlord_emails",
    get("seller_emails") ?? existing.get("seller_landlord_emails"),
    "Derived from source seller/landlord email.",
  );
  deriveFromSource(
    fields,
    "seller_landlord_phone",
    get("seller_phone") ?? existing.get("seller_landlord_phone"),
    "Derived from source seller/landlord phone.",
  );
  deriveFromSource(
    fields,
    "seller_landlord_is_corporation",
    get("seller_is_corporation") ?? existing.get("seller_landlord_is_corporation"),
    "Derived from source seller/landlord corporation flag.",
  );
  deriveFromSource(
    fields,
    "seller_landlord_address",
    get("seller_address") ?? existing.get("seller_landlord_address"),
    "Derived from source seller/landlord address.",
  );
  deriveFromSource(
    fields,
    "buyer_tenant_names",
    get("buyer_names") ?? existing.get("buyer_tenant_names"),
    "Derived from source buyer/tenant names.",
  );
  deriveFromSource(
    fields,
    "buyer_tenant_emails",
    get("buyer_emails") ?? existing.get("buyer_tenant_emails"),
    "Derived from source buyer/tenant email.",
  );
  deriveFromSource(
    fields,
    "buyer_tenant_phone",
    get("buyer_phone") ?? existing.get("buyer_tenant_phone"),
    "Derived from source buyer/tenant phone.",
  );
  deriveFromSource(
    fields,
    "buyer_tenant_is_corporation",
    get("buyer_is_corporation") ?? existing.get("buyer_tenant_is_corporation"),
    "Derived from source buyer/tenant corporation flag.",
  );
  deriveFromSource(
    fields,
    "buyer_tenant_address",
    get("buyer_address") ?? existing.get("buyer_tenant_address"),
    "Derived from source buyer/tenant address.",
  );

  const outsideAgent =
    outsideSideSource(perspective, get("listing_agent_name"), get("cooperating_agent_name")) ??
    existing.get("outside_agent_name");
  const outsideBrokerage =
    outsideSideSource(perspective, get("listing_brokerage"), get("cooperating_brokerage")) ??
    existing.get("outside_brokerage");
  deriveFromSource(fields, "outside_agent_name", outsideAgent, "Derived after scenario detection from the outside side agent.");
  deriveFromSource(
    fields,
    "outside_brokerage",
    outsideBrokerage,
    "Derived after scenario detection from the outside side brokerage.",
  );

  const depositHolder = get("deposit_held_by") ?? existing.get("deposit_holder");
  deriveFromSource(fields, "deposit_holder", depositHolder, "Derived from source deposit holder.");
  const heldBySutton = depositHeldBySuttonField(depositHolder) ?? existing.get("deposit_held_by_sutton");
  if (heldBySutton) fields.push(heldBySutton);
}

function deriveFromSource(fields: MergedField[], key: string, source: MergedField | undefined, note: string) {
  if (!source?.value) return;
  fields.push({
    ...source,
    key,
    notes: appendNote(source.notes, note),
  });
}

function outsideSideSource(
  perspective: CommissionPerspective,
  listingSource: MergedField | undefined,
  cooperatingSource: MergedField | undefined,
) {
  if (perspective.listingSide && !perspective.cooperatingSide) return cooperatingSource;
  if (perspective.cooperatingSide && !perspective.listingSide) return listingSource;
  return undefined;
}

function depositHeldBySuttonField(source: MergedField | undefined): MergedField | undefined {
  if (!source?.value) return undefined;
  const value = source.value.toLowerCase();
  const heldBySutton =
    value.includes("sutton") || value.includes("sga") || value.includes("admiral") ? "yes" : "no";
  return {
    ...source,
    key: "deposit_held_by_sutton",
    value: heldBySutton,
    needsReview: source.needsReview || heldBySutton === "no",
    notes: appendNote(source.notes, "Derived from source deposit holder."),
  };
}

function deriveScenarioCommissionFields(
  fields: MergedField[],
  perspective: CommissionPerspective,
  listing: MergedField | undefined,
  cooperating: MergedField | undefined,
  total: MergedField | undefined,
) {
  if (perspective.specialSide) return;

  if (perspective.listingSide && perspective.cooperatingSide) {
    const combined = calculatedCombinedCommission(listing, cooperating) ?? total;
    if (combined) {
      fields.push(derivedCommissionField(
        "your_commission_pct",
        combined,
        "Derived after scenario detection: Sutton Group-Admiral is on both sides; verify side split and payees.",
        true,
      ));
    }
    return;
  }

  if (perspective.listingSide) {
    if (listing) {
      fields.push(derivedCommissionField(
        "your_commission_pct",
        listing,
        "Derived after scenario detection from listing-side commission.",
      ));
    }
    if (cooperating) {
      fields.push(derivedCommissionField(
        "outside_brokerage_commission_pct",
        cooperating,
        "Derived after scenario detection from co-operating-side commission.",
      ));
    }
    return;
  }

  if (perspective.cooperatingSide) {
    if (cooperating) {
      fields.push(derivedCommissionField(
        "your_commission_pct",
        cooperating,
        "Derived after scenario detection from co-operating-side commission.",
      ));
    }
    if (listing) {
      fields.push(derivedCommissionField(
        "outside_brokerage_commission_pct",
        listing,
        "Derived after scenario detection from listing-side commission.",
      ));
    }
  }
}

function calculatedCombinedCommission(
  listing: MergedField | undefined,
  cooperating: MergedField | undefined,
): MergedField | undefined {
  if (!listing || !cooperating) return undefined;
  const calculated = addCommissionValues(listing.value, cooperating.value);
  if (!calculated) return undefined;
  return {
    ...listing,
    value: calculated,
    confidence: lowerConfidence(listing.confidence, cooperating.confidence),
    needsReview: true,
    notes: appendNote(listing.notes, "Calculated from listing-side and co-operating-side commissions."),
  };
}

function derivedCommissionField(
  key: "your_commission_pct" | "outside_brokerage_commission_pct",
  source: MergedField,
  note: string,
  needsReview = source.needsReview,
): MergedField {
  return {
    ...source,
    key,
    needsReview,
    notes: appendNote(source.notes, note),
  };
}

function preserveExistingDerivedCommission(
  fields: MergedField[],
  key: "your_commission_pct" | "outside_brokerage_commission_pct",
  existing: MergedField | undefined,
) {
  if (!existing || fields.some((field) => field.key === key)) return;
  fields.push(existing);
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
