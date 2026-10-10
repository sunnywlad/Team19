import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { DEFAULT_POLICY } from "../src/config.ts";
import { validateRequestShape } from "../src/schema.ts";
import { ClientSigner, domainFor, recoverRequestSigner, requestDigest, type RequestStruct } from "../src/signer.ts";
import type { Hex, SignedRequest } from "../src/types.ts";
import { ManualClock, T0_MS, fixtures, readSpecJson } from "./helpers.ts";

type Vectors = {
  domain: { chainId: number; verifyingContract: Address };
  expected_signer: Address;
  vectors: { file: string; message: Record<keyof RequestStruct, string | number>; digest: Hex; signature: Hex }[];
};

test("vecteurs de specs : l'adresse récupérée est l'adresse attendue", async () => {
  const v = readSpecJson<Vectors>("examples/request/vectors.json");
  const domain = domainFor(v.domain.chainId, v.domain.verifyingContract);
  assert.equal(v.vectors.length, 5);
  for (const vector of v.vectors) {
    const request = readSpecJson<SignedRequest>(`examples/request/${vector.file}`);
    assert.equal(request.signature, vector.signature, vector.file);
    assert.equal(requestDigest(request, domain), vector.digest, `empreinte ${vector.file}`);
    assert.equal(await recoverRequestSigner(request, domain), v.expected_signer, `signataire ${vector.file}`);
  }
});

test("vecteurs de specs : un autre contrat ou une autre chaîne ne donne pas le signataire", async () => {
  const v = readSpecJson<Vectors>("examples/request/vectors.json");
  const request = readSpecJson<SignedRequest>(`examples/request/${v.vectors[0]!.file}`);
  const otherContract = domainFor(v.domain.chainId, "0x2222222222222222222222222222222222222222");
  const otherChain = domainFor(43113, v.domain.verifyingContract);
  assert.notEqual(await recoverRequestSigner(request, otherContract), v.expected_signer);
  assert.notEqual(await recoverRequestSigner(request, otherChain), v.expected_signer);
});

test("le client signe une demande conforme au schéma, vérifiable, que toute retouche invalide", async () => {
  const f = fixtures();
  const clock = new ManualClock(T0_MS);
  const domain = domainFor(31337, "0x1111111111111111111111111111111111111111");
  const signer = new ClientSigner(generatePrivateKey(), f.ids["C-DEMO"]!, domain, DEFAULT_POLICY, clock.now);
  const request = await signer.emit({
    request_id: `0x${"7".repeat(64)}`,
    agent_id: f.ids["A-DEM-1"]!,
    action: "PAY_INVOICE",
    ref_id: f.ids["F-001"]!,
  });

  assert.equal(validateRequestShape(request).ok, true);
  assert.equal(request.issued_at, T0_MS / 1000);
  assert.equal(request.expires_at - request.issued_at, DEFAULT_POLICY.demoTtlS);
  assert.equal(await recoverRequestSigner(request, domain), signer.address);

  const tampered: SignedRequest = { ...request, ref_id: f.ids["F-002"]! };
  assert.notEqual(await recoverRequestSigner(tampered, domain), signer.address);
});

test("le client refuse d'émettre une durée de vie hors bornes", () => {
  const f = fixtures();
  const domain = domainFor(31337, "0x1111111111111111111111111111111111111111");
  const signer = new ClientSigner(generatePrivateKey(), f.ids["C-DEMO"]!, domain, DEFAULT_POLICY, () => T0_MS);
  const intent = { request_id: `0x${"7".repeat(64)}` as Hex, agent_id: f.ids["A-DEM-1"]!, action: "PLACE" as const, ref_id: f.ids["P-020"]! };
  assert.throws(() => signer.build({ ...intent, ttlS: 301 }), RangeError);
  assert.throws(() => signer.build({ ...intent, ttlS: 0 }), RangeError);
});
