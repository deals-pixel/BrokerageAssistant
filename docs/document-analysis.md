# Example Package Analysis

Analyzed 2026-06-11 from the 3 example PDFs in `/Example`. **All 99 pages are scanned images (no text layer)** → extraction must be vision-based (Claude API with page images).

## Packages

| Package | Pages | Type | Contents |
|---|---|---|---|
| 1 Valleyview | 19 | Purchase/sale (listing side) | DIS, deposit proof (Canada Trust), Form 320, Form 801, Form 630 ×multiple, Form 124, Form 631 ×multiple |
| 41 Russfax | 45 | Lease (listing side) | DIS, RECO registrant disclosure, Ontario Standard Lease + schedules, RECO self-represented party disclosure, Listing Agreement (lease authority) + Schedule A, PropTx MLS data form, RECO Info Guide acknowledgement |
| 5 Shady | 35 | Purchase/sale (buyer side) | Deposit draft, Form 630 ×multiple, Form 631, Form 635 (Receipt of Funds), Buyer Rep Agreement (Form 371) + Schedule A, RECO Info Guide ack, Form 801, multiple-rep consents, Form 320, registrant disclosure, APS (Form 100) + Schedules A & B |

## Document Types (classification taxonomy)

- `deal_information_sheet` — Sutton Group internal "Deal Information Sheet"
- `agreement_of_purchase_and_sale` — OREA Form 100 (incl. Schedules A/B pages)
- `lease_agreement` — Ontario Residential Tenancy Agreement (Standard Lease) + appendix pages
- `form_801_offer_summary` — OREA Form 801
- `form_320_confirmation_cooperation` — OREA Form 320 Confirmation of Co-operation and Representation
- `form_630_individual_identification` — OREA Form 630 (FINTRAC Individual ID Information Record)
- `form_631_pep_checklist` — OREA Form 631 (Politically Exposed Person checklist)
- `form_635_receipt_of_funds` — OREA Form 635 (FINTRAC Receipt of Funds Record)
- `deposit_proof` — bank draft / cheque image / wire confirmation
- `form_124_notice_fulfillment` — OREA Form 124 Notice of Fulfillment of Condition(s)
- `listing_agreement` — OREA listing/representation agreement (sale Form 200 or lease Form 270) + Schedule A
- `buyer_representation_agreement` — OREA Form 371 Buyer Designated Representation Agreement + Schedule A
- `reco_information_guide_ack` — RECO Information Guide acknowledgement page
- `reco_self_represented_disclosure` — RECO Information/Disclosure to Self-Represented Party
- `registrant_disclosure_of_interest` — RECO registrant disclosure (acquisition/disposition of property)
- `multiple_representation_consent` — multiple representation acknowledgement/consent forms
- `mls_data_form` — PropTx/MLS data information form
- `other` — anything unrecognized

## Deal Information Sheet fields (the target output form — Sutton Group-Admiral Realty)

Header tags: Listing Side/Multiple Rep / Co-Operating Side / Pre-Con (admin names).

- **Top**: Your Name (agent), Property Address, Closing Date, MLS Number, Price, Firm/Conditional, Condition(s), Expiry, Multiple Offer? (+ how many)
- **Acting for Listing Side checklist**: Listing Agreement, Schedule A to Listing Agreement, RECO Information Guide, APS/Lease, Schedule B, Confirmation of Co-operation, Form 801 (not leases), Individual ID per client (not leases), FINTRAC checklist per client (not leases)
- **Acting for Co-Operating Side checklist**: APS/Lease, Schedule B, Confirmation of Co-operation, Buyer Rep Agreement, Schedule A to BRA, RECO Info Guide, Individual ID per client, FINTRAC checklist per client, copy of deposit cheque, Receipt of Funds Record, Form 801
- **Seller's/Landlord Information**: name, email, lawyer, lawyer email, lawyer phone, address
- **Buyer's/Tenants Information**: name, email, lawyer, lawyer email, lawyer phone, address, phone
- **Commission**: total commission %, your commission %, additional buyer's $?, additional commission %s, outside agent (name, co-op commission %, marketing fee)
- **Rebate to your clients?** (Y/N + amount), **Referral?** (Y/N + to whom)
- **Deposit info**: held by Sutton? wire transfer / direct deposit / cheque, amount, further deposit (amount + due date)

## Extraction field schema (deal_fields keys)

Property: property_address, mls_number, transaction_type (purchase|lease), representation_side (listing|cooperating|both)
Financial: sale_price (or monthly rent), deposit_amount, deposit_method, deposit_held_by, further_deposit_amount, further_deposit_due, total_commission_pct, listing_commission_pct, cooperating_commission_pct, rebate_amount, referral_to
Status: firm_or_conditional, conditions_summary, condition_expiry_date, multiple_offer (+count)
Dates: offer_date, acceptance_date, closing_date, lease_start_date, lease_end_date, irrevocable_date
Parties: buyer_names, buyer_emails, buyer_phone, buyer_address, seller_names, seller_emails, seller_address
Lawyers: buyer_lawyer_name, buyer_lawyer_firm, buyer_lawyer_email, buyer_lawyer_phone, seller_lawyer_name, seller_lawyer_firm, seller_lawyer_email, seller_lawyer_phone
Agents: listing_agent_name, listing_brokerage, cooperating_agent_name, cooperating_brokerage, agent_name (our side)

## Required-document rules

Purchase/sale: deal_information_sheet, agreement_of_purchase_and_sale, form_801_offer_summary, form_320_confirmation_cooperation, deposit_proof, form_630_individual_identification, form_631_pep_checklist, form_635_receipt_of_funds (buyer side)
Lease: deal_information_sheet, lease_agreement, deposit_proof; conditional: form_630/631, disclosure forms
