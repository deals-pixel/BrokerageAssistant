import { DOCUMENT_TYPES, type DocumentType, type TransactionType } from "@/lib/types";
import { standardFormLabelsForDocumentTypes } from "@/lib/standard-forms";

export type RequirementLevel = "required" | "conditional" | "optional";

export type DocumentRequirement = {
  id: string;
  label: string;
  docTypes: DocumentType[];
  level: RequirementLevel;
  side?: "seller" | "buyer" | "landlord" | "tenant" | "deal";
  condition?: string;
  taskTitle?: string;
  standardForms?: string[];
};

export type ScenarioDefinition = {
  key: string;
  number: number;
  transactionType: "purchase" | "lease" | "referral" | "co_brokerage" | "pre_construction";
  label: string;
  shortLabel: string;
  description: string;
  requirements: DocumentRequirement[];
};

type PageLike = { doc_type: string | null };
type FieldLike = { field_key: string; value: string | null };
type SgaDealSide = "listing" | "cooperating" | "both" | "unknown";
type SideRepresentation = "sga" | "other" | "self" | "unknown";
type DealSideEvidence = {
  listing: SideRepresentation;
  cooperating: SideRepresentation;
};

const noticeDocs: DocumentType[] = [
  "form_124_notice_fulfillment",
  "waiver_notice_fulfillment_amendment",
];

const leaseDocs: DocumentType[] = [
  "agreement_to_lease",
  "lease_agreement",
  "ontario_residential_tenancy_agreement",
];

const depositDocs: DocumentType[] = ["deposit_proof", "copy_deposit_receipt_other_brokerage"];

function req(
  id: string,
  docTypes: DocumentType | DocumentType[],
  label?: string,
  side?: DocumentRequirement["side"],
): DocumentRequirement {
  const docs = Array.isArray(docTypes) ? docTypes : [docTypes];
  const baseLabel = label ?? DOCUMENT_TYPES[docs[0]];
  return {
    id,
    label: side ? `${titleCase(side)} ${baseLabel}` : baseLabel,
    docTypes: docs,
    level: "required",
    side,
    taskTitle: `Request ${side ? `${titleCase(side)} ` : ""}${baseLabel}`,
    standardForms: standardFormLabelsForDocumentTypes(docs),
  };
}

function conditional(
  id: string,
  docTypes: DocumentType | DocumentType[],
  condition: string,
  label?: string,
  side?: DocumentRequirement["side"],
): DocumentRequirement {
  const docs = Array.isArray(docTypes) ? docTypes : [docTypes];
  const baseLabel = label ?? DOCUMENT_TYPES[docs[0]];
  return {
    id,
    label: side ? `${titleCase(side)} ${baseLabel}` : baseLabel,
    docTypes: docs,
    level: "conditional",
    side,
    condition,
    taskTitle: `Request ${side ? `${titleCase(side)} ` : ""}${baseLabel}`,
    standardForms: standardFormLabelsForDocumentTypes(docs),
  };
}

