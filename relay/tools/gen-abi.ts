// Régénère src/abi.ts depuis specs/contract/IArgentVault.sol. À lancer à la
// main quand l'interface gelée change :
//   node relay/tools/gen-abi.ts
// Prérequis : forge (Foundry). Le test test/abi.test.ts échoue tant que
// src/abi.ts ne correspond plus à l'empreinte du fichier Solidity.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../specs/contract/IArgentVault.sol");
const target = resolve(here, "../src/abi.ts");

const work = mkdtempSync(join(tmpdir(), "relay-abi-"));
try {
  cpSync(source, join(work, "src", "IArgentVault.sol"), { recursive: true });
  writeFileSync(join(work, "foundry.toml"), '[profile.default]\nsrc = "src"\nout = "out"\nsolc_version = "0.8.24"\n');
  execFileSync("forge", ["build", "--root", work], { stdio: ["ignore", "ignore", "inherit"] });
  const artifact = JSON.parse(readFileSync(join(work, "out", "IArgentVault.sol", "IArgentVault.json"), "utf8")) as {
    abi: unknown[];
  };
  const sha = createHash("sha256").update(readFileSync(source)).digest("hex");
  writeFileSync(
    target,
    "// Généré par relay/tools/gen-abi.ts depuis specs/contract/IArgentVault.sol.\n" +
      "// Ne pas éditer à la main.\n" +
      `export const ABI_SOURCE_SHA256 = "${sha}";\n\n` +
      `export const argentVaultAbi = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`,
  );
  console.log(`abi : ${artifact.abi.length} éléments, source ${sha.slice(0, 12)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
