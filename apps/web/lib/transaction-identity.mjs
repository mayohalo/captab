export function assertObservedTransaction(result, { txHash, signerId, companyId, daoId }) {
  const transaction = result?.transaction;
  if (transaction?.hash !== txHash || transaction?.signer_id !== signerId) {
    throw new Error("RPC transaction identity mismatch");
  }
  if (transaction.receiver_id !== companyId && transaction.receiver_id !== daoId) {
    throw new Error("Transaction does not target the company or its DAO");
  }
}