function optional(
  id: string,
  docTypes: DocumentType | DocumentType[],
  label?: string,
): DocumentRequirement {
  const docs = Array.isArray(docTypes) ? docTypes : [docTypes];
  return {
    id,
    label: label ?? DOCUMENT_TYPES[docs[0]],
    docTypes: docs,
    level: "optional",
    standardForms: standardFormLabelsForDocumentTypes(docs),
  };
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

const dealSheet = req("deal_information_sheet", "deal_information_sheet");
const proofOfDeposit = req("proof_of_deposit", "deposit_proof", "Proof of Deposit");
const reco = req("reco_information_guide", "reco_information_guide_ack", "RECO Information Guide");
const confirmation = req(
  "confirmation_of_cooperation",
  "form_320_confirmation_cooperation",
  "Confirmation of Cooperation",
);
const sellerCorp = [
  conditional(
    "seller_corporate_id_articles",
    "corporate_id_articles",
    "Required when the seller/landlord is a corporation.",
    "Corporate ID and Articles of Incorporation",
    "seller",
  ),
  conditional(
    "seller_beneficial_ownership",
    "attestation_beneficial_ownership",
    "Required when the seller/landlord is a corporation.",
    "Attestation of Beneficial Ownership",
    "seller",
  ),
];
const buyerCorp = [
  conditional(
    "buyer_corporate_id_articles",
    "corporate_id_articles",
    "Required when the buyer/tenant is a corporation.",
    "Corporate ID and Articles of Incorporation",
    "buyer",
  ),
  conditional(
    "buyer_beneficial_ownership",
    "attestation_beneficial_ownership",
    "Required when the buyer/tenant is a corporation.",
    "Attestation of Beneficial Ownership",
    "buyer",
  ),
];
const sellerFintrac = [
  req("seller_fintrac", "form_630_individual_identification", "FINTRAC ID", "seller"),
  req("seller_pep", "form_631_pep_checklist", "PEP / HIO Checklist", "seller"),
];
const buyerFintrac = [
  req("buyer_fintrac", "form_630_individual_identification", "FINTRAC ID", "buyer"),
  req("buyer_pep", "form_631_pep_checklist", "PEP / HIO Checklist", "buyer"),
];
const sellerOptionals = [
  optional("form_801_unaccepted_offers", "form_801_offer_summary", "Form 801 for Unaccepted Offers"),
  optional("referral_agreement", "referral_agreement"),
  optional("waiver_notice_amendment", noticeDocs, "Waiver / Notice of Fulfillment / Amendment"),
  optional("co_brokerage_to_pay_other", "co_brokerage_agreement", "Co-brokerage Agreement"),
];
const buyerOptionals = [
  optional("buyer_referral_agreement", "referral_agreement"),
  optional("buyer_waiver_notice_amendment", noticeDocs, "Waiver / Notice of Fulfillment / Amendment"),
];

function sellerSaleSide(extra: DocumentRequirement[] = []) {
  return [
    dealSheet,
    proofOfDeposit,
    req("listing_agreement", "listing_agreement", "Listing Agreement with Office Schedule A"),
    reco,
    confirmation,
    req(
      "agreement_purchase_sale_schedule_b",
      "agreement_of_purchase_and_sale",
      "Agreement of Purchase and Sale with Office Schedule B",
    ),
    ...sellerCorp,
    ...sellerFintrac,
    ...sellerOptionals,
    ...extra,
  ];
}

function buyerSaleSide(extra: DocumentRequirement[] = []) {
  return [
    req(
      "buyer_representation_agreement",
      "buyer_representation_agreement",
      "Buyer Representation Agreement with Office Schedule A",
      "buyer",
    ),
    reco,
    optional("buyer_referral_agreement", "referral_agreement"),
    ...buyerCorp,
    ...buyerFintrac,
    req("receipt_of_funds", "form_635_receipt_of_funds", "Receipt of Funds Record", "buyer"),
    ...extra,
  ];
}

function landlordLeaseSide(extra: DocumentRequirement[] = []) {
  return [
    dealSheet,
    proofOfDeposit,
    req("lease_listing_agreement", "listing_agreement", "Listing Agreement with Office Schedule A"),
    reco,
    confirmation,
    req("agreement_to_lease_schedule_b", leaseDocs, "Agreement to Lease with Office Schedule B"),
    conditional(
      "ontario_residential_tenancy_agreement",
      "ontario_residential_tenancy_agreement",
      "Required for residential units.",
    ),
    optional("lease_form_801_unaccepted_offers", "form_801_offer_summary", "Form 801 for Unaccepted Offers"),
    optional("lease_referral_agreement", "referral_agreement"),
    optional("lease_waiver_notice_amendment", noticeDocs, "Waiver / Notice of Fulfillment / Amendment"),
    optional("lease_co_brokerage_to_pay_other", "co_brokerage_agreement", "Co-brokerage Agreement"),
    ...extra,
  ];
}

function tenantLeaseSide(extra: DocumentRequirement[] = []) {
  return [
    req(
      "tenant_representation_agreement",
      "tenant_representation_agreement",
      "Tenant Representation Agreement with Office Schedule A",
      "tenant",
    ),
    reco,
    optional("tenant_referral_agreement", "referral_agreement"),
    ...extra,
  ];
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    key: "sale_seller_only",
    number: 1,
    transactionType: "purchase",
    label: "Sale - Seller Rep Only",
    shortLabel: "Seller Rep",
    description: "Only the seller(s) are represented by an SGA agent.",
    requirements: sellerSaleSide(),
  },
  {
    key: "sale_same_agent_both_sides",
    number: 2,
    transactionType: "purchase",
    label: "Sale - Same SGA Agent Represents Buyer and Seller",
    shortLabel: "Seller Rep / Buyer Rep",
    description: "Buyer and seller are represented by the same SGA agent.",
    requirements: [
      ...sellerSaleSide([
        req(
          "seller_multiple_representation_consent",
          "multiple_representation_consent",
          "Multiple Representation Consent Form",
          "seller",
        ),
      ]),
      ...buyerSaleSide([
        req(
          "buyer_multiple_representation_consent",
          "multiple_representation_consent",
          "Multiple Representation Consent Form",
          "buyer",
        ),
      ]),
    ],
  },
  {
    key: "sale_seller_rep_buyer_self",
    number: 3,
    transactionType: "purchase",
    label: "Sale - Seller Rep / Buyer Self-Represented",
    shortLabel: "Seller Rep / Buyer Self-Rep",
    description: "Seller is represented by an SGA agent and buyer is self-represented.",
    requirements: [
      ...sellerSaleSide(),
      req("buyer_self_reco", "reco_information_guide_ack", "RECO Information Guide", "buyer"),
      req(
        "buyer_self_disclosure",
        "reco_self_represented_disclosure",
        "RECO Information and Disclosure to Self-Represented Party",
        "buyer",
      ),
      ...buyerCorp,
      ...buyerFintrac,
    ],
  },
  {
    key: "sale_seller_rep_buyer_sga",
    number: 4,
    transactionType: "purchase",
    label: "Sale - Seller Rep / Buyer Different SGA Agent",
    shortLabel: "Seller Rep / Buyer Rep",
    description: "Seller and buyer are represented by different SGA agents.",
    requirements: [
      ...sellerSaleSide(),
      dealSheet,
      ...buyerSaleSide(),
    ],
  },
  {
    key: "lease_landlord_only",
    number: 5,
    transactionType: "lease",
    label: "Lease - Landlord Rep Only",
    shortLabel: "Landlord Rep",
    description: "Only the landlord(s) are represented by an SGA agent.",
    requirements: landlordLeaseSide(),
  },
  {
    key: "lease_same_agent_both_sides",
    number: 6,
    transactionType: "lease",
    label: "Lease - Same SGA Agent Represents Tenant and Landlord",
    shortLabel: "Landlord Rep / Tenant Rep",
    description: "Tenant and landlord are represented by the same SGA agent.",
    requirements: [
      ...landlordLeaseSide([
        req(
          "landlord_multiple_representation_consent",
          "multiple_representation_consent",
          "Multiple Representation Consent Form",
          "landlord",
        ),
      ]),
      ...tenantLeaseSide([
        req(
          "tenant_multiple_representation_consent",
          "multiple_representation_consent",
          "Multiple Representation Consent Form",
          "tenant",
        ),
      ]),
    ],
  },
  {
    key: "lease_landlord_rep_tenant_self",
    number: 7,
    transactionType: "lease",
    label: "Lease - Landlord Rep / Tenant Self-Represented",
    shortLabel: "Landlord Rep / Tenant Self-Rep",
    description: "Landlord is represented by an SGA agent and tenant is self-represented.",
    requirements: [
      ...landlordLeaseSide(),
      req("tenant_self_reco", "reco_information_guide_ack", "RECO Information Guide", "tenant"),
      req(
        "tenant_self_disclosure",
        "reco_self_represented_disclosure",
        "RECO Information and Disclosure to Self-Represented Party",
        "tenant",
      ),
    ],
  },
  {
    key: "lease_landlord_rep_tenant_sga",
    number: 8,
    transactionType: "lease",
    label: "Lease - Landlord Rep / Tenant Different SGA Agent",
    shortLabel: "Landlord Rep / Tenant Rep",
    description: "Landlord and tenant are represented by different SGA agents.",
    requirements: [
      ...landlordLeaseSide(),
      dealSheet,
      ...tenantLeaseSide(),
    ],
  },
  {
    key: "sale_buyer_only",
    number: 9,
    transactionType: "purchase",
    label: "Sale - Buyer Rep Only",
    shortLabel: "Buyer Rep",
    description: "Only the buyer(s) are represented by an SGA agent.",
    requirements: [
      dealSheet,
      req(
        "buyer_representation_agreement",
        "buyer_representation_agreement",
        "Buyer Representation Agreement with Office Schedule A",
        "buyer",
      ),
      reco,
      req("copy_deposit_receipt_other_brokerage", depositDocs, "Copy of Deposit Receipt", "buyer"),
      req("receipt_of_funds", "form_635_receipt_of_funds", "Receipt of Funds Record", "buyer"),
      confirmation,
      req("agreement_purchase_sale", "agreement_of_purchase_and_sale", "Agreement of Purchase and Sale"),
      ...buyerCorp,
      ...buyerFintrac,
      ...buyerOptionals,
    ],
  },
  {
    key: "sale_buyer_rep_seller_self",
    number: 10,
    transactionType: "purchase",
    label: "Sale - Buyer Rep / Seller Self-Represented",
    shortLabel: "Buyer Rep / Seller Self-Rep",
    description: "Buyer is represented by an SGA agent and seller is self-represented.",
    requirements: [
      req("seller_self_reco", "reco_information_guide_ack", "RECO Information Guide", "seller"),
      req(
        "seller_self_disclosure",
        "reco_self_represented_disclosure",
        "RECO Information and Disclosure to Self-Represented Party",
        "seller",
      ),
      ...sellerCorp,
      ...sellerFintrac,
      dealSheet,
      ...buyerSaleSide([
        confirmation,
        req("agreement_purchase_sale", "agreement_of_purchase_and_sale", "Agreement of Purchase and Sale"),
        req("copy_deposit_receipt", "deposit_proof", "Copy of Deposit Receipt", "buyer"),
        optional("buyer_waiver_notice_amendment", noticeDocs, "Waiver / Notice of Fulfillment / Amendment"),
      ]),
    ],
  },
  {
    key: "lease_tenant_only",
    number: 11,
    transactionType: "lease",
    label: "Lease - Tenant Rep Only",
    shortLabel: "Tenant Rep",
    description: "Only the tenant(s) are represented by an SGA agent.",
    requirements: [
      dealSheet,
      ...tenantLeaseSide(),
      confirmation,
      req("agreement_to_lease", leaseDocs, "Agreement to Lease"),
      req("copy_deposit_receipt_other_brokerage", depositDocs, "Copy of Deposit Receipt", "tenant"),
      optional("tenant_waiver_notice_amendment", noticeDocs, "Waiver / Notice of Fulfillment / Amendment"),
    ],
  },
  {
    key: "lease_tenant_rep_landlord_self",
    number: 12,
    transactionType: "lease",
    label: "Lease - Tenant Rep / Landlord Self-Represented",
    shortLabel: "Tenant Rep / Landlord Self-Rep",
    description: "Tenant is represented by an SGA agent and landlord is self-represented.",
    requirements: [
      req("landlord_self_reco", "reco_information_guide_ack", "RECO Information Guide", "landlord"),
      req(
        "landlord_self_disclosure",
        "reco_self_represented_disclosure",
        "RECO Information and Disclosure to Self-Represented Party",
        "landlord",
      ),
      dealSheet,
      ...tenantLeaseSide([
        confirmation,
        req("agreement_to_lease", leaseDocs, "Agreement to Lease"),
        req("copy_deposit_receipt", "deposit_proof", "Copy of Deposit Receipt", "tenant"),
        optional("tenant_waiver_notice_amendment", noticeDocs, "Waiver / Notice of Fulfillment / Amendment"),
      ]),
    ],
  },
  {
    key: "referral_paid_by_other_brokerage",
    number: 13,
    transactionType: "referral",
    label: "Referral Agreement - Paid by Different Brokerage",
    shortLabel: "Referral",
    description: "We are to be paid by a different brokerage under a referral agreement.",
    requirements: [
      dealSheet,
      req("referral_agreement", "referral_agreement"),
      optional("mls_listing", "mls_listing", "MLS Listing"),
    ],
  },
  {
    key: "co_brokerage_paid_by_other_brokerage",
    number: 14,
    transactionType: "co_brokerage",
    label: "Co-brokerage Agreement - Paid by Different Brokerage",
    shortLabel: "Co-brokerage",
    description: "We are to be paid by a different brokerage under a co-brokerage agreement.",
    requirements: [
      dealSheet,
      req("co_brokerage_agreement", "co_brokerage_agreement"),
      optional("mls_listing", "mls_listing", "MLS Listing"),
    ],
  },
  {
    key: "pre_construction",
    number: 15,
    transactionType: "pre_construction",
    label: "Pre-construction",
    shortLabel: "Pre-construction",
    description: "Builder or pre-construction transaction package.",
    requirements: [
      dealSheet,
      req("first_page_aps", ["first_page_aps", "agreement_of_purchase_and_sale"], "First Page of the APS"),
      req("builder_confirmation", "builder_confirmation_cooperation", "Confirmation of Cooperation from Builder"),
      req(
        "buyer_representation_agreement",
        "buyer_representation_agreement",
        "Buyer Representation Agreement with Office Schedule A",
        "buyer",
      ),
      reco,
      ...buyerCorp,
      ...buyerFintrac,
      optional("buyer_referral_agreement", "referral_agreement"),
    ],
  },
];

