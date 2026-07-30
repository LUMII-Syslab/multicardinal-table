import type { QueryStoreProvider } from "./QueryStore";
import { Store, parse } from "oxigraph";

export const OxigraphQueryStoreProvider: QueryStoreProvider = {
  storeFromTtl: async ({ ttl }) => {
    const items = parse(ttl, { format: "text/turtle" });
    const store = new Store(items);

    return {
      executeQuery: async ({ query }) => {
        const res = store.query(query, { results_format: "application/sparql-results+json" });

        // NOTE: With json results_format specified, we shouldn't be able to get anything else.
        if (typeof res !== "string") throw "unexpected";

        // NOTE: Maybe validate after parsing?
        return JSON.parse(res);
      }
    };
  },
}
