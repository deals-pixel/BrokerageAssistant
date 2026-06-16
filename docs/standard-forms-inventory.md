# Standard Forms Reference Inventory

Source folder: `Example/Standard forms`

Inventory date: 2026-06-15

## Summary

- 15 scenario folders
- 223 PDF files
- 21 `.DS_Store` files ignored
- The folder mirrors the 15 transaction scenarios used by the app.

## Classifier Mapping Notes

These mappings are now reflected in `app/src/lib/ai/classify.ts`:

| Standard form | App document type |
|---|---|
| Deal Information Sheet | `deal_information_sheet` |
| Form 100 Agreement of Purchase and Sale | `agreement_of_purchase_and_sale` |
| Form 120 Amendment | `waiver_notice_fulfillment_amendment` |
| Form 123 Waiver | `waiver_notice_fulfillment_amendment` |
| Form 124 Notice of Fulfillment | `form_124_notice_fulfillment` |
| Forms 271, 272, 593 listing / seller / landlord representation agreements | `listing_agreement` |
| Form 320 Confirmation of Cooperation | `form_320_confirmation_cooperation` |
| Forms 325, 326, 327, 328 multiple representation consents | `multiple_representation_consent` |
| Form 371 Buyer Designated Representation Agreement | `buyer_representation_agreement` |
| Form 372 Tenant Designated Representation Agreement | `tenant_representation_agreement` |
| Form 400 Agreement to Lease | `agreement_to_lease` |
| Lease Forms 403, 404, 420 waiver / fulfillment / amendment | `waiver_notice_fulfillment_amendment` |
| Form 630 Individual Identification Record | `form_630_individual_identification` |
| Form 631 Corporation / Entity Identification Record | `corporate_id_articles` |
| Form 634 PEP / HIO Checklist | `form_631_pep_checklist` |
| Form 635 Receipt of Funds Record | `form_635_receipt_of_funds` |
| Form 641 Referral Agreement | `referral_agreement` |
| Form 650 Co-Brokerage Agreement | `co_brokerage_agreement` |
| RECO Information Guide acknowledgement | `reco_information_guide_ack` |
| RECO Information and Disclosure to Self-Represented Party | `reco_self_represented_disclosure` |
| Ontario Residential Tenancy Agreement | `ontario_residential_tenancy_agreement` |
| Office Schedule B / Office Schedule B Lease | Parent APS or lease document |

## Notes

- The app keeps the existing `form_631_pep_checklist` key for compatibility, but the display label now reflects Form 634.
- The standard forms are useful as classifier guidance and audit references, but they are not committed into the app bundle.
- Reprocessing a deal now stores page-level standard form metadata on `deal_pages` when a page matches the registry. The review portal displays the matched form label in the document list and page preview.
- Matched templates are passed into extraction as layout priors. If AI extraction reads a value but cannot return a source box, the pipeline can use the matching form's template region as a fallback highlight.
