"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardCopy,
  Download,
  FileText,
  MousePointer2,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { FIELD_SECTIONS, type SourceBox } from "@/lib/types";
import { STANDARD_FORMS, type StandardFormDefinition } from "@/lib/standard-forms";
import { formatSize, isJpeg, isPdf, renderFilePages } from "@/lib/pdf-render-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type RenderedPage = {
  pageNumber: number;
  url: string;
  blob: Blob;
};

type EditableRegion = {
  id: string;
  fieldKey: string;
  label: string;
  page: number;
  box: SourceBox;
};

type ResizeHandle = "n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw";

type BoxInteraction =
  | { kind: "draw"; start: { x: number; y: number } }
  | {
      kind: "move";
      regionId: string;
      start: { x: number; y: number };
      originalBox: SourceBox;
    }
  | {
      kind: "resize";
      regionId: string;
      handle: ResizeHandle;
      start: { x: number; y: number };
      originalBox: SourceBox;
    };

type DraftState = {
  formKey: string;
  formTitle: string;
  fileName: string;
  regions: EditableRegion[];
};

type SavedTemplatePage = {
  pageNumber: number;
  blob: Blob;
};

type SavedTemplateFile = {
  formKey: string;
  formTitle: string;
  fileName: string;
  savedAt: string;
  pages: SavedTemplatePage[];
};

const DRAFT_PREFIX = "brokerage-form-template:";
const SAVED_TEMPLATE_DB = "brokerage-standard-form-templates";
const SAVED_TEMPLATE_STORE = "forms";
const MIN_BOX_SIZE = 0.004;
const HANDLE_SIZE_CLASS = "size-3";
const NUDGE_SMALL = 0.002;
const NUDGE_LARGE = 0.01;
const RESIZE_HANDLES: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const FIELD_OPTIONS = FIELD_SECTIONS.flatMap((section) =>
  section.fields.map((field) => ({
    key: field.key,
    label: field.label,
    section: section.title,
  })),
);

