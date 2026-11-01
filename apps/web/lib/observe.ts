export async function observeTransaction(companyId: string, signerId: string, txHash: string): Promise<{ operationId: string; status: string } | null> {
  try {
    const response = await fetch("/api/transactions/observe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId, signerId, txHash }),
    });
    if (!response.ok) return null;
    return await response.json() as { operationId: string; status: string };
  } catch { return null; }
}