export const SCENARIO_BY_KEY = Object.fromEntries(SCENARIOS.map((s) => [s.key, s])) as Record<
  string,
  ScenarioDefinition
>;

export function scenarioForKey(key: string | null | undefined, fallbackTx: TransactionType) {
  if (key && SCENARIO_BY_KEY[key]) return SCENARIO_BY_KEY[key];
  return fallbackTx === "lease" ? SCENARIO_BY_KEY.lease_landlord_only : SCENARIO_BY_KEY.sale_seller_only;
}

export function inferScenario(
  transactionType: TransactionType,
  pages: PageLike[],
  fields: FieldLike[] = [],
): ScenarioDefinition {
  const docs = new Set(pages.map((page) => page.doc_type).filter(Boolean) as string[]);
  const fieldText = Object.fromEntries(fields.map((f) => [f.field_key, (f.value ?? "").toLowerCase()]));
  const scenarioHint = fieldText.scenario_hint ?? "";
  const representation = [
    fieldText.representation_side,
    fieldText.seller_representation,
    fieldText.buyer_representation,
  ].join(" ");

  if (docs.has("builder_confirmation_cooperation") || docs.has("first_page_aps") || scenarioHint.includes("pre")) {
    return SCENARIO_BY_KEY.pre_construction;
  }
  if (docs.has("co_brokerage_agreement") && !hasPurchaseDoc(docs) && !hasLeaseDoc(docs)) {
    return SCENARIO_BY_KEY.co_brokerage_paid_by_other_brokerage;
  }
  if (docs.has("referral_agreement") && !hasPurchaseDoc(docs) && !hasLeaseDoc(docs)) {
    return SCENARIO_BY_KEY.referral_paid_by_other_brokerage;
  }

  const hasListing = docs.has("listing_agreement");
  const hasBuyerRep = docs.has("buyer_representation_agreement");
  const hasTenantRep = docs.has("tenant_representation_agreement");
  const hasSelfRep = docs.has("reco_self_represented_disclosure");
  const hasMultipleRep = docs.has("multiple_representation_consent") || representation.includes("multiple");
  const sideEvidence = inferDealSideEvidence(docs, fieldText);
  const hasSameAgentBothSides = sameAgentBothSides(fieldText) || (hasMultipleRep && !differentAgentsBothSides(fieldText));

  if (transactionType === "lease" || hasLeaseDoc(docs)) {
    if (sideEvidence.listing === "sga" && sideEvidence.cooperating === "sga") {
      return hasSameAgentBothSides
        ? SCENARIO_BY_KEY.lease_same_agent_both_sides
        : SCENARIO_BY_KEY.lease_landlord_rep_tenant_sga;
    }
    if (sideEvidence.cooperating === "sga") {
      return isSideSelfRepresented(sideEvidence.listing, fieldText.listing_brokerage, hasSelfRep)
        ? SCENARIO_BY_KEY.lease_tenant_rep_landlord_self
        : SCENARIO_BY_KEY.lease_tenant_only;
    }
    if (sideEvidence.listing === "sga") {
      return isSideSelfRepresented(sideEvidence.cooperating, fieldText.cooperating_brokerage, hasSelfRep)
        ? SCENARIO_BY_KEY.lease_landlord_rep_tenant_self
        : SCENARIO_BY_KEY.lease_landlord_only;
    }

    if (hasListing && hasTenantRep && hasSameAgentBothSides) return SCENARIO_BY_KEY.lease_same_agent_both_sides;
    if (hasListing && hasTenantRep) return SCENARIO_BY_KEY.lease_landlord_rep_tenant_sga;
    if (hasListing && hasSelfRep) return SCENARIO_BY_KEY.lease_landlord_rep_tenant_self;
    if (hasTenantRep && hasSelfRep) return SCENARIO_BY_KEY.lease_tenant_rep_landlord_self;
    if (hasTenantRep) return SCENARIO_BY_KEY.lease_tenant_only;
    return SCENARIO_BY_KEY.lease_landlord_only;
  }

  if (sideEvidence.listing === "sga" && sideEvidence.cooperating === "sga") {
    return hasSameAgentBothSides
      ? SCENARIO_BY_KEY.sale_same_agent_both_sides
      : SCENARIO_BY_KEY.sale_seller_rep_buyer_sga;
  }
  if (sideEvidence.cooperating === "sga") {
    return isSideSelfRepresented(sideEvidence.listing, fieldText.listing_brokerage, hasSelfRep)
      ? SCENARIO_BY_KEY.sale_buyer_rep_seller_self
      : SCENARIO_BY_KEY.sale_buyer_only;
  }
  if (sideEvidence.listing === "sga") {
    return isSideSelfRepresented(sideEvidence.cooperating, fieldText.cooperating_brokerage, hasSelfRep)
      ? SCENARIO_BY_KEY.sale_seller_rep_buyer_self
      : SCENARIO_BY_KEY.sale_seller_only;
  }

  if (hasListing && hasBuyerRep && hasSameAgentBothSides) return SCENARIO_BY_KEY.sale_same_agent_both_sides;
  if (hasListing && hasBuyerRep) return SCENARIO_BY_KEY.sale_seller_rep_buyer_sga;
  if (hasListing && hasSelfRep) return SCENARIO_BY_KEY.sale_seller_rep_buyer_self;
  if (hasBuyerRep && hasSelfRep) return SCENARIO_BY_KEY.sale_buyer_rep_seller_self;
  if (hasBuyerRep) return SCENARIO_BY_KEY.sale_buyer_only;
  return SCENARIO_BY_KEY.sale_seller_only;
}

