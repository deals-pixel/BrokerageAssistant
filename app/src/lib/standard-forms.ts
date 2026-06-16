import type { DocumentType, SourceBox } from "@/lib/types";

export type StandardFormRegion = {
  fieldKey: string;
  label: string;
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

export const STANDARD_FORMS: readonly StandardFormDefinition[] = [
  {
    key: "deal_information_sheet",
    documentType: "deal_information_sheet",
    title: "Deal Information Sheet",
    aliases: ["Deal Information Sheet", "Deal information sheet"],
    scenarioNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
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
    fieldRegions: [
      {
        fieldKey: "property_address",
        label: "Property address",
        boxes: [{ x: 0.12, y: 0.18, width: 0.76, height: 0.06 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "sale_price",
        label: "Purchase price",
        boxes: [{ x: 0.11, y: 0.34, width: 0.78, height: 0.06 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "deposit_amount",
        label: "Deposit",
        boxes: [{ x: 0.11, y: 0.39, width: 0.78, height: 0.08 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "closing_date",
        label: "Completion date",
        boxes: [{ x: 0.11, y: 0.53, width: 0.78, height: 0.07 }],
        note: roughRegionNote,
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
        boxes: [{ x: 0.08, y: 0.46, width: 0.84, height: 0.12 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "representation_side",
        label: "Representation side checkboxes",
        boxes: [{ x: 0.08, y: 0.29, width: 0.84, height: 0.15 }],
        note: roughRegionNote,
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
        boxes: [{ x: 0.09, y: 0.17, width: 0.82, height: 0.08 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "cooperating_commission_pct",
        label: "Buyer brokerage commission",
        boxes: [{ x: 0.09, y: 0.67, width: 0.82, height: 0.09 }],
        note: roughRegionNote,
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
        boxes: [{ x: 0.09, y: 0.17, width: 0.82, height: 0.08 }],
        note: roughRegionNote,
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
        boxes: [{ x: 0.1, y: 0.19, width: 0.8, height: 0.06 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "sale_price",
        label: "Monthly rent",
        boxes: [{ x: 0.1, y: 0.45, width: 0.8, height: 0.08 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "lease_start_date",
        label: "Lease start",
        boxes: [{ x: 0.1, y: 0.31, width: 0.8, height: 0.06 }],
        note: roughRegionNote,
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
        boxes: [{ x: 0.08, y: 0.16, width: 0.84, height: 0.12 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "seller_names",
        label: "Individual name",
        boxes: [{ x: 0.08, y: 0.16, width: 0.84, height: 0.12 }],
        note: roughRegionNote,
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
        boxes: [{ x: 0.08, y: 0.2, width: 0.84, height: 0.1 }],
        note: roughRegionNote,
      },
      {
        fieldKey: "deposit_method",
        label: "Funds method/source",
        boxes: [{ x: 0.08, y: 0.34, width: 0.84, height: 0.18 }],
        note: roughRegionNote,
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
) {
  const form = standardFormByKey(formKey);
  return form?.fieldRegions?.filter((region) => region.fieldKey === fieldKey) ?? [];
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
            `${region.fieldKey} ${region.label}: x=${box.x}, y=${box.y}, width=${box.width}, height=${box.height}`,
        )
        .join("; ");
      lines.push(`  Template region: ${boxes}`);
    }
  }
  return lines.join("\n");
}
