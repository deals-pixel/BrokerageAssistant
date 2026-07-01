const DOC_LABEL_OVERRIDES: Record<string, string> = {
  "Deal Information Sheet": "Deal Info",
  "Proof of Deposit": "Deposit Proof",
  "Deposit Proof (draft / cheque / wire)": "Deposit Proof",
  "Copy of Deposit Receipt from Other Brokerage": "Deposit Receipt",
  "Listing Agreement with Office Schedule A": "Listing Agmt (Sch. A)",
  "Listing Agreement (Form 200 / 270)": "Listing Agmt",
  "Agreement of Purchase and Sale with Office Schedule B": "APS (Sch. B)",
  "Agreement of Purchase and Sale (Form 100)": "APS",
  "First Page of the Agreement of Purchase and Sale": "APS First Page",
  "Agreement to Lease with Office Schedule B": "Lease Agmt (Sch. B)",
  "Agreement to Lease": "Lease Agmt",
  "Lease Agreement": "Lease Agmt",
  "Ontario Residential Tenancy Agreement": "ON Standard Lease",
  "Buyer Representation Agreement with Office Schedule A": "Buyer Rep (Sch. A)",
  "Buyer Representation Agreement (Form 371)": "Buyer Rep",
  "Tenant Representation Agreement with Office Schedule A": "Tenant Rep (Sch. A)",
  "Tenant Representation Agreement": "Tenant Rep",
  "RECO Information Guide": "RECO Guide",
  "RECO Information Guide Acknowledgement": "RECO Guide",
  "RECO Self-Represented Party Disclosure": "Self-Rep Disclosure",
  "Confirmation of Cooperation": "Co-op Conf.",
  "Confirmation of Co-operation (Form 320 / 324)": "Co-op Conf.",
  "Individual Identification Record (Form 630 / FINTRAC)": "FINTRAC",
  "PEP / HIO Checklist (Form 634)": "PEP",
  "Receipt of Funds Record (Form 635)": "Receipt of Funds",
  "Offer Summary Document (Form 801)": "Form 801",
  "Referral Agreement": "Referral Agmt",
  "Co-brokerage Agreement": "Co-brokerage",
  "Waiver / Notice of Fulfillment / Amendment": "Waiver/NOF/Amend.",
  "Corporate ID / Entity Identification / Articles of Incorporation": "Corp. ID/Articles",
  "Attestation of Beneficial Ownership": "Beneficial Ownership",
  "Confirmation of Cooperation from Builder": "Builder Co-op Conf.",
};

const DOC_TYPE_OVERRIDES: Record<string, string> = {
  deal_information_sheet: "Deal Info",
  agreement_of_purchase_and_sale: "APS",
  first_page_aps: "APS First Page",
  agreement_to_lease: "Lease Agmt",
  lease_agreement: "Lease Agmt",
  ontario_residential_tenancy_agreement: "ON Standard Lease",
  form_801_offer_summary: "Form 801",
  form_320_confirmation_cooperation: "Co-op Conf.",
  form_630_individual_identification: "FINTRAC",
  form_631_pep_checklist: "PEP",
  form_635_receipt_of_funds: "Receipt of Funds",
  deposit_proof: "Deposit Proof",
  copy_deposit_receipt_other_brokerage: "Deposit Receipt",
  form_124_notice_fulfillment: "NOF",
  waiver_notice_fulfillment_amendment: "Waiver/NOF/Amend.",
  listing_agreement: "Listing Agmt",
  buyer_representation_agreement: "Buyer Rep",
  tenant_representation_agreement: "Tenant Rep",
  reco_information_guide_ack: "RECO Guide",
  reco_self_represented_disclosure: "Self-Rep Disclosure",
  registrant_disclosure_of_interest: "Disclosure Interest",
  multiple_representation_consent: "Multi-Rep Consent",
  corporate_id_articles: "Corp. ID/Articles",
  attestation_beneficial_ownership: "Beneficial Ownership",
  referral_agreement: "Referral Agmt",
  co_brokerage_agreement: "Co-brokerage",
  mls_listing: "MLS Listing",
  builder_confirmation_cooperation: "Builder Co-op Conf.",
  mls_data_form: "MLS Data Form",
  other: "Other",
  unknown: "Unknown",
};