export function inferSgaDealSide(docs: Set<string>, fieldText: Record<string, string>): SgaDealSide {
  const evidence = inferDealSideEvidence(docs, fieldText);
  if (evidence.listing === "sga" && evidence.cooperating === "sga") return "both";
  if (evidence.listing === "sga") return "listing";
  if (evidence.cooperating === "sga") return "cooperating";
  return "unknown";
}

function inferDealSideEvidence(docs: Set<string>, fieldText: Record<string, string>): DealSideEvidence {
  const representedSide = sideFromRepresentationText(fieldText.representation_side);
  return {
    listing: inferSideRepresentation("listing", docs, fieldText, representedSide),
    cooperating: inferSideRepresentation("cooperating", docs, fieldText, representedSide),
  };
}

function inferSideRepresentation(
  side: "listing" | "cooperating",
  docs: Set<string>,
  fieldText: Record<string, string>,
  representedSide: SgaDealSide,
): SideRepresentation {
  const repText = side === "listing" ? fieldText.seller_representation : fieldText.buyer_representation;
  const brokerage = side === "listing" ? fieldText.listing_brokerage : fieldText.cooperating_brokerage;
  const sideAgent = side === "listing" ? fieldText.listing_agent_name : fieldText.cooperating_agent_name;

  if (representedSide === "both" || representedSide === side) return "sga";
  if (isSgaText(repText) || isSgaText(brokerage) || agentNamesMatch(fieldText.agent_name, sideAgent)) {
    return "sga";
  }
  if (isSelfRepresented(repText)) return "self";
  if (hasBrokerageName(brokerage) || isOtherBrokerageText(repText)) return "other";
  if (side === "listing" && docs.has("listing_agreement")) return "sga";
  if (side === "cooperating" && (docs.has("buyer_representation_agreement") || docs.has("tenant_representation_agreement"))) {
    return "sga";
  }
  return "unknown";
}

