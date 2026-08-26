import fs from "node:fs";
import path from "node:path";

const routerPath = path.resolve(process.cwd(), "server/routers/cost.ts");
const source = fs.readFileSync(routerPath, "utf8");
const prohibited = [
  "ensureCostSeed",
  "Math.random()",
  "const services = [",
  "ON CONFLICT DO NOTHING",
];
const violations = prohibited.filter((token) => source.includes(token));
if (violations.length > 0) {
  throw new Error(`cost router contains prohibited fabricated-data behavior: ${violations.join(", ")}`);
}
console.log("Cost router contains no synthetic cost-data write path.");
