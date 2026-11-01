import { NextResponse } from "next/server";
import { reconcileOperation, registerOperation } from "../../../../lib/observer";
import { validAccountId } from "../../../../lib/near";

export const runtime = "nodejs";

const hashPattern = /^[1-9A-HJ-NP-Za-km-z]{32,64}$/;

export async function POST(request: Request) {
  const bodyText = await request.text();
  if (bodyText.length > 4_096) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(bodyText); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { companyId, signerId, txHash } = body;
  if (typeof companyId !== "string" || !validAccountId(companyId) || typeof signerId !== "string" || !validAccountId(signerId) || typeof txHash !== "string" || !hashPattern.test(txHash)) {
    return NextResponse.json({ error: "Invalid company, signer, or transaction hash" }, { status: 400 });
  }
  try {
    const operation = await registerOperation(companyId, txHash, signerId);
    const observed = await reconcileOperation(operation, companyId);
    return NextResponse.json({ operationId: observed.id, status: observed.status, checkCount: observed.check_count, lastError: observed.last_error }, { status: observed.status === "Pending" ? 202 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Observation failed" }, { status: 502 });
  }
}
