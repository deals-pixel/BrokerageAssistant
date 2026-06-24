export const DOCUMENT_TYPES = {
  deal_information_sheet: "Deal Information Sheet",
  agreement_of_purchase_and_sale: "Agreement of Purchase and Sale (Form 100)",
  first_page_aps: "First Page of the Agreement of Purchase and Sale",
  agreement_to_lease: "Agreement to Lease",
  lease_agreement: "Lease Agreement",
  ontario_residential_tenancy_agreement: "Ontario Residential Tenancy Agreement",
  form_801_offer_summary: "Offer Summary Document (Form 801)",
  form_320_confirmation_cooperation: "Confirmation of Co-operation (Form 320 / 324)",
  form_630_individual_identification: "Individual Identification Record (Form 630 / FINTRAC)",
  form_631_pep_checklist: "PEP / HIO Checklist (Form 634)",
  form_635_receipt_of_funds: "Receipt of Funds Record (Form 635)",
  deposit_proof: "Deposit Proof (draft / cheque / wire)",
  copy_deposit_receipt_other_brokerage: "Copy of Deposit Receipt from Other Brokerage",
  form_124_notice_fulfillment: "Notice of Fulfillment of Conditions (Form 124)",
  waiver_notice_fulfillment_amendment: "Waiver / Notice of Fulfillment / Amendment",
  listing_agreement: "Listing Agreement (Form 200 / 270)",
  buyer_representation_agreement: "Buyer Representation Agreement (Form 371)",
  tenant_representation_agreement: "Tenant Representation Agreement",
  reco_information_guide_ack: "RECO Information Guide Acknowledgement",
  reco_self_represented_disclosure: "RECO Self-Represented Party Disclosure",
  registrant_disclosure_of_interest: "Registrant Disclosure of Interest",
  multiple_representation_consent: "Multiple Representation Consent",
  corporate_id_articles: "Corporate ID / Entity Identification / Articles of Incorporation",
  attestation_beneficial_ownership: "Attestation of Beneficial Ownership",
  referral_agreement: "Referral Agreement",
  co_brokerage_agreement: "Co-brokerage Agreement",
  mls_listing: "MLS Listing",
  builder_confirmation_cooperation: "Confirmation of Cooperation from Builder",
  mls_data_form: "MLS Data Information Form",
  other: "Other / Unrecognized",
} as const;

export type DocumentType = keyof typeof DOCUMENT_TYPES;

export type Confidence = "high" | "medium" | "low";
export type TransactionType = "purchase" | "lease" | "unknown";
export type SourceBox = { x: number; y: number; width: number; height: number };
export type FieldSourceCandidate = {
  value: string;
  confidence: Confidence;
  sourceDocumentType?: DocumentType;
  sourcePage?: number | null;
  sourceBox?: SourceBox | null;
};
export type DealStatus =
  | "uploaded"
  | "draft_from_email"
  | "awaiting_match_review"
  | "awaiting_admin_process"
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
  sourceBox?: SourceBox | null;
  conflictSources?: FieldSourceCandidate[];
  needsReview: boolean;
  notes?: string;
};

// Field sections drive the review-screen layout and CSV/PDF export order.
// Sections mirror the brokerage's Deal Information Sheet, top to bottom.
export type FieldDef = { key: string; label: string; wide?: boolean; multiline?: boolean };

export const DERIVED_DEAL_SHEET_FIELD_KEYS = new Set([
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
  "your_commission_pct",
  "outside_agent_name",
  "outside_brokerage",
  "outside_brokerage_commission_pct",
  "deposit_holder",
  "deposit_held_by_sutton",
]);

