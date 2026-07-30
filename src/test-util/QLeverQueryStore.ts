import type { QueryStoreProvider } from "./QueryStore";
import { GenericContainer } from "testcontainers";

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

export const QLeverQueryStoreProvider: QueryStoreProvider = {
  storeFromTtl: async ({ ttl }) => {
    const container = await containerWithTtl(ttl);
    const url = `http://${container.getHost()}:${container.getMappedPort(storePort)}`;

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

        // TODO: validate?
        return fetch(req).then((it) => it.json());
      },
    };
  },
};
