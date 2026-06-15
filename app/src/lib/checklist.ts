import { DOCUMENT_TYPES, type DocumentType, type TransactionType } from "@/lib/types";
import {
  inferScenario,
  scenarioForKey,
  type DocumentRequirement,
  type RequirementLevel,
  type ScenarioDefinition,
} from "@/lib/scenario-rules";

export type ChecklistItem = {
  id: string;
  docType: DocumentType;
  docTypes: DocumentType[];
  label: string;
  level: RequirementLevel;
  required: boolean;
  conditional: boolean;
  found: boolean;
  pages: number[];
  condition?: string;
  taskTitle?: string;
};

export type ChecklistResult = {
  scenario: ScenarioDefinition;
  items: ChecklistItem[];
  requiredItems: ChecklistItem[];
  missingRequired: ChecklistItem[];
  completionPct: number;
};

type PageRow = { page_number: number; doc_type: string | null };
type FieldRow = { field_key: string; value: string | null };

export function buildChecklist(
  transactionType: TransactionType,
  pages: PageRow[],
  scenarioKey?: string | null,
  fields: FieldRow[] = [],
): ChecklistItem[] {
  return buildChecklistResult(transactionType, pages, scenarioKey, fields).items;
}

export function buildChecklistResult(
  transactionType: TransactionType,
  pages: PageRow[],
  scenarioKey?: string | null,
  fields: FieldRow[] = [],
): ChecklistResult {
  const scenario = scenarioKey
    ? scenarioForKey(scenarioKey, transactionType)
    : inferScenario(transactionType, pages, fields);
  const found = new Map<DocumentType, number[]>();

  for (const p of pages) {
    if (!p.doc_type || !(p.doc_type in DOCUMENT_TYPES)) continue;
    const docType = p.doc_type as DocumentType;
    found.set(docType, [...(found.get(docType) ?? []), p.page_number]);
  }

  const seen = new Set<string>();
  const items: ChecklistItem[] = [];
  for (const requirement of scenario.requirements) {
    if (seen.has(requirement.id)) continue;
    seen.add(requirement.id);
    items.push(toChecklistItem(requirement, found));
  }

  for (const [docType, pageNums] of found) {
    if (docType === "other") continue;
    const alreadyShown = items.some((item) => item.docTypes.includes(docType));
    if (alreadyShown) continue;
    items.push({
      id: `found_${docType}`,
      docType,
      docTypes: [docType],
      label: DOCUMENT_TYPES[docType] ?? docType,
      level: "optional",
      required: false,
      conditional: false,
      found: true,
      pages: pageNums,
    });
  }

  const requiredItems = items.filter((item) => item.required);
  const missingRequired = requiredItems.filter((item) => !item.found);
  const completionPct =
    requiredItems.length === 0
      ? 100
      : Math.round(((requiredItems.length - missingRequired.length) / requiredItems.length) * 100);

  return { scenario, items, requiredItems, missingRequired, completionPct };
}

function toChecklistItem(
  requirement: DocumentRequirement,
  found: Map<DocumentType, number[]>,
): ChecklistItem {
  const pages = requirement.docTypes.flatMap((docType) => found.get(docType) ?? []);
  const docType = requirement.docTypes[0];
  return {
    id: requirement.id,
    docType,
    docTypes: requirement.docTypes,
    label: requirement.label,
    level: requirement.level,
    required: requirement.level === "required",
    conditional: requirement.level === "conditional",
    found: pages.length > 0,
    pages: Array.from(new Set(pages)).sort((a, b) => a - b),
    condition: requirement.condition,
    taskTitle: requirement.taskTitle,
  };
}
