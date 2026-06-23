# Standard Form Template Editor

Use `/admin/templates` to map blank standard forms to extraction fields.

## Workflow

1. Open the app and sign in.
2. Click `Templates` in the dashboard header.
3. Choose the matching standard form from the `Standard form` dropdown.
4. Upload the blank PDF or JPEG form.
5. Choose the field for the next box.
6. Drag a tight box around the empty value area on the rendered form.
7. Click `Load existing` when a form already has regions in `src/lib/standard-forms.ts`.
8. Select a box to adjust it:
   - drag the box to move it
   - drag an edge or corner handle to resize it
   - use the numeric `x`, `y`, `w`, and `h` inputs for exact coordinates
   - use the nudge controls for tiny position and size changes
9. Repeat for each field the parser should know.
10. Use `Save draft` if you want to keep working in the same browser later.
11. Click `Copy snippet`.
12. Paste the copied `fieldRegions` block into the matching form entry in `src/lib/standard-forms.ts`.
13. Run `npm run build`.
14. Reprocess a deal that uses that form and confirm the field source highlights land on the right area.

## Notes

- Coordinates are normalized from `0` to `1` against the full rendered page.
- Draw boxes around the value area, not just the printed label.
- `Load existing` imports the current regions from `standard-forms.ts` for adjustment.
- Selected boxes can be moved, resized, deleted, renamed, and edited numerically before export.
- Drafts are stored in browser localStorage. They are not shared across devices.
- The exported snippet is the production source of truth until a database-backed template registry is added.
