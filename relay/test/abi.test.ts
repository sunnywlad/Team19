import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ABI_SOURCE_SHA256, argentVaultAbi } from "../src/abi.ts";
import { ACTION, DECISION, DEFAULT_POLICY, REASON, SPECS_DIR, effectiveDecision, reasonName } from "../src/config.ts";

const source = readFileSync(join(SPECS_DIR, "contract/IArgentVault.sol"));

test("src/abi.ts est à jour avec l'interface gelée", () => {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    ABI_SOURCE_SHA256,
    "IArgentVault.sol a changé : relancer node relay/tools/gen-abi.ts",
  );
  const names: string[] = argentVaultAbi.map((item) => ("name" in item ? item.name : ""));
  for (const needed of ["submit", "agentPaused", "Decision", "Paid"]) assert.ok(names.includes(needed), needed);
});

test("les constantes du relais suivent celles du fichier Solidity", () => {
  const constants = new Map<string, number>();
  for (const m of source.toString("utf8").matchAll(/^uint(?:8|64) constant (\w+) = (\d+);/gm)) constants.set(m[1]!, Number(m[2]));

  const expected: Record<string, number> = { MAX_TTL: DEFAULT_POLICY.maxTtlS, MAX_CLOCK_SKEW: DEFAULT_POLICY.maxClockSkewS };
  for (const [k, v] of Object.entries(ACTION)) expected[`ACTION_${k}`] = v;
  for (const [k, v] of Object.entries(DECISION)) expected[`DECISION_${k}`] = v;
  for (const [k, v] of Object.entries(REASON)) expected[`REASON_${k}`] = v;
  assert.deepEqual(Object.fromEntries([...constants].sort()), Object.fromEntries(Object.entries(expected).sort()));
});

test("un motif inconnu est traité comme un refus", () => {
  assert.equal(reasonName(1), "INVOICE_UNKNOWN");
  assert.equal(reasonName(200), null);
  assert.equal(effectiveDecision(2, 0), 2);
  assert.equal(effectiveDecision(2, 200), 0);
  assert.equal(effectiveDecision(7, 0), 0);
});
