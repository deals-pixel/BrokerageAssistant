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
- `form_631_pep_checklist` — OREA Form 634 (Politically Exposed Person / Head of International Organization checklist)
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
- **Seller's/Landlord Information**: name, email, phone, lawyer, lawyer email, lawyer phone, address
- **Buyer's/Tenants Information**: name, email, lawyer, lawyer email, lawyer phone, address, phone
- **Commission**: total commission %, your commission %, additional payee(s) Y/N, additional payee 1/2 names, additional payee 1/2 commission %, outside agent (name, outside brokerage commission %, marketing fee)
- **Rebate to your clients?** (Y/N + amount), **Referral?** (Y/N + to whom when available)
- **Deposit info**: held by Sutton? wire transfer / direct deposit / cheque, amount, further deposit (amount + due date)

## Extraction field schema (deal_fields keys)

Property: property_address, mls_number, transaction_type (purchase|lease), representation_side (listing|cooperating|both)
Financial: sale_price (or monthly rent), deposit_amount, deposit_method, deposit_held_by, further_deposit_amount, further_deposit_due, total_commission_pct, your_commission_pct, outside_brokerage_commission_pct, listing_commission_pct, cooperating_commission_pct, additional_payees, additional_payee_1_name, additional_payee_1_commission_pct, additional_payee_2_name, additional_payee_2_commission_pct, marketing_fee_amount, rebate_to_clients, rebate_amount, referral, referral_to
Status: firm_or_conditional, conditions_summary, condition_expiry_date, multiple_offer (+count)
Dates: offer_date, acceptance_date, closing_date, lease_start_date, lease_end_date, irrevocable_date
Parties: buyer_names, buyer_emails, buyer_phone, buyer_address, seller_names, seller_emails, seller_phone, seller_address
Lawyers: buyer_lawyer_name, buyer_lawyer_firm, buyer_lawyer_email, buyer_lawyer_phone, seller_lawyer_name, seller_lawyer_firm, seller_lawyer_email, seller_lawyer_phone
Agents: listing_agent_name, listing_brokerage, cooperating_agent_name, cooperating_brokerage, agent_name (our side)

## Scenario and commission rule

Scenario selection is based on which side is represented by Sutton Group-Admiral:

- Listing side means the SGA agent is representing the seller/landlord.
- Co-operating side means the SGA agent is representing the buyer/tenant side.
- Both means SGA appears on both sides. The listing-side and co-operating-side agent names separate same-agent both-side scenarios from different-SGA-agent both-side scenarios; multiple-representation consent is fallback evidence when both agent names are not available.
- A visible other-side brokerage name means that side is represented by another brokerage, not self-represented.
- A missing other-side brokerage name is not enough by itself to prove self-represented. Use explicit self-represented wording or the self-represented disclosure, and only when no brokerage name is visible for that side.

`agent_name`, `your_commission_pct`, and `outside_brokerage_commission_pct` are Deal Information Sheet fields derived from the scenario. Source-side fields keep their literal meaning: `listing_agent_name` / `listing_brokerage` / `listing_commission_pct` describe the seller/landlord side, and `cooperating_agent_name` / `cooperating_brokerage` / `cooperating_commission_pct` describe the buyer/tenant side. If a source document says "selling brokerage" or "selling agent", that wording is treated as the co-operating side.

Scenario matrix:

| Transaction | Listing side | Co-operating side | Scenario |
|---|---|---|---|
| Sale | SGA | other brokerage or unknown | 1 - seller rep only |
| Sale | SGA | self-represented | 3 - seller rep / buyer self-represented |
| Sale | SGA same agent | SGA same agent | 2 - same SGA agent both sides |
| Sale | SGA different agent | SGA different agent | 4 - seller rep / buyer different SGA agent |
| Sale | other brokerage or unknown | SGA | 9 - buyer rep only |
| Sale | self-represented | SGA | 10 - buyer rep / seller self-represented |
| Lease | SGA | other brokerage or unknown | 5 - landlord rep only |
| Lease | SGA | self-represented | 7 - landlord rep / tenant self-represented |
| Lease | SGA same agent | SGA same agent | 6 - same SGA agent both sides |
| Lease | SGA different agent | SGA different agent | 8 - landlord rep / tenant different SGA agent |
| Lease | other brokerage or unknown | SGA | 11 - tenant rep only |
| Lease | self-represented | SGA | 12 - tenant rep / landlord self-represented |

Client and commission mapping:

| SGA side | Our client(s) | Other side / agent | Derived Your Commission % | Derived outside commission % |
|---|---|---|---|---|
| Listing sale | seller_names | buyer_names, cooperating_agent_name, cooperating_brokerage | listing_commission_pct | cooperating_commission_pct when visible |
| Co-operating sale | buyer_names | seller_names, listing_agent_name, listing_brokerage | cooperating_commission_pct | listing_commission_pct when visible |
| Listing lease | seller_names (landlord) | buyer_names (tenant), cooperating_agent_name, cooperating_brokerage | listing_commission_pct | cooperating_commission_pct when visible |
| Co-operating lease | buyer_names (tenant) | seller_names (landlord), listing_agent_name, listing_brokerage | cooperating_commission_pct | listing_commission_pct when visible |

Commission extraction rule:

- `listing_commission_pct` and `cooperating_commission_pct` should point to the actual field regions on the source forms.
- `your_commission_pct` and `outside_brokerage_commission_pct` are not source-form regions. They are derived after scenario detection.
- When SGA is on both sides, `your_commission_pct` is calculated from both source-side commissions when possible and marked for review so the admin can verify side split and payees.

## Required-document rules

Purchase/sale: deal_information_sheet, agreement_of_purchase_and_sale, form_801_offer_summary, form_320_confirmation_cooperation, deposit_proof, form_630_individual_identification, form_631_pep_checklist, form_635_receipt_of_funds (buyer side)
Lease: deal_information_sheet, lease_agreement, deposit_proof; conditional: form_630/631, disclosure forms
