export const DOCUMENT_TYPES = {
  deal_information_sheet: "Deal Information Sheet",
  trade_record_sheet: "Trade Record Sheet",
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
  sourceDocumentType?: DocumentType | string;
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
  sourceDocumentType?: DocumentType | string;
  sourcePage?: number;
  sourceBox?: SourceBox | null;
  conflictSources?: FieldSourceCandidate[];
  needsReview: boolean;
  notes?: string;
};

export type FieldDef = { key: string; label: string; wide?: boolean; multiline?: boolean };
export type FieldSection = { title: string; fields: FieldDef[] };

export const DERIVED_DEAL_SHEET_FIELD_KEYS = new Set([
  "your_commission_pct",
  "outside_agent_name",
  "outside_brokerage",
  "outside_brokerage_commission_pct",
  "deposit_held_by_sutton",
]);

export const FIELD_SECTIONS: FieldSection[] = [
  {
    title: "Key Info - Trade Record",
    fields: [
      { key: "property_address", label: "Full Address", wide: true },
      { key: "street_number", label: "Street Number" },
      { key: "street_direction", label: "Direction" },
      { key: "street_name", label: "Street Name" },
      { key: "unit", label: "Unit" },
      { key: "city", label: "City" },
      { key: "province", label: "Province" },
      { key: "postal_code", label: "Postal Code" },
      { key: "lot_plan", label: "Lot and Plan", wide: true },
      { key: "from_listing", label: "From Listing" },
    ],
  },
  {
    title: "Key Info - Dates",
    fields: [
      { key: "offer_date", label: "Offer Date" },
      { key: "acceptance_date", label: "Firm Date" },
      { key: "closing_date", label: "Close Date" },
      { key: "lease_start_date", label: "Lease Start" },
      { key: "lease_end_date", label: "Lease End" },
    ],
  },
  {
    title: "Key Info - Trade Details",
    fields: [
      { key: "price_or_rent", label: "Sell Price / Rent" },
      { key: "mls_number", label: "MLS Number" },
      { key: "property_type", label: "Type" },
      { key: "we_manage", label: "We Manage" },
      { key: "ends", label: "Ends" },
      { key: "tax_roll_number", label: "Tax Roll Number" },
      { key: "tax_rate", label: "Tax Rate" },
      { key: "firm_or_conditional", label: "Firm or Conditional" },
      { key: "conditions_summary", label: "Condition(s) - raw", wide: true, multiline: true },
      { key: "multiple_offer", label: "Multiple Offer? (how many)" },
    ],
  },
  {
    title: "People - Seller / Landlord",
    fields: [
      { key: "seller_landlord_type", label: "Type" },
      { key: "seller_landlord_names", label: "Seller/Landlord Name(s)" },
      { key: "seller_landlord_address", label: "Current Address", wide: true },
      { key: "seller_landlord_forwarding_address", label: "Forwarding Address", wide: true },
      { key: "seller_landlord_emails", label: "Seller/Landlord Email" },
      { key: "seller_landlord_phone", label: "Seller/Landlord Phone" },
      { key: "seller_landlord_cell", label: "Cell Phone Number" },
      { key: "seller_landlord_work_phone", label: "Work Phone Number" },
      { key: "seller_landlord_fax", label: "FAX Number" },
      { key: "seller_landlord_occupation", label: "Occupation" },
      { key: "seller_landlord_birth_date", label: "Birth Date" },
      { key: "seller_landlord_id_number", label: "Identification Number" },
      { key: "seller_landlord_id_expiry_date", label: "ID Expiry Date" },
      { key: "seller_landlord_id_type", label: "Type of ID" },
      { key: "seller_landlord_id_place_of_issue", label: "Place of Issue" },
      { key: "seller_landlord_sin", label: "SIN" },
      { key: "seller_landlord_main_contact", label: "Main Contact" },
      { key: "seller_landlord_moving_out", label: "Moving Out" },
      { key: "seller_landlord_source_of_business", label: "Source of Business" },
      { key: "seller_landlord_is_corporation", label: "Seller/Landlord Corporation?" },
    ],
  },
  {
    title: "People - Buyer / Tenant",
    fields: [
      { key: "buyer_tenant_type", label: "Type" },
      { key: "buyer_tenant_names", label: "Buyer/Tenant Name(s)" },
      { key: "buyer_tenant_address", label: "Current Address", wide: true },
      { key: "buyer_tenant_emails", label: "Buyer/Tenant Email" },
      { key: "buyer_tenant_phone", label: "Buyer/Tenant Phone" },
      { key: "buyer_tenant_cell", label: "Cell Phone Number" },
      { key: "buyer_tenant_work_phone", label: "Work Phone Number" },
      { key: "buyer_tenant_fax", label: "FAX Number" },
      { key: "buyer_tenant_occupation", label: "Occupation" },
      { key: "buyer_tenant_birth_date", label: "Birth Date" },
      { key: "buyer_tenant_id_number", label: "Identification Number" },
      { key: "buyer_tenant_id_expiry_date", label: "ID Expiry Date" },
      { key: "buyer_tenant_id_type", label: "Type of ID" },
      { key: "buyer_tenant_id_place_of_issue", label: "Place of Issue" },
      { key: "buyer_tenant_sin", label: "SIN" },
      { key: "buyer_tenant_main_contact", label: "Main Contact" },
      { key: "buyer_tenant_mortgage_amount", label: "Mortgage Amount" },
      { key: "buyer_tenant_mortgage_type", label: "Mortgage Type" },
      { key: "buyer_tenant_title_premium", label: "Title Premium" },
      { key: "buyer_tenant_source_of_business", label: "Source of Business" },
      { key: "buyer_tenant_is_corporation", label: "Buyer/Tenant Corporation?" },
    ],
  },
  {
    title: "People - Solicitors",
    fields: [
      { key: "seller_lawyer_name", label: "Seller/Landlord Solicitor Contact" },
      { key: "seller_lawyer_firm", label: "Seller/Landlord Solicitor Firm" },
      { key: "seller_lawyer_email", label: "Seller/Landlord Solicitor Email" },
      { key: "seller_lawyer_phone", label: "Seller/Landlord Solicitor Phone" },
      { key: "seller_lawyer_fax", label: "Seller/Landlord Solicitor Fax" },
      { key: "seller_lawyer_address", label: "Seller/Landlord Solicitor Address", wide: true },
      { key: "seller_lawyer_file_number", label: "Seller/Landlord Solicitor File #" },
      { key: "buyer_lawyer_name", label: "Buyer/Tenant Solicitor Contact" },
      { key: "buyer_lawyer_firm", label: "Buyer/Tenant Solicitor Firm" },
      { key: "buyer_lawyer_email", label: "Buyer/Tenant Solicitor Email" },
      { key: "buyer_lawyer_phone", label: "Buyer/Tenant Solicitor Phone" },
      { key: "buyer_lawyer_fax", label: "Buyer/Tenant Solicitor Fax" },
      { key: "buyer_lawyer_address", label: "Buyer/Tenant Solicitor Address", wide: true },
      { key: "buyer_lawyer_file_number", label: "Buyer/Tenant Solicitor File #" },
    ],
  },
  {
    title: "Outside Brokers",
    fields: [
      { key: "outside_brokerage", label: "Company" },
      { key: "outside_agent_name", label: "Agent" },
      { key: "outside_brokerage_address", label: "Address", wide: true },
      { key: "outside_brokerage_email", label: "E-Mail" },
      { key: "outside_brokerage_phone", label: "Phone Number" },
      { key: "outside_brokerage_fax", label: "FAX Number" },
      { key: "outside_brokerage_contact_name", label: "Contact" },
      { key: "outside_brokerage_contact_number", label: "Contact's Number" },
      { key: "outside_brokerage_contact_email", label: "Contact's Email" },
      { key: "outside_brokerage_pay_broker", label: "Pay Broker" },
      { key: "outside_brokerage_end", label: "End" },
      { key: "outside_brokerage_hst", label: "HST" },
      { key: "outside_brokerage_hst_exempt", label: "HST Exempt" },
      { key: "outside_brokerage_charged_hst", label: "Charged HST" },
      { key: "outside_brokerage_franchise", label: "Franchise" },
      { key: "referral", label: "Referral?" },
    ],
  },
  {
    title: "Outside Brokers - Referral",
    fields: [
      { key: "referral_to", label: "Referral To" },
      { key: "referral_network", label: "Referral Network" },
      { key: "referral_agent_name", label: "Agent" },
      { key: "referral_address", label: "Address", wide: true },
      { key: "referral_email", label: "E-Mail" },
      { key: "referral_phone", label: "Phone Number" },
      { key: "referral_fax", label: "FAX Number" },
      { key: "referral_contact_name", label: "Contact" },
      { key: "referral_contact_number", label: "Contact's Number" },
      { key: "referral_contact_email", label: "Contact's Email" },
      { key: "referral_pay_broker", label: "Pay Broker" },
      { key: "referral_end", label: "End" },
      { key: "referral_hst", label: "HST" },
      { key: "referral_hst_exempt", label: "HST Exempt" },
      { key: "referral_charged_hst", label: "Charged HST" },
      { key: "referral_franchise", label: "Franchise" },
    ],
  },
  {
    title: "Commissions - Sale Closing",
    fields: [
      { key: "price_or_rent", label: "Sell Price / Rent" },
      { key: "closing_date", label: "Closing Date" },
      { key: "accounts_receivable_amount", label: "A.R." },
    ],
  },
  {
    title: "Commissions - Income",
    fields: [
      { key: "total_commission_pct", label: "Commission %" },
      { key: "listing_commission_pct", label: "Listing %" },
      { key: "listing_commission_amount", label: "Listing Amount" },
      { key: "listing_other_commission_amount", label: "L. Other" },
      { key: "cooperating_commission_pct", label: "Selling %" },
      { key: "cooperating_commission_amount", label: "Selling Amount" },
      { key: "selling_other_commission_amount", label: "S. Other" },
      { key: "commission_tax_amount", label: "Tax" },
      { key: "commission_total_amount", label: "Total" },
    ],
  },
  {
    title: "Commissions - Outside Brokers & Expenses",
    fields: [
      { key: "outside_brokerage_commission_pct", label: "Outside Broker Commission %" },
      { key: "outside_brokerage_commission_amount", label: "Outside Broker Amount" },
      { key: "outside_brokerage_expense_tax", label: "Outside Broker Tax" },
      { key: "outside_brokerage_expense_total", label: "Outside Broker Total" },
      { key: "rebate_to_clients", label: "Rebate?" },
      { key: "rebate_amount", label: "Rebate Amount $" },
      { key: "marketing_fee", label: "Marketing Fee?" },
      { key: "marketing_fee_amount", label: "Marketing Fee Amount $" },
      { key: "additional_payees", label: "Additional Payee(s)?" },
      { key: "additional_payee_1_name", label: "Additional Payee 1" },
      { key: "additional_payee_1_commission_pct", label: "Additional Payee 1 Commission %" },
      { key: "additional_payee_2_name", label: "Additional Payee 2" },
      { key: "additional_payee_2_commission_pct", label: "Additional Payee 2 Commission %" },
    ],
  },
  {
    title: "Agent Info",
    fields: [
      { key: "agent_name", label: "Agent" },
      { key: "agent_end", label: "End" },
      { key: "agent_units", label: "#" },
      { key: "your_commission_pct", label: "%" },
      { key: "agent_base_commission", label: "Agt Base" },
      { key: "agent_deducted", label: "Deducted" },
      { key: "agent_gross", label: "Gross" },
      { key: "agent_hst", label: "HST" },
      { key: "agent_net", label: "Net" },
      { key: "agent_deduction_name", label: "Deduction" },
      { key: "agent_deduction_pct", label: "Deduction Pct" },
      { key: "agent_deduction_amount", label: "Deduction Amount" },
      { key: "agent_deduction_taxed", label: "Taxed" },
    ],
  },
  {
    title: "Brokerage Sides",
    fields: [
      { key: "representation_side", label: "Our Side" },
      { key: "listing_agent_name", label: "Listing/Seller-Side Agent" },
      { key: "listing_brokerage", label: "Listing Side Brokerage / Status" },
      { key: "cooperating_agent_name", label: "Co-operating/Buyer-Side Agent" },
      { key: "cooperating_brokerage", label: "Co-operating Side Brokerage / Status" },
      { key: "scenario_hint", label: "Scenario Notes", wide: true, multiline: true },
    ],
  },
  {
    title: "Deposit Reference - Not Trust Entry",
    fields: [
      { key: "deposit_holder", label: "Held By" },
      { key: "deposit_held_by_sutton", label: "Held by Sutton?" },
      { key: "deposit_method", label: "Wire Transfer / Direct Deposit / Cheque" },
      { key: "deposit_amount", label: "Amount $" },
      { key: "further_deposit_amount", label: "Further Deposit $" },
      { key: "further_deposit_due", label: "Further Deposit Due" },
    ],
  },
];

export const SOURCE_FIELD_SECTIONS: FieldSection[] = [
  {
    title: "Representation & Derived Fields",
    fields: [
      { key: "seller_representation", label: "Seller/Landlord Representation Status" },
      { key: "buyer_representation", label: "Buyer/Tenant Representation Status" },
    ],
  },
];

export const FIELD_REGISTRY_SECTIONS: FieldSection[] = [...FIELD_SECTIONS, ...SOURCE_FIELD_SECTIONS];

export const ALL_FIELD_KEYS = [...new Set(FIELD_REGISTRY_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)))];

export const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  FIELD_REGISTRY_SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, f.label])),
);

// Document checklist rules per transaction type.
// The Deal Information Sheet is NOT required — it is the OUTPUT this app
// generates from the rest of the package.
