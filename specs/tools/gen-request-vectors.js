#!/usr/bin/env node
// Régénère les signatures des exemples de specs/examples/request et le fichier
// vectors.json (specs/01-demande.md § 6). À lancer à la main, jamais en CI :
//   node specs/tools/gen-request-vectors.js
//
// La clé de signature est tirée au hasard en mémoire à chaque exécution et
// n'est ni écrite ni affichée : seule l'adresse qui en dérive est publiée.
// Elle transite par les arguments de « cast » le temps de la commande ; elle
// ne protège rien et n'est jamais réutilisée. Conséquence : chaque exécution
// change l'adresse attendue et toutes les signatures d'un coup.
//
// Prérequis : cast (Foundry), même version que la CI.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const DIR = path.resolve(__dirname, "..", "examples", "request");

// Domaine des vecteurs (specs/01-demande.md § 5). Adresse de contrat factice.
const DOMAIN = {
  name: "ArgentVault",
  version: "1",
  chainId: 31337,
  verifyingContract: "0x1111111111111111111111111111111111111111",
};
const DOMAIN_TYPE = "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)";
const REQUEST_TYPE =
  "Request(bytes32 requestId,bytes32 clientId,bytes32 agentId,uint8 action,bytes32 refId,uint64 issuedAt,uint64 expiresAt)";
const ACTION = { PAY_INVOICE: 1, PLACE: 2 };
const TYPES = {
  EIP712Domain: [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
  ],
  Request: [
    { name: "requestId", type: "bytes32" },
    { name: "clientId", type: "bytes32" },
    { name: "agentId", type: "bytes32" },
    { name: "action", type: "uint8" },
    { name: "refId", type: "bytes32" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
  ],
};

function cast(...args) {
  return execFileSync("cast", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function keccakText(s) {
  return cast("keccak", s);
}

const key = "0x" + crypto.randomBytes(32).toString("hex");
const signer = cast("wallet", "address", "--private-key", key).toLowerCase();

const typeHash = keccakText(REQUEST_TYPE);
const domainSeparator = cast(
  "keccak",
  cast(
    "abi-encode",
    "f(bytes32,bytes32,bytes32,uint256,address)",
    keccakText(DOMAIN_TYPE),
    keccakText(DOMAIN.name),
    keccakText(DOMAIN.version),
    String(DOMAIN.chainId),
    DOMAIN.verifyingContract
  )
);

const manifest = JSON.parse(fs.readFileSync(path.join(DIR, "manifest.json"), "utf8"));
const vectors = [];
for (const c of manifest.cases) {
  if (c.expect === "schema-invalid") continue;
  const file = path.join(DIR, c.file);
  const req = JSON.parse(fs.readFileSync(file, "utf8"));
  const message = {
    requestId: req.request_id,
    clientId: req.client_id,
    agentId: req.agent_id,
    action: ACTION[req.action],
    refId: req.ref_id,
    issuedAt: req.issued_at,
    expiresAt: req.expires_at,
  };
  const structHash = cast(
    "keccak",
    cast(
      "abi-encode",
      "f(bytes32,bytes32,bytes32,bytes32,uint8,bytes32,uint64,uint64)",
      typeHash,
      message.requestId,
      message.clientId,
      message.agentId,
      String(message.action),
      message.refId,
      String(message.issuedAt),
      String(message.expiresAt)
    )
  );
  const digest = cast("keccak", "0x1901" + domainSeparator.slice(2) + structHash.slice(2));
  const typed = JSON.stringify({ types: TYPES, primaryType: "Request", domain: DOMAIN, message });
  const signature = cast("wallet", "sign", "--private-key", key, "--data", typed).toLowerCase();

  // Deux contrôles croisés : l'encodage EIP-712 de cast sur les données typées,
  // et notre empreinte recalculée à la main, doivent désigner le même signataire.
  cast("wallet", "verify", "--address", signer, "--data", typed, signature);
  cast("wallet", "verify", "--address", signer, "--no-hash", digest, signature);

  req.signature = signature;
  fs.writeFileSync(file, JSON.stringify(req, null, 2) + "\n");
  vectors.push({ file: c.file, expect: c.expect, rule: c.rule || null, message, struct_hash: structHash, digest, signature });
}

fs.writeFileSync(
  path.join(DIR, "vectors.json"),
  JSON.stringify(
    {
      comment: "Généré par specs/tools/gen-request-vectors.js. Ne pas éditer à la main.",
      domain: DOMAIN,
      types: TYPES,
      primaryType: "Request",
      request_type: REQUEST_TYPE,
      type_hash: typeHash,
      domain_separator: domainSeparator,
      expected_signer: signer,
      vectors,
    },
    null,
    2
  ) + "\n"
);
console.log(`vecteurs : ${vectors.length} demandes signées, signataire attendu ${signer}`);
