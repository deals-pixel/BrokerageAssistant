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

  normalizeLegacySourceFields(fields);
  const perspective = commissionPerspective(context);
  normalizeScenarioDerivedFields(fields, perspective);
  normalizeSideBrokerageDisplayFields(fields);
  normalizeConditionalGateFields(fields);
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
  const price = num(get("price_or_rent")?.value);
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
    flag(get("price_or_rent"), "Rent value unusually high for a lease — verify");
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
  preferDealSheetDerivedCommission(fields, "your_commission_pct", existingYourCommission);
  preferDealSheetDerivedCommission(fields, "outside_brokerage_commission_pct", existingOutsideCommission);

  if (!listing || !cooperating) return;

  const calculatedTotal = addCommissionValues(listing.value, cooperating.value);
  if (!calculatedTotal) {
    return;
  }

  if (total) {
    if (isDealInformationSheetField(total)) {
      if (!fieldValuesAgree(total.value, calculatedTotal)) {
        total.conflictSources = conflictSourcesFor(total, {
          ...listing,
          value: calculatedTotal,
          confidence: lowerConfidence(listing.confidence, cooperating.confidence),
          needsReview: true,
          notes: "Calculated from listing and co-operating commission.",
        });
        total.needsReview = true;
        total.notes = appendNote(
          total.notes,
          "Deal Information Sheet used as primary source; calculated side commission total disagreed.",
        );
      }
      return;
    }
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

const LEGACY_SOURCE_FIELD_ALIASES: Record<string, string> = {
  sale_price: "price_or_rent",
  seller_names: "seller_landlord_names",
  seller_emails: "seller_landlord_emails",
  seller_phone: "seller_landlord_phone",
  seller_is_corporation: "seller_landlord_is_corporation",
  seller_address: "seller_landlord_address",
  buyer_names: "buyer_tenant_names",
  buyer_emails: "buyer_tenant_emails",
  buyer_phone: "buyer_tenant_phone",
  buyer_is_corporation: "buyer_tenant_is_corporation",
  buyer_address: "buyer_tenant_address",
  deposit_held_by: "deposit_holder",
};

function normalizeLegacySourceFields(fields: MergedField[]) {
  for (const field of [...fields]) {
    const targetKey = LEGACY_SOURCE_FIELD_ALIASES[field.key];
    if (!targetKey) continue;

    const existing = fields.find((candidate) => candidate.key === targetKey);
    if (!existing) {
      field.key = targetKey;
      field.notes = appendNote(field.notes, "Mapped from legacy source field.");
      continue;
    }

    if (!fieldValuesAgree(existing.value, field.value)) {
      existing.conflictSources = conflictSourcesFor(existing, field);
      existing.needsReview = true;
      existing.notes = appendNote(existing.notes, "Legacy source field had a different value.");
    }

    const index = fields.indexOf(field);
    if (index >= 0) fields.splice(index, 1);
  }
}

function normalizeScenarioDerivedFields(fields: MergedField[], perspective: CommissionPerspective) {
  const get = (key: string) => fields.find((field) => field.key === key);
  const existing = new Map<string, MergedField | undefined>();
  for (const key of [
    "outside_agent_name",
    "outside_brokerage",
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
    "outside_agent_name",
    "outside_brokerage",
    "deposit_held_by_sutton",
  ]);

  const outsideAgent =
    preferredDealSheetSource(
      existing.get("outside_agent_name"),
      outsideSideSource(perspective, get("listing_agent_name"), get("cooperating_agent_name")),
    );
  const outsideBrokerage =
    preferredDealSheetSource(
      existing.get("outside_brokerage"),
      outsideSideSource(perspective, get("listing_brokerage"), get("cooperating_brokerage")),
    );
  deriveFromSource(fields, "outside_agent_name", outsideAgent, "Derived after scenario detection from the outside side agent.");
  deriveFromSource(
    fields,
    "outside_brokerage",
    outsideBrokerage,
    "Derived after scenario detection from the outside side brokerage.",
  );

  const heldBySutton = depositHeldBySuttonField(get("deposit_holder")) ?? existing.get("deposit_held_by_sutton");
  if (heldBySutton) fields.push(heldBySutton);
}

function normalizeSideBrokerageDisplayFields(fields: MergedField[]) {
  deriveSideBrokerageDisplay(
    fields,
    "listing_brokerage",
    fields.find((field) => field.key === "seller_representation"),
    "Seller/landlord side status shown because no listing brokerage name was extracted.",
  );
  deriveSideBrokerageDisplay(
    fields,
    "cooperating_brokerage",
    fields.find((field) => field.key === "buyer_representation"),
    "Buyer/tenant side status shown because no co-operating brokerage name was extracted.",
  );
}

function normalizeConditionalGateFields(fields: MergedField[]) {
  deriveYesNoGate(fields, "additional_payees", [
    "additional_payee_1_name",
    "additional_payee_1_commission_pct",
    "additional_payee_2_name",
    "additional_payee_2_commission_pct",
  ]);
  deriveYesNoGate(fields, "marketing_fee", ["marketing_fee_amount"]);
  deriveYesNoGate(fields, "rebate_to_clients", ["rebate_amount"]);
  deriveYesNoGate(fields, "referral", ["referral_to"]);
}

function deriveYesNoGate(fields: MergedField[], gateKey: string, dependentKeys: string[]) {
  if (fields.some((field) => field.key === gateKey && field.value?.trim())) return;
  const source = dependentKeys.map((key) => fields.find((field) => field.key === key)).find((field) => field?.value?.trim());
  if (!source) return;
  fields.push({
    ...source,
    key: gateKey,
    value: "yes",
    needsReview: source.needsReview,
    notes: appendNote(source.notes, "Derived from related detail field."),
  });
}

function deriveSideBrokerageDisplay(
  fields: MergedField[],
  brokerageKey: "listing_brokerage" | "cooperating_brokerage",
  representation: MergedField | undefined,
  note: string,
) {
  const brokerage = fields.find((field) => field.key === brokerageKey);
  if (brokerage?.value && !isPlaceholderBrokerageValue(brokerage.value)) return;

  const displayValue = representationDisplayValue(representation?.value);
  if (!displayValue) return;

  const replacement = {
    ...(brokerage ?? representation),
    key: brokerageKey,
    value: displayValue,
    confidence: brokerage?.confidence ?? representation?.confidence ?? "medium",
    sourceDocumentType: brokerage?.sourceDocumentType ?? representation?.sourceDocumentType,
    sourcePage: brokerage?.sourcePage ?? representation?.sourcePage,
    sourceBox: brokerage?.sourceBox ?? representation?.sourceBox,
    conflictSources: brokerage?.conflictSources ?? representation?.conflictSources,
    needsReview: brokerage?.needsReview ?? representation?.needsReview ?? true,
    notes: appendNote(brokerage?.notes ?? representation?.notes, note),
  };

  if (brokerage) {
    Object.assign(brokerage, replacement);
  } else {
    fields.push(replacement);
  }
}

function representationDisplayValue(value: string | null | undefined) {
  const text = normalizeText(value);
  if (!text) return null;
  if (text.includes("self represented") || text.includes("self-represented") || text.includes("unrepresented")) {
    return "Self-represented";
  }
  if (text.includes("sutton") || text.includes("sga")) return "Sutton Group-Admiral";
  if (text.includes("other brokerage") || text.includes("another brokerage")) return "Other brokerage";
  return null;
}

function isPlaceholderBrokerageValue(value: string) {
  const text = normalizeText(value);
  return ["", "unknown", "n/a", "na", "none"].includes(text);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function preferDealSheetDerivedCommission(
  fields: MergedField[],
  key: "your_commission_pct" | "outside_brokerage_commission_pct",
  dealSheetField: MergedField | undefined,
) {
  if (!dealSheetField || !isDealInformationSheetField(dealSheetField)) return;
  const current = fields.find((field) => field.key === key);
  if (!current) {
    fields.push(dealSheetField);
    return;
  }
  if (current === dealSheetField) return;

  const conflict = current.value && !fieldValuesAgree(current.value, dealSheetField.value);
  Object.assign(current, {
    ...dealSheetField,
    conflictSources: conflict ? conflictSourcesFor(dealSheetField, current) : dealSheetField.conflictSources,
    needsReview: dealSheetField.needsReview || Boolean(conflict),
    notes: appendNote(
      dealSheetField.notes,
      conflict
        ? "Deal Information Sheet used as primary source; derived commission from side fields disagreed."
        : "Deal Information Sheet used as primary source.",
    ),
  });
}

function preferredDealSheetSource(
  dealSheetField: MergedField | undefined,
  fallback: MergedField | undefined,
) {
  return isDealInformationSheetField(dealSheetField) ? dealSheetField : fallback ?? dealSheetField;
}

function isDealInformationSheetField(field: MergedField | undefined): boolean {
  return field?.sourceDocumentType === "deal_information_sheet";
}

function conflictSourcesFor(primary: MergedField, secondary: MergedField) {
  return [primary, secondary].map((field) => ({
    value: field.value ?? "",
    confidence: field.confidence,
    sourceDocumentType: field.sourceDocumentType,
    sourcePage: field.sourcePage,
    sourceBox: field.sourceBox,
  }));
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

function fieldValuesAgree(a: string | null | undefined, b: string | null | undefined) {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  if (!left && !right) return true;
  const leftNumber = num(left);
  const rightNumber = num(right);
  if (leftNumber !== null && rightNumber !== null) return Math.abs(leftNumber - rightNumber) < 0.005;
  return left.toLowerCase().replace(/\s+/g, " ") === right.toLowerCase().replace(/\s+/g, " ");
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
