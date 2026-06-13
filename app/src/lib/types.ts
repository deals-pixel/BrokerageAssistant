export const DOCUMENT_TYPES = {
  deal_information_sheet: "Deal Information Sheet",
  agreement_of_purchase_and_sale: "Agreement of Purchase and Sale (Form 100)",
  lease_agreement: "Residential Tenancy Agreement (Standard Lease)",
  form_801_offer_summary: "Offer Summary Document (Form 801)",
  form_320_confirmation_cooperation: "Confirmation of Co-operation (Form 320 / 324)",
  form_630_individual_identification: "Individual Identification Record (Form 630 / FINTRAC)",
  form_631_pep_checklist: "PEP / FINTRAC Checklist (Form 631)",
  form_635_receipt_of_funds: "Receipt of Funds Record (Form 635)",
  deposit_proof: "Deposit Proof (draft / cheque / wire)",
  form_124_notice_fulfillment: "Notice of Fulfillment of Conditions (Form 124)",
  listing_agreement: "Listing Agreement (Form 200 / 270)",
  buyer_representation_agreement: "Buyer Representation Agreement (Form 371)",
  reco_information_guide_ack: "RECO Information Guide Acknowledgement",
  reco_self_represented_disclosure: "RECO Self-Represented Party Disclosure",
  registrant_disclosure_of_interest: "Registrant Disclosure of Interest",
  multiple_representation_consent: "Multiple Representation Consent",
  mls_data_form: "MLS Data Information Form",
  other: "Other / Unrecognized",
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPES;

export type Confidence = "high" | "medium" | "low";
export type TransactionType = "purchase" | "lease" | "unknown";
export type DealStatus =
  | "uploaded"
  | "processing"
  | "extracted"
  | "in_review"
  | "reviewed"
  | "exported"
  | "error";

export type FieldReview = {
  value: string | null;
  confidence: Confidence;
  sourceDocumentType?: DocumentType;
  sourcePage?: number;
  needsReview: boolean;
  notes?: string;
};

// Field sections drive the review-screen layout and CSV/PDF export order.
// Sections mirror the brokerage's Deal Information Sheet, top to bottom.
export type FieldDef = { key: string; label: string; wide?: boolean; multiline?: boolean };

export const FIELD_SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Deal Information",
    fields: [
      { key: "agent_name", label: "Your Name (Agent)" },
      { key: "property_address", label: "Property Address", wide: true },
      { key: "closing_date", label: "Closing Date" },
      { key: "mls_number", label: "MLS Number" },
      { key: "sale_price", label: "Price / Rent" },
      { key: "firm_or_conditional", label: "Firm or Conditional" },
      { key: "conditions_summary", label: "Condition(s)", wide: true, multiline: true },
      { key: "condition_expiry_date", label: "Expiry" },
      { key: "multiple_offer", label: "Multiple Offer? (how many)" },
    ],
  },
  {
    title: "Seller's / Landlord Information",
    fields: [
      { key: "seller_names", label: "Seller Name(s)" },
      { key: "seller_emails", label: "Seller Email" },
      { key: "seller_lawyer_name", label: "Lawyer" },
      { key: "seller_lawyer_firm", label: "Lawyer Firm" },
      { key: "seller_lawyer_email", label: "Lawyer Email" },
      { key: "seller_lawyer_phone", label: "Lawyer Phone" },
      { key: "seller_address", label: "Address", wide: true },
    ],
  },
  {
    title: "Buyer's / Tenants Information",
    fields: [
      { key: "buyer_names", label: "Buyer Name(s)" },
      { key: "buyer_emails", label: "Buyer Email" },
      { key: "buyer_lawyer_name", label: "Lawyer" },
      { key: "buyer_lawyer_firm", label: "Lawyer Firm" },
      { key: "buyer_lawyer_email", label: "Lawyer Email" },
      { key: "buyer_lawyer_phone", label: "Lawyer Phone" },
      { key: "buyer_address", label: "Address", wide: true },
      { key: "buyer_phone", label: "Phone" },
    ],
  },
  {
    title: "Commission Information",
    fields: [
      { key: "total_commission_pct", label: "Total Commission %" },
      { key: "listing_commission_pct", label: "Your Commission %" },
      { key: "cooperating_commission_pct", label: "Co-Op Commission %" },
      { key: "cooperating_agent_name", label: "Outside Agent Name" },
      { key: "cooperating_brokerage", label: "Outside Agent Brokerage" },
      { key: "rebate_amount", label: "Rebate to Your Clients $" },
      { key: "referral_to", label: "Referral To" },
    ],
  },
  {
    title: "Deposit Info",
    fields: [
      { key: "deposit_held_by", label: "Held By" },
      { key: "deposit_method", label: "Wire Transfer / Direct Deposit / Cheque" },
      { key: "deposit_amount", label: "Amount $" },
      { key: "further_deposit_amount", label: "Further Deposit $" },
      { key: "further_deposit_due", label: "Further Deposit Due" },
    ],
  },
  {
    title: "Other Details (not on the printed form)",
    fields: [
      { key: "transaction_type", label: "Transaction Type" },
      { key: "representation_side", label: "Representation Side" },
      { key: "offer_date", label: "Offer Date" },
      { key: "acceptance_date", label: "Acceptance Date" },
      { key: "irrevocable_date", label: "Irrevocable Until" },
      { key: "lease_start_date", label: "Lease Start" },
      { key: "lease_end_date", label: "Lease End" },
      { key: "listing_agent_name", label: "Listing Agent" },
      { key: "listing_brokerage", label: "Listing Brokerage" },
    ],
  },
];

export const ALL_FIELD_KEYS = FIELD_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  FIELD_SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, f.label])),
);

// Document checklist rules per transaction type.
// The Deal Information Sheet is NOT required — it is the OUTPUT this app
// generates from the rest of the package.
export const REQUIRED_DOCS: Record<"purchase" | "lease", DocumentType[]> = {
  purchase: [
    "agreement_of_purchase_and_sale",
    "form_801_offer_summary",
    "form_320_confirmation_cooperation",
    "deposit_proof",
    "form_630_individual_identification",
    "form_631_pep_checklist",
  ],
  lease: ["lease_agreement", "deposit_proof"],
};

export const OPTIONAL_DOCS: Record<"purchase" | "lease", DocumentType[]> = {
  purchase: [
    "form_635_receipt_of_funds",
    "form_124_notice_fulfillment",
    "listing_agreement",
    "buyer_representation_agreement",
    "reco_information_guide_ack",
  ],
  lease: [
    "form_630_individual_identification",
    "form_631_pep_checklist",
    "listing_agreement",
    "reco_information_guide_ack",
    "reco_self_represented_disclosure",
  ],
};
