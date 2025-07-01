// debugFetchAll.js
import dotenv from "dotenv";
dotenv.config();

import { fetchFromAirtable } from "./utils/airtable.js";

(async () => {
  console.log("=== All FAQ'S records ===");
  const faqs = await fetchFromAirtable("FAQ'S", {});
  console.log(JSON.stringify(faqs, null, 2));

  console.log("\n=== All Scripts records ===");
  const scripts = await fetchFromAirtable("Scripts", {});
  console.log(JSON.stringify(scripts, null, 2));
})().catch(err => {
  console.error("Debug fetch error:", err);
});
