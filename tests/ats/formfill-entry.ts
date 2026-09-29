// Browser bundle of the server fill planner, so the harness can run resolve-form-fill's logic
// locally. Built by build-config.mjs into generated/formfill.js.
import { buildPlan } from "../../supabase/functions/_shared/formfill/plan.ts";

(globalThis as Record<string, unknown>).__FormFill = { buildPlan };
