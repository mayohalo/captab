import { canonicalJson } from "./release-verification.mjs";
import { Account, PublicKey, actions } from "near-api-js";

export function publicAccessKeys(accessKeyList) {
  return accessKeyList.keys.map(key => ({ publicKey: key.public_key, permission: key.access_key.permission }));
}

export function assessCompanyFreeze({ manifest, codeHash, accessKeys, deploymentPublicKey }) {
  const issues = [];
  if (manifest?.network !== "testnet" || !manifest?.companyId) issues.push("Deployment manifest is not for a testnet company.");
  if (!deploymentPublicKey || deploymentPublicKey !== manifest?.company?.deploymentPublicKey) {
    issues.push("Deployment key identity does not match the manifest.");
  }
  if (codeHash !== manifest?.company?.codeHash) issues.push("Company code differs from the release manifest.");
  const recorded = manifest?.company?.remainingAccessKeys;
  if (!Array.isArray(recorded) || canonicalJson([...recorded].sort((a, b) => a.publicKey.localeCompare(b.publicKey))) !==
    canonicalJson([...accessKeys].sort((a, b) => a.publicKey.localeCompare(b.publicKey)))) {
    issues.push("Company access keys changed since the release manifest.");
  }
  const fullAccess = accessKeys.filter(key => key.permission === "FullAccess");
  if (fullAccess.length !== 1 || fullAccess[0].publicKey !== deploymentPublicKey) {
    issues.push("The deployment key must be the company's only full-access key before freezing.");
  }
  if (manifest?.company?.frozen === true) issues.push("Company is already marked frozen in the manifest.");
  return issues;
}

export async function removeCompanyDeploymentKey({ provider, companyId, privateKey, publicKey, expectedCodeHash }) {
  const company = new Account(companyId, provider, privateKey);
  const result = await company.signAndSendTransaction({ receiverId: companyId,
    actions: [actions.deleteKey(PublicKey.fromString(publicKey))], waitUntil: "FINAL" });
  const finalQuery = { finality: "final" };
  const [code, keys] = await Promise.all([
    provider.viewContractCode({ contractId: companyId, blockQuery: finalQuery }),
    provider.viewAccessKeyList({ accountId: companyId, finalityQuery: finalQuery }),
  ]);
  const remainingAccessKeys = publicAccessKeys(keys);
  if (code.hash !== expectedCodeHash || remainingAccessKeys.some(key => key.permission === "FullAccess" || key.publicKey === publicKey)) {
    throw new Error("Post-removal chain state is unexpected; inspect the key-removal receipt before refreshing the manifest");
  }
  return { txHash: result.transaction.hash, remainingAccessKeys };
}
