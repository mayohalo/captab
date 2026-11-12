import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { buildCapTable, capTableCsv } from "../../../../../lib/cap-table-export";
import { network, readCompany, type Totals, validAccountId, view } from "../../../../../lib/near";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!validAccountId(id)) return NextResponse.json({ error: "Invalid company account" }, { status: 400 });
  const format = new URL(request.url).searchParams.get("format") ?? "csv";
  if (format !== "csv" && format !== "json") return NextResponse.json({ error: "format must be csv or json" }, { status: 400 });
  try {
    const chain = await readCompany(id);
    const revisionAfter = (await view<Totals>(id, "get_totals")).ledger_revision;
    if (revisionAfter !== chain.totals.ledger_revision) {
      return NextResponse.json({ error: "Ledger changed while exporting; retry." }, { status: 409 });
    }
    const table = buildCapTable({ companyId: id, network, generatedAt: new Date().toISOString(),
      companyCodeHash: chain.companyAssessment.codeHash, config: chain.config, totals: chain.totals,
      holdings: chain.holdings, grants: chain.grants });
    const body = format === "csv" ? capTableCsv(table) : `${JSON.stringify(table, null, 2)}\n`;
    const sha256 = createHash("sha256").update(body).digest("hex");
    return new NextResponse(body, { headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${id}-cap-table-r${table.ledgerRevision}.${format}"`,
      "Cache-Control": "no-store", "X-Captab-Ledger-Revision": String(table.ledgerRevision), "X-Captab-Export-SHA256": sha256,
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read company" }, { status: 502 });
  }
}
