import { expect, test, describe } from "vitest";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import type { SparqlTableResult } from "./sparql_queries";

const qleverContainerName = "adfreiburg/qlever";
const configJsonFile = "store.settings.json"
const storeName = "store";
const storePort = 7019;
const ttlFile = "store.ttl";

async function containerWithTtl(ttl: string) {
  const cmd0 = `cat ${ttlFile} | qlever-index -i ${storeName} -s ${configJsonFile} --vocabulary-type on-disk-compressed -F ttl -f -`;

  const cmd1 = `qlever-server -i ${storeName} -j 8 -p ${storePort} -m 5G -c 2G -e 1G -k 200 -s 30s`;

  const cmd = [cmd0, cmd1].join(" && ");

  return await new GenericContainer(qleverContainerName)
    .withExposedPorts(storePort)
    .withUser("root") // NOTE: To avoid file writing issues due insufficient permission
    .withWorkingDir("/qlever/app")
    .withEntrypoint(["bash"])
    .withCommand(["-c", cmd])
    .withCopyContentToContainer([
      { content: "{}", target: `/qlever/app/${configJsonFile}` },
      { content: ttl, target: `/qlever/app/${ttlFile}` },
    ])
    .start();
}

async function executeQuery(
  container: StartedTestContainer,
  query: string,
): Promise<SparqlTableResult> {
  const url = `http://${container.getHost()}:${container.getMappedPort(storePort)}`;

  const req = new Request(url, {
    method: "POST",
    headers: {
      "Accept": "application/sparql-results+json",
    },
    body: new URLSearchParams({
      query,
    })
  });

  // TODO: validate?
  return fetch(req).then((it) => it.json());
}

describe("QLever", () => {
  test("basic test", async () => {
    const ttl = `@base <http://example.com/vocabulary/> .
    @prefix : <http://example.com/vocabulary/> .

    <tx0>
    :TransactionRegion "Europe";
    :Amount 1000 .

    <tx1>
    :TransactionRegion "Africa";
    :Amount 200 .

    <tx2>
    :TransactionRegion "Asia";
    :Amount 300 .

    <tx3>
    :TransactionRegion "North America";
    :Amount 400 .

    <tx4>
    :TransactionRegion "Africa";
    :Amount 500 .

    <tx5>
    :TransactionRegion "Africa";
    :Amount 700 .

    <tx6>
    :TransactionRegion "North America";
    :Amount 200 .

    <tx7>
    :TransactionRegion "Asia";
    :Amount 100 .
`;

    const container = await containerWithTtl(ttl);
    const query = "SELECT * WHERE { ?s ?p ?o } LIMIT 100";

    const res = await executeQuery(container, query);
    expect(res.results.bindings).toHaveLength(16);
  });
});
