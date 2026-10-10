// Ce que l'API de lecture garantit à ses lecteurs (dashboard, service de
// réponse) : since_id strict, et une clôture de cas 1 lisible comme un
// événement Decision à part, sous le request_id d'origine.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndexedDecision } from "../src/indexer.ts";
import { CLOSURES, pendingCase, summary, withApi } from "./cases.ts";
import { makeStack } from "./world.ts";

test("GET /decisions?since_id=N : seulement les décisions d'id strictement supérieur à N", async () => {
  const s = makeStack();
  await s.play("1");
  await s.play("4");
  await s.relay.tick();
  await pendingCase(s);
  await s.index();
  await withApi(s, async (get) => {
    const all = (await get("/decisions")).body as IndexedDecision[];
    assert.equal(all.length, 3);
    const ids = all.map((d) => d.id);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b), "ordre d'indexation");
    for (const [i, n] of ids.entries()) {
      const after = (await get(`/decisions?since_id=${n}`)).body as IndexedDecision[];
      assert.deepEqual(after.map((d) => d.id), ids.slice(i + 1), `since_id=${n}`);
      assert.ok(after.every((d) => d.id > n));
    }
    assert.deepEqual((await get(`/decisions?since_id=${ids[0]! - 1}`)).body, all, "N − 1 rend la décision N");
    assert.equal((await get("/decisions?since_id=-1")).status, 400);
  });
  s.close();
});

for (const closure of CLOSURES) {
  test(`clôture ${closure.name} : un événement Decision distinct, qui garde le request_id d'origine`, async () => {
    const s = makeStack();
    const { id } = await pendingCase(s);
    closure.close(s, id);
    await s.index();
    const decisions = s.indexer.decisions({ requestId: id });
    assert.deepEqual(decisions.map(summary), [[1, "ABOVE_THRESHOLD"], [closure.decision, closure.name]]);
    const [opening, closing] = decisions as [IndexedDecision, IndexedDecision];
    assert.equal(closing.request_id, id);
    assert.deepEqual([closing.agent_id, closing.client_id, closing.action, closing.ref_id], [opening.agent_id, opening.client_id, opening.action, opening.ref_id]);
    assert.ok(closing.id > opening.id, "deux lignes d'index");
    assert.notEqual(closing.tx_hash, opening.tx_hash, "deux transactions");
    assert.equal(s.indexer.events({ name: "Paid" }).length, closure.name === "APPROVED" ? 1 : 0);
    await withApi(s, async (get) => {
      const listed = (await get(`/decisions?request_id=${id}`)).body as IndexedDecision[];
      assert.deepEqual(listed.map((d) => [d.request_id, d.reason_name]), [[id, "ABOVE_THRESHOLD"], [id, closure.name]]);
      // Un lecteur qui suit avec since_id reçoit la clôture seule, rattachable par request_id.
      const next = (await get(`/decisions?since_id=${opening.id}`)).body as IndexedDecision[];
      assert.deepEqual(next.map((d) => [d.request_id, d.reason_name]), [[id, closure.name]]);
    });
    s.close();
  });
}
