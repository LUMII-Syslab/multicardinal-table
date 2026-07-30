import type { SparqlTableResult } from "@/sparql_queries";

export interface QueryStoreProvider {
  storeFromTtl: ({}: { ttl: string }) => Promise<QueryStore>,
}

export interface QueryStore {
  executeQuery: ({}: { query: string }) => Promise<SparqlTableResult>,
}