function sideFromRepresentationText(value: string | undefined): SgaDealSide {
  const text = normalizeText(value);
  if (!text) return "unknown";
  if (text.includes("both") || text.includes("multiple")) return "both";
  if (text.includes("listing") || text.includes("seller") || text.includes("landlord")) return "listing";
  if (
    text.includes("cooperating") ||
    text.includes("co-operating") ||
    text.includes("co op") ||
    // OREA/industry wording: "selling brokerage" means the buyer/co-operating side.
    text.includes("selling") ||
    text.includes("buyer") ||
    text.includes("tenant")
  ) {
    return "cooperating";
  }
  return "unknown";
}

function isSgaText(value: string | undefined) {
  const text = normalizeText(value);
  if (!text) return false;
  if (text.includes("sutton") && (text.includes("admiral") || text.includes("group"))) return true;
  return /\bsga\b/.test(text) || text.includes("sutton group-admiral");
}

function isSelfRepresented(value: string | undefined) {
  const text = normalizeText(value);
  return text.includes("self represented") || text.includes("self-represented") || text.includes("unrepresented");
}

function isSideSelfRepresented(
  representation: SideRepresentation,
  brokerage: string | undefined,
  hasSelfRepDocument: boolean,
) {
  if (hasBrokerageName(brokerage)) return false;
  return representation === "self" || (representation === "unknown" && hasSelfRepDocument);
}