export function shortAddress(value: string | null | undefined) {
  if (!value) return "";
  const normalized = value
    .replace(/\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*,\s*$/, "")
    .trim();
  const parts = normalized
    .split(",")
    .map((part) => cleanAddressPart(part))
    .filter(Boolean);

  const streetIndex = parts.findIndex(hasStreetAddress);
  if (streetIndex >= 0) {
    const splitStreet = splitUnitAndStreet(parts[streetIndex]);
    const unit =
      splitStreet.unit ||
      firstUnitPart(parts.slice(0, streetIndex)) ||
      firstUnitPart(parts.slice(streetIndex + 1));
    const street = splitStreet.street;
    const city = firstLocationPart(parts, streetIndex + 1);
    return [unit, street, city].filter(Boolean).join(", ");
  }

  if (parts.length >= 2) {
    const city = firstLocationPart(parts, 1);
    return [parts[0], city].filter(Boolean).join(", ");
  }

  return cleanAddressPart(normalized);
}

export function shortDealTitle(address: string | null | undefined, fallback: string) {
  return shortAddress(address) || fallback;
}

export function shortDocumentLabel(value: string | null | undefined) {
  if (!value) return "";
  const normalized = value.trim();
  if (DOC_LABEL_OVERRIDES[normalized]) return DOC_LABEL_OVERRIDES[normalized];
  if (DOC_TYPE_OVERRIDES[normalized]) return DOC_TYPE_OVERRIDES[normalized];

  let result = normalized;
  result = result.replace(/\bAgreement\b/g, "Agmt");
  result = result.replace(/\bSchedule\b/g, "Sch.");
  result = result.replace(/\bInformation\b/g, "Info");
  result = result.replace(/\bConfirmation\b/g, "Conf.");
  result = result.replace(/\bPurchase and Sale\b/g, "P&S");
  result = result.replace(/\bRepresentation\b/g, "Rep");
  result = result.replace(/\bCo-operation\b/g, "Co-op");
  result = result.replace(/\bCooperation\b/g, "Co-op");
  result = result.replace(/\s+/g, " ").trim();
  return result;
}

function cleanAddressPart(value: string) {
  return value
    .replace(/\b(Ontario|ON)\b\.?/gi, "")
    .replace(/\b[NSEWC]\d{2}\b/g, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function firstLocationPart(parts: string[], startIndex: number) {
  for (const part of parts.slice(startIndex)) {
    if (!part || isUnitPart(part)) continue;
    return part;
  }
  return "";
}

function firstUnitPart(parts: string[]) {
  const unit = parts.find(isUnitPart);
  return unit ? cleanUnitPart(unit) : "";
}

function hasStreetAddress(value: string) {
  return /\d/.test(value) && /\b(?:street|st\.?|avenue|ave\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|court|ct\.?|crescent|cres\.?|blvd|boulevard|highway|hwy)\b/i.test(value);
}

function isUnitPart(value: string) {
  return /^(?:unit|suite|apt|apartment|#|ph|sph)?\s*[a-z]?\d+[a-z]?$/i.test(value.trim()) || /^(?:bsmt|basement|lower|main|upper)$/i.test(value.trim());
}

function splitUnitAndStreet(value: string) {
  const match = value.match(/^(#?\s*(?:unit\s+|suite\s+|apt\s+|apartment\s+)?[a-z]?\d+[a-z]?|ph\s*\d+[a-z]?|sph\s*\d+[a-z]?|bsmt|basement|lower|main|upper)\s*[-–]\s*(\d{1,6}\s+.+)$/i);
  if (!match) return { unit: "", street: value };
  return { unit: cleanUnitPart(match[1]), street: match[2].trim() };
}

function cleanUnitPart(value: string) {
  return value
    .replace(/^#\s*/i, "")
    .replace(/^(?:unit|suite|apt|apartment)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}
