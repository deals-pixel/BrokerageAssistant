/* Re-runs the AI pipeline on an existing deal.
   Usage: npx tsx --env-file=.env.local scripts/reprocess.ts <dealId> */
import { processDeal } from "../src/lib/ai/pipeline";

const dealId = process.argv[2];
if (!dealId) {
  console.error("Usage: reprocess.ts <dealId>");
  process.exit(1);
}

processDeal(dealId)
  .then(() => console.log("Reprocessed OK"))
  .catch((err) => {
    console.error("FAILED:", err.message ?? err);
    process.exit(1);
  });