function hasBrokerageName(value: string | undefined) {
  const text = normalizeText(value);
  if (!text) return false;
  if (["unknown", "n/a", "na", "none", "self", "self represented", "self-represented"].includes(text)) {
    return false;
  }
  return true;
}

function isOtherBrokerageText(value: string | undefined) {
  const text = normalizeText(value);
  return (
    text.includes("other brokerage") ||
    text.includes("another brokerage") ||
    text.includes("different brokerage") ||
    text.includes("outside brokerage")
  );
}

function agentNamesMatch(agentName: string | undefined, sideAgentName: string | undefined) {
  const agent = normalizeName(agentName);
  const sideAgent = normalizeName(sideAgentName);
  if (!agent || !sideAgent) return false;
  return agent === sideAgent || agent.includes(sideAgent) || sideAgent.includes(agent);
}

function sameAgentBothSides(fieldText: Record<string, string>) {
  return agentNamesMatch(fieldText.listing_agent_name, fieldText.cooperating_agent_name);
}

function differentAgentsBothSides(fieldText: Record<string, string>) {
  const listingAgent = normalizeName(fieldText.listing_agent_name);
  const cooperatingAgent = normalizeName(fieldText.cooperating_agent_name);
  if (!listingAgent || !cooperatingAgent) return false;
  return !agentNamesMatch(listingAgent, cooperatingAgent);
}

function normalizeName(value: string | undefined) {
  return normalizeText(value)
    .replace(/\b(salesperson|broker|brokerage|realty|inc|ltd)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasPurchaseDoc(docs: Set<string>) {
  return docs.has("agreement_of_purchase_and_sale") || docs.has("first_page_aps");
}

function hasLeaseDoc(docs: Set<string>) {
  return docs.has("agreement_to_lease") || docs.has("lease_agreement") || docs.has("ontario_residential_tenancy_agreement");
}
