import { readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-static";

/** Serves the repository's root llms.txt (https://llmstxt.org), read at build time so the site and the repo never differ. */
export function GET() {
  const body = readFileSync(join(process.cwd(), "../../llms.txt"), "utf8");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