export const FIELD_SECTIONS: { title: string; fields: FieldDef[] }[] = [
  {
    title: "Deal Information",
    fields: [
      { key: "agent_name", label: "Your Name (Agent)" },
      { key: "property_address", label: "Property Address", wide: true },
      { key: "closing_date", label: "Closing Date" },
      { key: "mls_number", label: "MLS Number" },
      { key: "price_or_rent", label: "Price / Rent" },
      { key: "firm_or_conditional", label: "Firm or Conditional" },
      { key: "conditions_summary", label: "Condition(s)", wide: true, multiline: true },
      { key: "condition_expiry_date", label: "Expiry" },
      { key: "multiple_offer", label: "Multiple Offer? (how many)" },
      { key: "scenario_hint", label: "Scenario Hint" },
    ],
  },
  {
    title: "Seller's / Landlord Information",
    fields: [
      { key: "seller_landlord_names", label: "Seller/Landlord Name(s)" },
      { key: "seller_landlord_emails", label: "Seller/Landlord Email" },
      { key: "seller_landlord_phone", label: "Seller/Landlord Phone" },
      { key: "seller_landlord_is_corporation", label: "Seller/Landlord Corporation?" },
      { key: "seller_lawyer_name", label: "Lawyer" },
      { key: "seller_lawyer_firm", label: "Lawyer Firm" },
      { key: "seller_lawyer_email", label: "Lawyer Email" },
      { key: "seller_lawyer_phone", label: "Lawyer Phone" },
      { key: "seller_landlord_address", label: "Address", wide: true },
    ],
  },
  {
    title: "Buyer's / Tenants Information",
    fields: [
      { key: "buyer_tenant_names", label: "Buyer/Tenant Name(s)" },
      { key: "buyer_tenant_emails", label: "Buyer/Tenant Email" },
      { key: "buyer_tenant_is_corporation", label: "Buyer/Tenant Corporation?" },
      { key: "buyer_lawyer_name", label: "Lawyer" },
      { key: "buyer_lawyer_firm", label: "Lawyer Firm" },
      { key: "buyer_lawyer_email", label: "Lawyer Email" },
      { key: "buyer_lawyer_phone", label: "Lawyer Phone" },
      { key: "buyer_tenant_address", label: "Address", wide: true },
      { key: "buyer_tenant_phone", label: "Phone" },
    ],
  },
  {
    title: "Commission Information",
    fields: [
      { key: "total_commission_pct", label: "Total Commission %" },
      { key: "your_commission_pct", label: "Your Commission %" },
      { key: "outside_brokerage_commission_pct", label: "Outside Brokerage Commission %" },
      { key: "additional_payees", label: "Additional Payee(s)?" },
      { key: "additional_payee_1_name", label: "Additional Payee 1" },
      { key: "additional_payee_1_commission_pct", label: "Additional Payee 1 Commission %" },
      { key: "additional_payee_2_name", label: "Additional Payee 2" },
      { key: "additional_payee_2_commission_pct", label: "Additional Payee 2 Commission %" },
      { key: "listing_commission_pct", label: "Listing/Seller-Side Commission %" },
      { key: "cooperating_commission_pct", label: "Co-operating/Selling-Side Commission %" },
      { key: "outside_agent_name", label: "Outside Agent Name" },
      { key: "outside_brokerage", label: "Outside Agent Brokerage" },
      { key: "marketing_fee_amount", label: "Marketing Fee $" },
      { key: "rebate_to_clients", label: "Rebate to Your Clients?" },
      { key: "rebate_amount", label: "Rebate to Your Clients $" },
      { key: "referral", label: "Referral?" },
      { key: "referral_to", label: "Referral To" },
    ],
  },
  {
    title: "Deposit Info",
    fields: [
      { key: "deposit_holder", label: "Held By" },
      { key: "deposit_held_by_sutton", label: "Held by Sutton?" },
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
      { key: "seller_representation", label: "Seller/Landlord Representation" },
      { key: "buyer_representation", label: "Buyer/Tenant Representation" },
      { key: "sale_price", label: "Source Price / Rent" },
      { key: "seller_names", label: "Source Seller/Landlord Names" },
      { key: "seller_emails", label: "Source Seller/Landlord Email" },
      { key: "seller_phone", label: "Source Seller/Landlord Phone" },
      { key: "seller_is_corporation", label: "Source Seller/Landlord Corporation?" },
      { key: "seller_address", label: "Source Seller/Landlord Address" },
      { key: "buyer_names", label: "Source Buyer/Tenant Names" },
      { key: "buyer_emails", label: "Source Buyer/Tenant Email" },
      { key: "buyer_phone", label: "Source Buyer/Tenant Phone" },
      { key: "buyer_is_corporation", label: "Source Buyer/Tenant Corporation?" },
      { key: "buyer_address", label: "Source Buyer/Tenant Address" },
      { key: "deposit_held_by", label: "Source Deposit Holder" },
      { key: "offer_date", label: "Offer Date" },
      { key: "acceptance_date", label: "Acceptance Date" },
      { key: "irrevocable_date", label: "Irrevocable Until" },
      { key: "lease_start_date", label: "Lease Start" },
      { key: "lease_end_date", label: "Lease End" },
      { key: "listing_agent_name", label: "Listing/Seller-Side Agent" },
      { key: "listing_brokerage", label: "Listing/Seller-Side Brokerage" },
      { key: "cooperating_agent_name", label: "Co-operating/Selling-Side Agent" },
      { key: "cooperating_brokerage", label: "Co-operating/Selling-Side Brokerage" },
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
