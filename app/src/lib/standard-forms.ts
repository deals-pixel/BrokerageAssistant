import type { DocumentType, SourceBox } from "@/lib/types";

export type StandardFormRegion = {
  fieldKey: string;
  label: string;
  page?: number;
  boxes: SourceBox[];
  note?: string;
};

export type StandardFormDefinition = {
  key: string;
  documentType: DocumentType;
  title: string;
  formNumbers?: string[];
  aliases: string[];
  scenarioNumbers?: number[];
  signatures?: string[];
  fieldRegions?: StandardFormRegion[];
};

export type StandardFormMatch = {
  key: string;
  documentType: DocumentType;
  title: string;
  formNumber?: string | null;
  confidence: "high" | "medium" | "low";
  source: "classifier" | "document_type";
};

const roughRegionNote =
  "Template region is a standard-form fallback. Prefer AI source_box when it is present.";
const calibratedRegionNote =
  "Template region measured from the blank standard form calibration report. Prefer AI source_box when it is present.";

export const STANDARD_FORMS: readonly StandardFormDefinition[] = [
  {
    key: "deal_information_sheet",
    documentType: "deal_information_sheet",
    title: "Deal Information Sheet",
    aliases: ["Deal Information Sheet", "Deal information sheet"],
    scenarioNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    fieldRegions: [
      {
        fieldKey: "agent_name",
        label: "Your Name (Agent)",
        page: 1,
        boxes: [{ x: 0.0333, y: 0.1, width: 0.5536, height: 0.0282 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "property_address",
        label: "Property Address",
        page: 1,
        boxes: [{ x: 0.0361, y: 0.1228, width: 0.5508, height: 0.0303 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "closing_date",
        label: "Closing Date",
        page: 1,
        boxes: [{ x: 0.0375, y: 0.1488, width: 0.3322, height: 0.0325 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "mls_number",
        label: "MLS Number",
        page: 1,
        boxes: [{ x: 0.636, y: 0.0957, width: 0.307, height: 0.0379 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "price_or_rent",
        label: "Price / Rent",
        page: 1,
        boxes: [{ x: 0.6374, y: 0.1282, width: 0.328, height: 0.0303 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "firm_or_conditional",
        label: "Firm or Conditional",
        page: 1,
        boxes: [{ x: 0.6332, y: 0.1585, width: 0.1836, height: 0.0217 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "conditions_summary",
        label: "Condition(s)",
        page: 1,
        boxes: [{ x: 0.0375, y: 0.1748, width: 0.541, height: 0.0325 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "condition_expiry_date",
        label: "Expiry",
        page: 1,
        boxes: [{ x: 0.6346, y: 0.1791, width: 0.335, height: 0.0249 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "multiple_offer",
        label: "Multiple Offer? (how many)",
        page: 1,
        boxes: [{ x: 0.0305, y: 0.2041, width: 0.5676, height: 0.0314 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_landlord_names",
        label: "Seller/Landlord Name(s)",
        page: 1,
        boxes: [{ x: 0.0319, y: 0.5205, width: 0.384, height: 0.0303 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_landlord_emails",
        label: "Seller/Landlord Email",
        page: 1,
        boxes: [{ x: 0.0333, y: 0.5454, width: 0.3882, height: 0.0282 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_tenant_names",
        label: "Buyer/Tenant Name(s)",
        page: 1,
        boxes: [{ x: 0.5126, y: 0.5205, width: 0.3756, height: 0.0282 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_lawyer_name",
        label: "Lawyer",
        page: 1,
        boxes: [{ x: 0.0277, y: 0.5703, width: 0.3994, height: 0.0293 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_lawyer_firm",
        label: "Lawyer Firm",
        page: 1,
        boxes: [{ x: 0.0361, y: 0.5899, width: 0.3812, height: 0.0325 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_lawyer_phone",
        label: "Lawyer Phone",
        page: 1,
        boxes: [{ x: 0.0375, y: 0.643, width: 0.3882, height: 0.0325 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_landlord_address",
        label: "Address",
        page: 1,
        boxes: [{ x: 0.0347, y: 0.618, width: 0.3939, height: 0.0314 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_tenant_emails",
        label: "Buyer/Tenant Email",
        page: 1,
        boxes: [{ x: 0.5098, y: 0.5454, width: 0.3812, height: 0.0271 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_lawyer_name",
        label: "Lawyer",
        page: 1,
        boxes: [{ x: 0.5098, y: 0.5682, width: 0.384, height: 0.0314 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_lawyer_firm",
        label: "Lawyer Firm",
        page: 1,
        boxes: [{ x: 0.514, y: 0.5985, width: 0.3826, height: 0.0249 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_lawyer_phone",
        label: "Lawyer Phone",
        page: 1,
        boxes: [{ x: 0.5112, y: 0.6451, width: 0.3742, height: 0.0314 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_tenant_address",
        label: "Address",
        page: 1,
        boxes: [{ x: 0.5084, y: 0.6191, width: 0.4051, height: 0.0314 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "total_commission_pct",
        label: "Total Commission %",
        page: 1,
        boxes: [{ x: 0.0389, y: 0.7112, width: 0.2172, height: 0.0293 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "your_commission_pct",
        label: "Your Commission %",
        page: 1,
        boxes: [{ x: 0.2519, y: 0.7102, width: 0.2425, height: 0.0325 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "outside_brokerage_commission_pct",
        label: "Outside Brokerage Commission %",
        page: 1,
        boxes: [{ x: 0.5112, y: 0.7947, width: 0.2229, height: 0.0325 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "additional_payees",
        label: "Additional Payee(s)?",
        page: 1,
        boxes: [{ x: 0.5168, y: 0.7037, width: 0.2593, height: 0.0368 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "additional_payee_1_name",
        label: "Additional Payee 1",
        page: 1,
        boxes: [{ x: 0.0333, y: 0.7351, width: 0.4625, height: 0.0282 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "additional_payee_2_name",
        label: "Additional Payee 2",
        page: 1,
        boxes: [{ x: 0.0333, y: 0.7611, width: 0.4667, height: 0.0282 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "additional_payee_1_commission_pct",
        label: "Additional Payee 1 Commission %",
        page: 1,
        boxes: [{ x: 0.5182, y: 0.7362, width: 0.3476, height: 0.0238 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "additional_payee_2_commission_pct",
        label: "Additional Payee 2 Commission %",
        page: 1,
        boxes: [{ x: 0.5154, y: 0.7589, width: 0.3546, height: 0.0293 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "outside_agent_name",
        label: "Outside Agent Name",
        page: 1,
        boxes: [{ x: 0.0333, y: 0.8023, width: 0.4597, height: 0.0271 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "marketing_fee_amount",
        label: "Marketing Fee $",
        page: 1,
        boxes: [{ x: 0.7607, y: 0.7936, width: 0.1738, height: 0.0379 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "rebate_to_clients",
        label: "Rebate to Your Clients?",
        page: 1,
        boxes: [{ x: 0.0333, y: 0.8326, width: 0.3504, height: 0.026 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "rebate_amount",
        label: "Rebate to Your Clients $",
        page: 1,
        boxes: [{ x: 0.3837, y: 0.8315, width: 0.3084, height: 0.0228 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "referral",
        label: "Referral?",
        page: 1,
        boxes: [{ x: 0.0375, y: 0.8738, width: 0.1836, height: 0.0282 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "deposit_holder",
        label: "Held By",
        page: 1,
        boxes: [{ x: 0.0375, y: 0.9052, width: 0.3392, height: 0.026 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "deposit_method",
        label: "Wire Transfer / Direct Deposit / Cheque",
        page: 1,
        boxes: [{ x: 0.3711, y: 0.902, width: 0.3168, height: 0.0271 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "deposit_amount",
        label: "Amount $",
        page: 1,
        boxes: [{ x: 0.6948, y: 0.9031, width: 0.2705, height: 0.0303 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "further_deposit_amount",
        label: "Further Deposit $",
        page: 1,
        boxes: [
          { x: 0.0319, y: 0.9291, width: 0.2341, height: 0.0314 },
          { x: 0.2701, y: 0.9291, width: 0.2873, height: 0.0314 },
        ],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "further_deposit_due",
        label: "Further Deposit Due",
        page: 1,
        boxes: [{ x: 0.5575, y: 0.9269, width: 0.2803, height: 0.0293 }],
        note: calibratedRegionNote,
      },
    ],
  },
  {
    key: "form_100_aps",
    documentType: "agreement_of_purchase_and_sale",
    title: "Agreement of Purchase and Sale",
    formNumbers: ["100"],
    aliases: ["Form 100", "Agreement of Purchase and Sale", "APS", "Office Schedule B"],
    signatures: [
      "Agreement of Purchase and Sale",
      "Form 100",
      "Buyer agrees to purchase",
      "purchase price",
      "completion date",
    ],
    scenarioNumbers: [1, 2, 3, 4, 9, 10],
    // Paste into STANDARD_FORMS -> form_100_aps -> fieldRegions
fieldRegions: [
  {
    fieldKey: "property_address",
    label: "Property address",
    page: 1,
    boxes: [{ x: 0.0597, y: 0.2374, width: 0.8834, height: 0.1131 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "sale_price",
    label: "Purchase price",
    page: 1,
    boxes: [{ x: 0.0634, y: 0.458, width: 0.8713, height: 0.0554 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "deposit_amount",
    label: "Deposit",
    page: 1,
    boxes: [{ x: 0.0662, y: 0.5179, width: 0.8663, height: 0.0652 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "closing_date",
    label: "Completion date",
    page: 1,
    boxes: [{ x: 0.0662, y: 0.8129, width: 0.8677, height: 0.0641 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "buyer_names",
    label: "Buyer Name(s)",
    page: 1,
    boxes: [{ x: 0.0599, y: 0.1466, width: 0.7457, height: 0.0444 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "seller_names",
    label: "Seller Name(s)",
    page: 1,
    boxes: [{ x: 0.0599, y: 0.1878, width: 0.8031, height: 0.0423 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "seller_emails",
    label: "Seller Email",
    page: 2,
    boxes: [{ x: 0.0893, y: 0.2333, width: 0.4163, height: 0.0423 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "buyer_emails",
    label: "Buyer Email",
    page: 2,
    boxes: [{ x: 0.514, y: 0.2333, width: 0.4261, height: 0.0412 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "irrevocable_date",
    label: "Irrevocable Until",
    page: 1,
    boxes: [{ x: 0.0641, y: 0.734, width: 0.8746, height: 0.0737 }],
    note: calibratedRegionNote,
  },
  {
    fieldKey: "listing_brokerage",
    label: "Listing Brokerage",
    page: 5,
    boxes: [{ x: 0.0781, y: 0.4511, width: 0.8508, height: 0.0596 }],
    note: calibratedRegionNote,
  },
    ],
  },
  {
    key: "form_120_123_124_sale_conditions",
    documentType: "waiver_notice_fulfillment_amendment",
    title: "Sale Waiver / Notice / Amendment",
    formNumbers: ["120", "123", "124"],
    aliases: ["Form 120", "Form 123", "Form 124", "Amendment", "Waiver", "Notice of Fulfillment"],
    signatures: ["Amendment", "Waiver", "Notice of Fulfillment", "Agreement of Purchase and Sale"],
    scenarioNumbers: [1, 2, 3, 4, 9, 10],
  },
  {
    key: "form_124_notice_fulfillment",
    documentType: "form_124_notice_fulfillment",
    title: "Notice of Fulfillment of Conditions",
    formNumbers: ["124"],
    aliases: ["Form 124", "Notice of Fulfillment of Conditions"],
    signatures: ["Notice of Fulfillment of Conditions", "Form 124"],
    scenarioNumbers: [1, 2, 3, 4, 9, 10],
  },
  {
    key: "forms_271_272_593_listing",
    documentType: "listing_agreement",
    title: "Listing / Landlord Representation Agreement",
    formNumbers: ["271", "272", "593"],
    aliases: [
      "Form 271",
      "Form 272",
      "Form 593",
      "Listing Agreement",
      "Seller Designated Representation Agreement",
      "Landlord Designated Representation Agreement",
    ],
    signatures: [
      "Designated Representation Agreement",
      "Authority to Offer for Sale",
      "Authority to Offer for Lease",
      "Listing Agreement",
    ],
    scenarioNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
  },
  {
    key: "form_320_confirmation",
    documentType: "form_320_confirmation_cooperation",
    title: "Confirmation of Cooperation",
    formNumbers: ["320"],
    aliases: ["Form 320", "Confirmation of Cooperation", "Confirmation of Co-operation"],
    signatures: ["Confirmation of Cooperation", "Confirmation of Co-operation", "Form 320"],
    scenarioNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    fieldRegions: [
      {
        fieldKey: "cooperating_commission_pct",
        label: "Co-operating brokerage commission",
        boxes: [{ x: 0.0662, y: 0.2393, width: 0.72, height: 0.05 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "representation_side",
        label: "Representation side checkboxes",
        boxes: [{ x: 0.0956, y: 0.3283, width: 0.8383, height: 0.05 }],
        note: calibratedRegionNote,
      },
    ],
  },
  {
    key: "forms_325_328_multiple_rep",
    documentType: "multiple_representation_consent",
    title: "Multiple Representation Consent",
    formNumbers: ["325", "326", "327", "328"],
    aliases: [
      "Form 325",
      "Form 326",
      "Form 327",
      "Form 328",
      "Multiple Representation",
      "Acknowledgement and Consent",
    ],
    signatures: ["Multiple Representation", "Acknowledgement", "Consent", "Disclosure"],
    scenarioNumbers: [2, 6],
  },
  {
    key: "form_371_buyer_rep",
    documentType: "buyer_representation_agreement",
    title: "Buyer Designated Representation Agreement",
    formNumbers: ["371"],
    aliases: ["Form 371", "Buyer Designated Representation Agreement", "Buyer Representation Agreement"],
    signatures: ["Buyer Designated Representation Agreement", "Form 371", "Buyer Representation Agreement"],
    scenarioNumbers: [2, 4, 9, 10, 15],
    fieldRegions: [
      {
        fieldKey: "buyer_names",
        label: "Buyer names",
        boxes: [{ x: 0.2941, y: 0.0664, width: 0.7059, height: 0.05 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "cooperating_commission_pct",
        label: "Buyer brokerage commission",
        boxes: [{ x: 0.0956, y: 0.681, width: 0.8383, height: 0.05 }],
        note: calibratedRegionNote,
      },
    ],
  },
  {
    key: "form_372_tenant_rep",
    documentType: "tenant_representation_agreement",
    title: "Tenant Designated Representation Agreement",
    formNumbers: ["372"],
    aliases: ["Form 372", "Tenant Designated Representation Agreement", "Tenant Representation Agreement"],
    signatures: ["Tenant Designated Representation Agreement", "Form 372", "Tenant Representation Agreement"],
    scenarioNumbers: [6, 8, 11, 12],
    fieldRegions: [
      {
        fieldKey: "buyer_names",
        label: "Tenant names",
        boxes: [{ x: 0.2941, y: 0.0664, width: 0.7059, height: 0.05 }],
        note: calibratedRegionNote,
      },
    ],
  },
  {
    key: "form_400_agreement_to_lease",
    documentType: "agreement_to_lease",
    title: "Agreement to Lease",
    formNumbers: ["400"],
    aliases: ["Form 400", "Agreement to Lease", "Office Schedule B Lease"],
    signatures: ["Agreement to Lease", "Form 400", "Residential", "Tenant", "Landlord"],
    scenarioNumbers: [5, 6, 7, 8, 11, 12],
    fieldRegions: [
      {
        fieldKey: "property_address",
        label: "Leased premises",
        page: 1,
        boxes: [{ x: 0.0816, y: 0.2612, width: 0.8676, height: 0.05 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "sale_price",
        label: "Monthly rent",
        page: 1,
        boxes: [{ x: 0.0746, y: 0.3274, width: 0.8677, height: 0.05 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "lease_start_date",
        label: "Lease start",
        page: 1,
        boxes: [{ x: 0.0844, y: 0.2994, width: 0.8677, height: 0.05 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_names",
        label: "Seller Name(s)",
        page: 1,
        boxes: [{ x: 0.0613, y: 0.1661, width: 0.8802, height: 0.0391 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_names",
        label: "Buyer Name(s)",
        page: 1,
        boxes: [{ x: 0.0641, y: 0.1423, width: 0.8844, height: 0.0412 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "offer_date",
        label: "Offer Date",
        page: 1,
        boxes: [{ x: 0.0683, y: 0.1141, width: 0.8732, height: 0.039 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "deposit_held_by",
        label: "Held By",
        page: 1,
        boxes: [{ x: 0.0893, y: 0.4316, width: 0.8564, height: 0.0379 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "deposit_amount",
        label: "Amount $",
        page: 1,
        boxes: [{ x: 0.0767, y: 0.4555, width: 0.8858, height: 0.0401 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "irrevocable_date",
        label: "Irrevocable Until",
        page: 2,
        boxes: [{ x: 0.0627, y: 0.1662, width: 0.89, height: 0.0932 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_emails",
        label: "Buyer Email",
        page: 2,
        boxes: [{ x: 0.5168, y: 0.3732, width: 0.4289, height: 0.0531 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_emails",
        label: "Seller Email",
        page: 2,
        boxes: [{ x: 0.0935, y: 0.3764, width: 0.4247, height: 0.0455 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "listing_brokerage",
        label: "Listing Brokerage",
        page: 3,
        boxes: [{ x: 0.0767, y: 0.4338, width: 0.8452, height: 0.052 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_representation",
        label: "Seller/Landlord Representation",
        page: 3,
        boxes: [{ x: 0.0585, y: 0.4598, width: 0.869, height: 0.0412 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_representation",
        label: "Buyer/Tenant Representation",
        page: 3,
        boxes: [{ x: 0.0767, y: 0.5108, width: 0.8522, height: 0.0336 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "listing_agent_name",
        label: "Listing Agent",
        page: 3,
        boxes: [{ x: 0.0529, y: 0.4598, width: 0.883, height: 0.0401 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_names",
        label: "Seller Name(s)",
        page: 4,
        boxes: [{ x: 0.0599, y: 0.1651, width: 0.8914, height: 0.052 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "buyer_names",
        label: "Buyer Name(s)",
        page: 4,
        boxes: [{ x: 0.0655, y: 0.1293, width: 0.8915, height: 0.0618 }],
        note: calibratedRegionNote,
      },
    ],
  },
  {
    key: "forms_403_404_420_lease_conditions",
    documentType: "waiver_notice_fulfillment_amendment",
    title: "Lease Waiver / Notice / Amendment",
    formNumbers: ["403", "404", "420"],
    aliases: ["Form 403", "Form 404", "Form 420", "Lease Waiver", "Lease Notice of Fulfillment", "Lease Amendment"],
    signatures: ["Agreement to Lease", "Waiver", "Notice of Fulfillment", "Amendment"],
    scenarioNumbers: [5, 6, 7, 8, 11, 12],
  },
  {
    key: "form_630_individual_id",
    documentType: "form_630_individual_identification",
    title: "Individual Identification Record",
    formNumbers: ["630"],
    aliases: ["Form 630", "Individual Identification Record", "FINTRAC ID"],
    signatures: ["Individual Identification Record", "Form 630", "FINTRAC"],
    scenarioNumbers: [1, 2, 3, 4, 9, 10, 15],
    fieldRegions: [
      {
        fieldKey: "buyer_names",
        label: "Individual name",
        boxes: [{ x: 0.0684, y: 0.3535, width: 0.72, height: 0.05 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "seller_names",
        label: "Individual name",
        boxes: [{ x: 0.0684, y: 0.3535, width: 0.72, height: 0.05 }],
        note: calibratedRegionNote,
      },
    ],
  },
  {
    key: "form_631_entity_id",
    documentType: "corporate_id_articles",
    title: "Corporation / Entity Identification Record",
    formNumbers: ["631"],
    aliases: ["Form 631", "Corporation Identification Record", "Entity Identification Record"],
    signatures: ["Corporation", "Entity Identification Record", "Form 631"],
    scenarioNumbers: [1, 2, 3, 4, 9, 10, 15],
  },
  {
    key: "form_634_pep_hio",
    documentType: "form_631_pep_checklist",
    title: "PEP / HIO Checklist",
    formNumbers: ["634"],
    aliases: ["Form 634", "Politically Exposed Person", "Head of International Organization", "PEP", "HIO"],
    signatures: ["Politically Exposed Person", "Head of International Organization", "Form 634"],
    scenarioNumbers: [1, 2, 3, 4, 9, 10, 15],
  },
  {
    key: "form_635_receipt_funds",
    documentType: "form_635_receipt_of_funds",
    title: "Receipt of Funds Record",
    formNumbers: ["635"],
    aliases: ["Form 635", "Receipt of Funds Record"],
    signatures: ["Receipt of Funds Record", "Form 635", "funds received"],
    scenarioNumbers: [2, 4, 9, 10],
    fieldRegions: [
      {
        fieldKey: "deposit_amount",
        label: "Amount received",
        boxes: [{ x: 0.0818, y: 0.357, width: 0.72, height: 0.05 }],
        note: calibratedRegionNote,
      },
      {
        fieldKey: "deposit_method",
        label: "Funds method/source",
        boxes: [{ x: 0.0817, y: 0.4364, width: 0.72, height: 0.05 }],
        note: calibratedRegionNote,
      },
    ],
  },
  {
    key: "form_641_referral",
    documentType: "referral_agreement",
    title: "Referral Agreement",
    formNumbers: ["641"],
    aliases: ["Form 641", "Referral Agreement"],
    signatures: ["Referral Agreement", "Form 641"],
    scenarioNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15],
  },
  {
    key: "form_650_co_brokerage",
    documentType: "co_brokerage_agreement",
    title: "Co-Brokerage Agreement",
    formNumbers: ["650"],
    aliases: ["Form 650", "Co-Brokerage Agreement", "Co-brokerage Agreement"],
    signatures: ["Co-Brokerage Agreement", "Co-brokerage Agreement", "Form 650"],
    scenarioNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 14],
  },
  {
    key: "reco_information_guide",
    documentType: "reco_information_guide_ack",
    title: "RECO Information Guide Acknowledgement",
    aliases: ["RECO Information Guide", "Acknowledgement"],
    scenarioNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15],
  },
  {
    key: "reco_self_represented_disclosure",
    documentType: "reco_self_represented_disclosure",
    title: "RECO Information and Disclosure to Self-Represented Party",
    aliases: ["Information and Disclosure to Self-Represented Party", "Self-Represented Party"],
    scenarioNumbers: [3, 7, 10, 12],
  },
  {
    key: "ontario_standard_lease",
    documentType: "ontario_residential_tenancy_agreement",
    title: "Ontario Residential Tenancy Agreement",
    aliases: ["Ontario Residential Tenancy Agreement", "Ontario Standard Lease"],
    scenarioNumbers: [5, 6, 7, 8],
  },
  {
    key: "attestation_beneficial_ownership",
    documentType: "attestation_beneficial_ownership",
    title: "Attestation of Beneficial Ownership",
    aliases: ["Attestation of Beneficial Ownership"],
    scenarioNumbers: [1, 2, 3, 4, 9, 10, 15],
  },
] as const;

export function standardFormsForDocumentType(docType: DocumentType) {
  return STANDARD_FORMS.filter((form) => form.documentType === docType);
}

export function standardFormByKey(key: string | null | undefined) {
  if (!key) return null;
  return STANDARD_FORMS.find((form) => form.key === key) ?? null;
}

export function standardFormMatchFromKey(
  key: string | null | undefined,
  confidence: "high" | "medium" | "low" = "medium",
): StandardFormMatch | null {
  const form = standardFormByKey(key);
  if (!form) return null;
  return {
    key: form.key,
    documentType: form.documentType,
    title: form.title,
    formNumber: form.formNumbers?.[0] ?? null,
    confidence,
    source: "classifier",
  };
}

export function defaultStandardFormMatchForDocumentType(
  docType: DocumentType,
): StandardFormMatch | null {
  const forms = standardFormsForDocumentType(docType);
  if (forms.length !== 1) return null;
  const form = forms[0];
  return {
    key: form.key,
    documentType: form.documentType,
    title: form.title,
    formNumber: form.formNumbers?.[0] ?? null,
    confidence: "medium",
    source: "document_type",
  };
}

export function standardFormLabelsForDocumentTypes(docTypes: DocumentType[]) {
  return Array.from(
    new Set(
      docTypes.flatMap((docType) =>
        standardFormsForDocumentType(docType)
          .filter((form) => form.formNumbers?.length)
          .map((form) => `${form.title} (${form.formNumbers?.map((n) => `Form ${n}`).join(" / ")})`),
      ),
    ),
  );
}

export function classificationGuideFromStandardForms() {
  return STANDARD_FORMS.map((form) => {
    const numberText = form.formNumbers?.length ? `Forms ${form.formNumbers.join(", ")}` : "No form number";
    const aliasText = form.aliases.length ? `; aliases: ${form.aliases.join(", ")}` : "";
    const signatureText = form.signatures?.length
      ? `; signatures: ${form.signatures.join(" | ")}`
      : "";
    return `- key ${form.key}; ${numberText}: ${form.documentType} - ${form.title}${aliasText}${signatureText}`;
  }).join("\n");
}

export function templateRegionsForDocumentType(docType: DocumentType, fieldKey: string) {
  return standardFormsForDocumentType(docType).flatMap(
    (form) => form.fieldRegions?.filter((region) => region.fieldKey === fieldKey) ?? [],
  );
}

export function templateRegionsForStandardForm(
  formKey: string | null | undefined,
  fieldKey: string,
  pageNumber?: number | null,
) {
  const form = standardFormByKey(formKey);
  return (
    form?.fieldRegions?.filter(
      (region) =>
        region.fieldKey === fieldKey &&
        (pageNumber == null || region.page == null || region.page === pageNumber),
    ) ?? []
  );
}

export function extractionTemplateGuide(matches: StandardFormMatch[]) {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const match of matches) {
    if (seen.has(match.key)) continue;
    seen.add(match.key);
    const form = standardFormByKey(match.key);
    if (!form) continue;
    lines.push(
      `- ${form.title}${match.formNumber ? ` (Form ${match.formNumber})` : ""}: key ${form.key}; matched with ${match.confidence} confidence.`,
    );
    for (const region of form.fieldRegions ?? []) {
      const boxes = region.boxes
        .map(
          (box) =>
            `${region.fieldKey} ${region.label}${region.page ? ` page=${region.page}` : ""}: x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}`,
        )
        .join("; ");
      lines.push(`  Template region: ${boxes}`);
    }
  }
  return lines.join("\n");
}