export function FormTemplateEditor() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pageSurfaceRef = useRef<HTMLDivElement>(null);
  const [selectedFormKey, setSelectedFormKey] = useState(STANDARD_FORMS[0]?.key ?? "");
  const [selectedFieldKey, setSelectedFieldKey] = useState(FIELD_OPTIONS[0]?.key ?? "");
  const [customLabel, setCustomLabel] = useState("");
  const [fileName, setFileName] = useState("");
  const [pages, setPages] = useState<RenderedPage[]>([]);
  const [activePage, setActivePage] = useState(1);
  const [regions, setRegions] = useState<EditableRegion[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<BoxInteraction | null>(null);
  const [draftBox, setDraftBox] = useState<SourceBox | null>(null);
  const [progress, setProgress] = useState("");
  const [savedTemplate, setSavedTemplate] = useState<{ fileName: string; savedAt: string; pageCount: number } | null>(
    null,
  );

  const selectedForm = useMemo(
    () => STANDARD_FORMS.find((form) => form.key === selectedFormKey) ?? STANDARD_FORMS[0],
    [selectedFormKey],
  );
  const activePageImage = pages.find((page) => page.pageNumber === activePage) ?? pages[0];
  const activeField = FIELD_OPTIONS.find((field) => field.key === selectedFieldKey);
  const currentDraftKey = selectedForm ? draftKey(selectedForm.key) : "";
  const selectedRegion = regions.find((region) => region.id === selectedRegionId) ?? null;
  const exportSnippet = useMemo(
    () => buildTypeScriptSnippet(regions, selectedForm),
    [regions, selectedForm],
  );
  const exportJson = useMemo(
    () =>
      JSON.stringify(
        {
          formKey: selectedForm?.key ?? selectedFormKey,
          formTitle: selectedForm?.title ?? "",
          fileName,
          fieldRegions: regions.map((region) => ({
            fieldKey: region.fieldKey,
            label: region.label,
            page: region.page,
            boxes: [region.box],
          })),
        },
        null,
        2,
      ),
    [fileName, regions, selectedForm, selectedFormKey],
  );

  useEffect(() => {
    return () => {
      for (const page of pages) URL.revokeObjectURL(page.url);
    };
  }, [pages]);

  useEffect(() => {
    if (!selectedForm) return;
    void refreshSavedTemplateMeta(selectedForm.key);
  }, [selectedForm]);

  function updatePages(nextPages: RenderedPage[]) {
    setPages((previous) => {
      for (const page of previous) URL.revokeObjectURL(page.url);
      return nextPages;
    });
  }

  function updateRegionBox(regionId: string, updater: (box: SourceBox) => SourceBox) {
    setRegions((current) =>
      current.map((region) =>
        region.id === regionId
          ? {
              ...region,
              box: normalizeSize(updater(region.box)),
            }
          : region,
      ),
    );
  }

  function updateSelectedBox(updater: (box: SourceBox) => SourceBox) {
    if (!selectedRegionId) return;
    updateRegionBox(selectedRegionId, updater);
  }

  async function renderTemplateFile(file: File) {
    if (!isPdf(file) && !isJpeg(file)) {
      toast.error("Use a blank PDF, JPG, or JPEG form.");
      return;
    }

    try {
      setProgress("Rendering blank form...");
      const rendered = await renderFilePages(file, setProgress);
      const nextPages = rendered.map((page, index) => ({
        pageNumber: index + 1,
        url: URL.createObjectURL(page.blob),
        blob: page.blob,
      }));
      updatePages(nextPages);
      setFileName(`${file.name} (${formatSize(file.size)})`);
      setActivePage(1);
      setSelectedRegionId(null);
      toast.success(`Rendered ${nextPages.length} page${nextPages.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not render the form.");
    } finally {
      setProgress("");
    }
  }

  function pointerToBoxPoint(event: PointerEvent<HTMLElement>) {
    const surface = pageSurfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  }

  function beginDraw(event: PointerEvent<HTMLDivElement>) {
    if (!activePageImage) return;
    if (interaction) return;
    const point = pointerToBoxPoint(event);
    if (!point) return;
    setInteraction({ kind: "draw", start: point });
    setDraftBox({ x: point.x, y: point.y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueInteraction(event: PointerEvent<HTMLElement>) {
    if (!interaction) return;
    const point = pointerToBoxPoint(event);
    if (!point) return;

    if (interaction.kind === "draw") {
      setDraftBox(normalizeBox(interaction.start, point));
      return;
    }

    if (interaction.kind === "move") {
      const dx = point.x - interaction.start.x;
      const dy = point.y - interaction.start.y;
      const moved = moveBox(interaction.originalBox, dx, dy);
      setRegions((current) =>
        current.map((region) =>
          region.id === interaction.regionId ? { ...region, box: moved } : region,
        ),
      );
      return;
    }

    const resized = resizeBox(interaction.originalBox, interaction.start, point, interaction.handle);
    setRegions((current) =>
      current.map((region) =>
        region.id === interaction.regionId ? { ...region, box: resized } : region,
      ),
    );
  }

  function finishInteraction(event: PointerEvent<HTMLElement>) {
    if (!interaction) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (interaction.kind !== "draw") {
      setInteraction(null);
      return;
    }

    if (!draftBox) {
      setInteraction(null);
      return;
    }

    const box = normalizeSize(draftBox);
    setInteraction(null);
    setDraftBox(null);

    if (box.width < MIN_BOX_SIZE || box.height < MIN_BOX_SIZE) return;
    if (!activeField) {
      toast.error("Choose a field before drawing a box.");
      return;
    }

    const label = customLabel.trim() || activeField.label;
    const region: EditableRegion = {
      id: crypto.randomUUID(),
      fieldKey: activeField.key,
      label,
      page: activePage,
      box,
    };
    setRegions((current) => [...current, region]);
    setSelectedRegionId(region.id);
  }

  function cancelInteraction() {
    setInteraction(null);
    setDraftBox(null);
  }

  function beginMove(event: PointerEvent<HTMLButtonElement>, region: EditableRegion) {
    const point = pointerToBoxPoint(event);
    if (!point) return;
    event.stopPropagation();
    setSelectedRegionId(region.id);
    setInteraction({
      kind: "move",
      regionId: region.id,
      start: point,
      originalBox: region.box,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function beginResize(
    event: PointerEvent<HTMLElement>,
    region: EditableRegion,
    handle: ResizeHandle,
  ) {
    const point = pointerToBoxPoint(event);
    if (!point) return;
    event.stopPropagation();
    setSelectedRegionId(region.id);
    setInteraction({
      kind: "resize",
      regionId: region.id,
      handle,
      start: point,
      originalBox: region.box,
    });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function loadExistingRegions() {
    if (!selectedForm?.fieldRegions?.length) {
      toast.info("This form does not have existing regions yet.");
      return;
    }
    const nextRegions = selectedForm.fieldRegions.flatMap((region) =>
      region.boxes.map((box) => ({
        id: crypto.randomUUID(),
        fieldKey: region.fieldKey,
        label: region.label,
        page: region.page ?? activePage,
        box,
      })),
    );
    setRegions(nextRegions);
    setSelectedRegionId(nextRegions[0]?.id ?? null);
    toast.success(`Loaded ${nextRegions.length} existing region${nextRegions.length === 1 ? "" : "s"}.`);
  }

  function saveDraft() {
    if (!selectedForm) return;
    const draft: DraftState = {
      formKey: selectedForm.key,
      formTitle: selectedForm.title,
      fileName,
      regions,
    };
    localStorage.setItem(currentDraftKey, JSON.stringify(draft));
    toast.success("Template draft saved in this browser.");
  }

  function loadDraft() {
    const raw = localStorage.getItem(currentDraftKey);
    if (!raw) {
      toast.info("No saved draft for this form.");
      return;
    }
    const draft = JSON.parse(raw) as DraftState;
    setRegions(draft.regions ?? []);
    setFileName(draft.fileName ?? fileName);
    setSelectedRegionId(draft.regions?.[0]?.id ?? null);
    toast.success("Draft loaded.");
  }

  async function refreshSavedTemplateMeta(formKey: string) {
    try {
      const saved = await loadSavedTemplateFile(formKey);
      setSavedTemplate(
        saved
          ? {
              fileName: saved.fileName,
              savedAt: saved.savedAt,
              pageCount: saved.pages.length,
            }
          : null,
      );
    } catch {
      setSavedTemplate(null);
    }
  }

  async function saveBlankForm() {
    if (!selectedForm) return;
    if (!pages.length) {
      toast.info("Upload or load a blank form before saving it.");
      return;
    }

    try {
      const saved: SavedTemplateFile = {
        formKey: selectedForm.key,
        formTitle: selectedForm.title,
        fileName: fileName || selectedForm.title,
        savedAt: new Date().toISOString(),
        pages: pages.map((page) => ({
          pageNumber: page.pageNumber,
          blob: page.blob,
        })),
      };
      await saveTemplateFile(saved);
      await refreshSavedTemplateMeta(selectedForm.key);
      toast.success("Blank form saved for this standard form.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the blank form.");
    }
  }

  async function loadBlankForm() {
    if (!selectedForm) return;
    try {
      const saved = await loadSavedTemplateFile(selectedForm.key);
      if (!saved) {
        toast.info("No saved blank form for this standard form yet.");
        return;
      }
      updatePages(
        saved.pages.map((page) => ({
          pageNumber: page.pageNumber,
          url: URL.createObjectURL(page.blob),
          blob: page.blob,
        })),
      );
      setFileName(saved.fileName);
      setActivePage(1);
      setSelectedRegionId(null);
      setSavedTemplate({
        fileName: saved.fileName,
        savedAt: saved.savedAt,
        pageCount: saved.pages.length,
      });
      toast.success(`Loaded saved blank form with ${saved.pages.length} page${saved.pages.length === 1 ? "" : "s"}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load the saved blank form.");
    }
  }

  async function deleteBlankForm() {
    if (!selectedForm) return;
    try {
      await deleteSavedTemplateFile(selectedForm.key);
      setSavedTemplate(null);
      toast.success("Saved blank form removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the saved blank form.");
    }
  }

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied.`);
  }

  function downloadJson() {
    const blob = new Blob([`${exportJson}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedForm?.key ?? "standard-form"}-regions.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-[1500px] space-y-4 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Standard Form Template Editor</h1>
          <p className="text-sm text-muted-foreground">
            Draw, move, resize, and export parser-ready template regions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={loadDraft}>
            <Upload />
            Load draft
          </Button>
          <Button variant="outline" onClick={saveDraft} disabled={!selectedForm}>
            <Save />
            Save draft
          </Button>
          <Button onClick={() => copy(exportSnippet, "TypeScript snippet")} disabled={regions.length === 0}>
            <ClipboardCopy />
            Copy snippet
          </Button>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_380px]">
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base">Template Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="form-select" className="text-sm font-medium">
                Standard form
              </label>
              <select
                id="form-select"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={selectedFormKey}
                onChange={(event) => {
                  setSelectedFormKey(event.target.value);
                  setSelectedRegionId(null);
                }}
              >
                {STANDARD_FORMS.map((form) => (
                  <option key={form.key} value={form.key}>
                    {form.formNumbers?.length ? `Form ${form.formNumbers.join("/")} - ` : ""}
                    {form.title}
                  </option>
                ))}
              </select>
              {selectedForm && (
                <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">{selectedForm.key}</p>
                  <p>{selectedForm.documentType}</p>
                  <p>{selectedForm.fieldRegions?.length ?? 0} existing region groups</p>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="field-select" className="text-sm font-medium">
                Field for next box
              </label>
              <select
                id="field-select"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={selectedFieldKey}
                onChange={(event) => {
                  setSelectedFieldKey(event.target.value);
                  setCustomLabel("");
                }}
              >
                {FIELD_OPTIONS.map((field) => (
                  <option key={field.key} value={field.key}>
                    {field.label}
                  </option>
                ))}
              </select>
              <Input
                value={customLabel}
                onChange={(event) => setCustomLabel(event.target.value)}
                placeholder={activeField?.label ?? "Field label"}
              />
            </div>

            <div className="rounded-md border border-dashed p-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void renderTemplateFile(file);
                  event.target.value = "";
                }}
              />
              <Button className="w-full" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <FileText />
                Upload blank form
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">
                {progress || fileName || "PDF and JPEG blank forms are supported."}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={loadBlankForm}>
                  <Upload />
                  Load saved
                </Button>
                <Button variant="outline" onClick={saveBlankForm} disabled={!pages.length}>
                  <Save />
                  Save blank
                </Button>
              </div>
              {savedTemplate && (
                <div className="mt-3 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">Saved blank form</p>
                  <p className="truncate">{savedTemplate.fileName}</p>
                  <p>
                    {savedTemplate.pageCount} page{savedTemplate.pageCount === 1 ? "" : "s"} saved{" "}
                    {formatSavedAt(savedTemplate.savedAt)}
                  </p>
                  <Button
                    className="mt-2"
                    variant="ghost"
                    size="sm"
                    onClick={deleteBlankForm}
                  >
                    <Trash2 />
                    Remove saved blank
                  </Button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={loadExistingRegions}>
                Load existing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setRegions([]);
                  setSelectedRegionId(null);
                }}
                disabled={regions.length === 0}
              >
                Clear boxes
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Blank Form Canvas</CardTitle>
              <div className="flex flex-wrap gap-1">
                {pages.map((page) => (
                  <Button
                    key={page.pageNumber}
                    variant={activePage === page.pageNumber ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setActivePage(page.pageNumber)}
                  >
                    Page {page.pageNumber}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MousePointer2 className="size-3.5" />
              Drag empty space to draw. Drag a selected box to move it. Use handles or the side controls for precision.
            </div>
          </CardHeader>
          <CardContent>
            {activePageImage ? (
              <div className="max-h-[78vh] overflow-auto rounded-lg border bg-muted/30 p-3">
                <div
                  ref={pageSurfaceRef}
                  className="relative mx-auto w-full max-w-4xl cursor-crosshair select-none overflow-hidden rounded border bg-white"
                  onPointerDown={beginDraw}
                  onPointerMove={continueInteraction}
                  onPointerUp={finishInteraction}
                  onPointerCancel={cancelInteraction}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                  <img src={activePageImage.url} alt={`Blank form page ${activePage}`} className="block w-full" />
                  {regions
                    .filter((region) => region.page === activePage)
                    .map((region) => (
                      <button
                        key={region.id}
                        type="button"
                        className={`absolute rounded-[2px] border-2 text-left transition-colors ${
                          selectedRegionId === region.id
                            ? "cursor-move border-amber-500 bg-amber-300/35"
                            : "cursor-pointer border-sky-500 bg-sky-300/25 hover:bg-sky-300/40"
                        }`}
                        style={{
                          left: `${region.box.x * 100}%`,
                          top: `${region.box.y * 100}%`,
                          width: `${region.box.width * 100}%`,
                          height: `${region.box.height * 100}%`,
                        }}
                        title={`${region.label} (${region.fieldKey})`}
                        onPointerDown={(event) => beginMove(event, region)}
                        onPointerMove={continueInteraction}
                        onPointerUp={finishInteraction}
                        onPointerCancel={cancelInteraction}
                      >
                        {selectedRegionId === region.id && (
                          <>
                            {RESIZE_HANDLES.map((handle) => (
                              <span
                                key={handle}
                                title={`Resize ${handle}`}
                                className={`absolute z-10 rounded-[2px] border border-amber-700 bg-background shadow-sm ${HANDLE_SIZE_CLASS} ${handleClassName(handle)}`}
                                onPointerDown={(event) => beginResize(event, region, handle)}
                                onPointerMove={continueInteraction}
                                onPointerUp={finishInteraction}
                                onPointerCancel={cancelInteraction}
                              />
                            ))}
                          </>
                        )}
                      </button>
                    ))}
                  {draftBox && (
                    <div
                      className="pointer-events-none absolute rounded-[2px] border-2 border-primary bg-primary/20"
                      style={{
                        left: `${draftBox.x * 100}%`,
                        top: `${draftBox.y * 100}%`,
                        width: `${draftBox.width * 100}%`,
                        height: `${draftBox.height * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
            ) : (
              <div className="flex min-h-[520px] items-center justify-center rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
                Upload a blank standard form to start drawing regions.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Regions</CardTitle>
              <Badge variant="outline">{regions.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-72 space-y-2 overflow-auto">
              {regions.map((region) => (
                <button
                  key={region.id}
                  type="button"
                  onClick={() => {
                    setSelectedRegionId(region.id);
                    setActivePage(region.page);
                  }}
                  className={`w-full rounded-md border p-2 text-left text-sm ${
                    selectedRegionId === region.id ? "border-primary bg-muted" : "bg-background hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{region.label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {region.fieldKey} | page {region.page}
                      </p>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      {formatBox(region.box)}
                    </Badge>
                  </div>
                </button>
              ))}
              {regions.length === 0 && (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  No field boxes yet.
                </div>
              )}
            </div>

            {selectedRegion && (
              <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                <p className="text-sm font-medium">Selected region</p>
                <Input
                  value={selectedRegion.label}
                  onChange={(event) =>
                    setRegions((current) =>
                      current.map((region) =>
                        region.id === selectedRegion.id ? { ...region, label: event.target.value } : region,
                      ),
                    )
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setActivePage(selectedRegion.page)}
                  >
                    Page {selectedRegion.page}
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      setRegions((current) => current.filter((region) => region.id !== selectedRegion.id));
                      setSelectedRegionId(null);
                    }}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {(["x", "y", "width", "height"] as const).map((key) => (
                    <div key={key} className="space-y-1">
                      <label htmlFor={`region-${key}`} className="text-xs font-medium uppercase text-muted-foreground">
                        {key === "width" ? "w" : key === "height" ? "h" : key}
                      </label>
                      <Input
                        id={`region-${key}`}
                        type="number"
                        step="0.0001"
                        min="0"
                        max="1"
                        value={selectedRegion.box[key]}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (!Number.isFinite(value)) return;
                          updateRegionBox(selectedRegion.id, (box) => ({ ...box, [key]: value }));
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="rounded-md border bg-background p-2">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">Nudge selected box</p>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => updateSelectedBox((box) => growBox(box, -NUDGE_SMALL))}
                      >
                        Shrink
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => updateSelectedBox((box) => growBox(box, NUDGE_SMALL))}
                      >
                        Grow
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    <span />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title="Move up"
                      onClick={() => updateSelectedBox((box) => moveBox(box, 0, -NUDGE_SMALL))}
                    >
                      <ArrowUp />
                    </Button>
                    <span />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title="Move left"
                      onClick={() => updateSelectedBox((box) => moveBox(box, -NUDGE_SMALL, 0))}
                    >
                      <ArrowLeft />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      title="Grow by a larger step"
                      onClick={() => updateSelectedBox((box) => growBox(box, NUDGE_LARGE))}
                    >
                      Grow+
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title="Move right"
                      onClick={() => updateSelectedBox((box) => moveBox(box, NUDGE_SMALL, 0))}
                    >
                      <ArrowRight />
                    </Button>
                    <span />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      title="Move down"
                      onClick={() => updateSelectedBox((box) => moveBox(box, 0, NUDGE_SMALL))}
                    >
                      <ArrowDown />
                    </Button>
                    <span />
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Export</p>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    title="Copy JSON"
                    onClick={() => copy(exportJson, "JSON")}
                    disabled={regions.length === 0}
                  >
                    <ClipboardCopy />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    title="Download JSON"
                    onClick={downloadJson}
                    disabled={regions.length === 0}
                  >
                    <Download />
                  </Button>
                </div>
              </div>
              <Textarea
                className="min-h-72 font-mono text-xs"
                value={exportSnippet}
                readOnly
                placeholder="Draw at least one field box to generate a snippet."
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function draftKey(formKey: string) {
  return `${DRAFT_PREFIX}${formKey}`;
}

function openSavedTemplateDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(SAVED_TEMPLATE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SAVED_TEMPLATE_STORE)) {
        db.createObjectStore(SAVED_TEMPLATE_STORE, { keyPath: "formKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open saved template storage."));
  });
}

async function saveTemplateFile(template: SavedTemplateFile) {
  const db = await openSavedTemplateDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SAVED_TEMPLATE_STORE, "readwrite");
      const store = transaction.objectStore(SAVED_TEMPLATE_STORE);
      store.put(template);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the blank form."));
    });
  } finally {
    db.close();
  }
}

async function loadSavedTemplateFile(formKey: string) {
  const db = await openSavedTemplateDb();
  try {
    return await new Promise<SavedTemplateFile | null>((resolve, reject) => {
      const transaction = db.transaction(SAVED_TEMPLATE_STORE, "readonly");
      const request = transaction.objectStore(SAVED_TEMPLATE_STORE).get(formKey);
      request.onsuccess = () => resolve((request.result as SavedTemplateFile | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not load the saved blank form."));
    });
  } finally {
    db.close();
  }
}

async function deleteSavedTemplateFile(formKey: string) {
  const db = await openSavedTemplateDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SAVED_TEMPLATE_STORE, "readwrite");
      transaction.objectStore(SAVED_TEMPLATE_STORE).delete(formKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the saved blank form."));
    });
  } finally {
    db.close();
  }
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildTypeScriptSnippet(regions: EditableRegion[], form: StandardFormDefinition | undefined) {
  if (!form || regions.length === 0) return "";
  const grouped = new Map<string, EditableRegion[]>();
  for (const region of regions) {
    const key = `${region.fieldKey}:${region.label}:${region.page}`;
    grouped.set(key, [...(grouped.get(key) ?? []), region]);
  }

  const entries = Array.from(grouped.values()).map((group) => {
    const first = group[0];
    const boxes = group.map((region) => formatSourceBox(region.box)).join(", ");
    return [
      "      {",
      `        fieldKey: ${JSON.stringify(first.fieldKey)},`,
      `        label: ${JSON.stringify(first.label)},`,
      `        page: ${first.page},`,
      `        boxes: [${boxes}],`,
      "        note: calibratedRegionNote,",
      "      },",
    ].join("\n");
  });

  return [
    `// Paste into STANDARD_FORMS -> ${form.key} -> fieldRegions`,
    "fieldRegions: [",
    entries.join("\n"),
    "],",
  ].join("\n");
}

function formatSourceBox(box: SourceBox) {
  return `{ x: ${round(box.x)}, y: ${round(box.y)}, width: ${round(box.width)}, height: ${round(box.height)} }`;
}

function formatBox(box: SourceBox) {
  return `${round(box.x)}, ${round(box.y)}, ${round(box.width)}, ${round(box.height)}`;
}

function handleClassName(handle: ResizeHandle) {
  const classes: Record<ResizeHandle, string> = {
    n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
    e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
    s: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
    w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
    ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
    se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
    sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
    nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  };
  return classes[handle];
}

function moveBox(box: SourceBox, dx: number, dy: number): SourceBox {
  return normalizeSize({
    ...box,
    x: clamp(box.x + dx, 0, 1 - box.width),
    y: clamp(box.y + dy, 0, 1 - box.height),
  });
}

function resizeBox(
  box: SourceBox,
  start: { x: number; y: number },
  point: { x: number; y: number },
  handle: ResizeHandle,
): SourceBox {
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const left = box.x;
  const top = box.y;
  const right = box.x + box.width;
  const bottom = box.y + box.height;

  let nextLeft = left;
  let nextTop = top;
  let nextRight = right;
  let nextBottom = bottom;

  if (handle.includes("w")) nextLeft = clamp(left + dx, 0, right - MIN_BOX_SIZE);
  if (handle.includes("e")) nextRight = clamp(right + dx, left + MIN_BOX_SIZE, 1);
  if (handle.includes("n")) nextTop = clamp(top + dy, 0, bottom - MIN_BOX_SIZE);
  if (handle.includes("s")) nextBottom = clamp(bottom + dy, top + MIN_BOX_SIZE, 1);

  return normalizeSize({
    x: nextLeft,
    y: nextTop,
    width: nextRight - nextLeft,
    height: nextBottom - nextTop,
  });
}

function growBox(box: SourceBox, amount: number): SourceBox {
  const next = {
    x: box.x - amount,
    y: box.y - amount,
    width: box.width + amount * 2,
    height: box.height + amount * 2,
  };
  if (next.width < MIN_BOX_SIZE || next.height < MIN_BOX_SIZE) return box;
  return normalizeSize(next);
}

function normalizeBox(start: { x: number; y: number }, end: { x: number; y: number }): SourceBox {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return normalizeSize({
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  });
}

function normalizeSize(box: SourceBox): SourceBox {
  const x = clamp(box.x);
  const y = clamp(box.y);
  const width = Math.min(clamp(box.width), 1 - x);
  const height = Math.min(clamp(box.height), 1 - y);
  return {
    x: round(x),
    y: round(y),
    width: round(width),
    height: round(height),
  };
}

function clamp(value: number, min = 0, max = 1) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Number(value.toFixed(4));
}
