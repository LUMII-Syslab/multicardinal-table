import { GenericContainer } from "testcontainers";
import type { QueryStoreProvider } from "./QueryStore";

const containerName = "stain/jena-fuseki:5.1.0";
const port = 3030;

async function containerWithTtl(ttl: string) {
  const ttlPath = "/jena-fuseki/store.ttl";
  const cmd = `./fuseki-server --file=${ttlPath} /store`;

  return await new GenericContainer(containerName)
    .withExposedPorts(port)
    .withEntrypoint(["bash"])
    .withCommand(["-c", cmd])
    .withCopyContentToContainer([{ content: ttl, target: ttlPath }])
    .start();
}

export const JenaQueryStoreProvider: QueryStoreProvider = {
  storeFromTtl: async ({ ttl }) => {
    const container = await containerWithTtl(ttl);
    const url = `http://${container.getHost()}:${container.getMappedPort(port)}/store/sparql`;

    return {
      executeQuery: async ({ query }) => {
        const req = new Request(url, {
          method: "POST",
          headers: {
            "Accept": "application/sparql-results+json",
          },
          body: new URLSearchParams({
            query,
          })
        });

        const rawRes = await fetch(req);

        return await rawRes.json();
      },
    };
  },
};
