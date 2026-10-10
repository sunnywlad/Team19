import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SCHEMAS_DIR, SPECS_DIR } from "../src/config.ts";

describe("schéma de la demande reçue", () => {
  // specs/ est la référence gelée ; gateway/schemas/ est la copie que la porte
  // lit. Un écart entre les deux ferait valider autre chose que ce qui est spécifié.
  it("est identique dans gateway/ et dans specs/", () => {
    const local = readFileSync(join(SCHEMAS_DIR, "inbound.schema.json"), "utf8");
    const frozen = readFileSync(join(SPECS_DIR, "schemas", "inbound.schema.json"), "utf8");
    assert.equal(local, frozen);
  });
});
