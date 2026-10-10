// Serveur de fixtures : npm run dev:fixtures [-- <scénario>]
//   <scénario> : 1 à 8, 6a, 6b, ou « scene » (défaut) qui déroule 3, puis 4, puis 1.
// Lié à 127.0.0.1, GET uniquement, comme l'API du relais qu'il imite.
import { createServer } from "node:http";
import { handleFixtureRequest } from "./handler.ts";
import { buildWorld, isScenarioName, scenarioLength, SCENARIOS } from "./scenarios.ts";

const HOST = "127.0.0.1";
const name = process.argv[2] ?? "scene";
if (!isScenarioName(name)) {
  console.error(`scénario inconnu. Choix : ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(64);
}
const rawPort = process.env.FIXTURES_PORT ?? "";
const port = /^\d{1,5}$/.test(rawPort) ? Number(rawPort) : 8788;
// Le script démarre 2 s après le serveur : le temps d'ouvrir le dashboard.
const t0 = Date.now() + 2000;

const server = createServer((req, res) => {
  // Même garde que le relais : pas de nom d'hôte étranger (rebinding DNS).
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  const reply =
    host !== HOST && host !== "localhost"
      ? { status: 403, body: { error: "forbidden_host" } }
      : handleFixtureRequest(buildWorld(name, t0, Date.now()), req.method ?? "GET", req.url ?? "/");
  res.writeHead(reply.status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...("headers" in reply ? reply.headers : {}),
  });
  res.end(JSON.stringify(reply.body));
});

server.listen(port, HOST, () => {
  console.error(`[fixtures] scénario « ${name} » sur http://${HOST}:${port} (script de ${Math.ceil(scenarioLength(name) / 1000)} s, relancer pour rejouer)`);
});
