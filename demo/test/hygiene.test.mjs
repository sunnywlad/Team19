// Hygiène : la recherche de secrets trouve ce qu'elle doit, et rien d'autre ;
// DEMO_MODE reste vide dans les .env.example.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { checkEnvExamples, scanSecrets } from "../hygiene.mjs";

// Valeurs tirées au hasard à chaque passage : rien de secret n'est écrit ici.
const token = randomBytes(32).toString("base64url");
const key = `0x${randomBytes(32).toString("hex")}`;
const signature = `0x${randomBytes(65).toString("hex")}`;
const requestId = `0x${randomBytes(32).toString("hex")}`;

test("un jeton d'agent, une clé ou une signature complète sont trouvés, sans être recopiés", () => {
  const found = scanSecrets({ "a.log": `GET /x authorization: Bearer ${token}`, "b.log": `clé ${key.slice(2)}`, "c.log": `{"signature":"${signature}"}` }, { "jeton d'agent": [token], "clé de var/demo/": [key] });
  assert.ok(found.includes("a.log : jeton d'agent"));
  assert.ok(found.includes("a.log : en-tête Bearer avec sa valeur"));
  assert.ok(found.includes("b.log : clé de var/demo/"));
  assert.ok(found.includes("c.log : signature complète"));
  for (const line of found) for (const secret of [token, key.slice(2), signature]) assert.ok(!line.includes(secret));
});

test("un jeton inconnu de la démo est relevé par sa forme", () => {
  assert.deepEqual(scanSecrets({ "a.log": `reçu ${randomBytes(32).toString("base64url").replace(/^./, "Z")} fin` }), ["a.log : chaîne de la forme d'un jeton d'agent"]);
});

test("identifiants, empreintes, hachages de transaction et journal ordinaire ne sont pas des secrets", () => {
  const lines = [
    `[relay] {"submitted":1,"rejected":0,"deferred":0,"inDoubt":0,"expired":0}`,
    `request_id ${requestId} tx ${requestId} sha256 ${requestId.slice(2)}`,
    "scène 2 : 401 TOKEN_INVALID, jeton-absent-du-registre",
    "[relay] MODE DÉMO : contrôle du faux coffre sur http://127.0.0.1:8788 (approve, refuse, expire)",
    "Authorization: Bearer <jeton>",
  ].join("\n");
  assert.deepEqual(scanSecrets({ "relay.log": lines }, { "jeton d'agent": [token], "clé de var/demo/": [key] }), []);
});

test(".env.example : DEMO_MODE est listé et reste vide partout", () => {
  const { files, defects } = checkEnvExamples();
  assert.ok(files.includes(".env.example") && files.includes("relay/.env.example"));
  assert.deepEqual(defects, []);
});
