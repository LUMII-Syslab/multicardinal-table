import { expect, test, describe } from "vitest";
import type { QueryStoreProvider } from "./test-util/QueryStore";
import {
  formatPaginatedQuery,
  formatPaginatedCounterQuery,
  tableToMulticardinalRow,
  tableToCountPayload,
} from "./compact-pagination";
import type { MulticardinalRow } from "./multi-cardinal-table-util";
import type { SparqlTableResult } from "./sparql_queries";
import { OxigraphQueryStoreProvider } from "./test-util/OxigraphQueryStore";
import { QLeverQueryStoreProvider } from "./test-util/QLeverQueryStore";

function makeMulticardinalRowSorter(keys: string[]) {
  function singleCompare(a: MulticardinalRow, b: MulticardinalRow, key: string): number {
    const v0 = a.idValues[key];
    const v1 = b.idValues[key];

    if (v0 === v1) return 0;
    if (v0 === null) return -1;
    if (v1 === null) return 1;

    return v0.localeCompare(v1);
  }

  function compareRecursive(
    a: MulticardinalRow,
    b: MulticardinalRow,
    [currentKey, ...restKeys]: string[],
  ): number {
    if (currentKey === undefined) return 0;
    const res = singleCompare(a, b, currentKey);
    return (res === 0) ? compareRecursive(a, b, restKeys) : res;
  }

  return (a: MulticardinalRow, b: MulticardinalRow) => compareRecursive(a, b, keys);
}

function expectEquivalentRows({
  actualRows,
  expectedRows,
  idCols,
}: {
  actualRows: MulticardinalRow[],
  expectedRows: MulticardinalRow[],
  idCols: string[],
}) {
  // NOTE: Make a normalized representation so that `.toEqual` actually works and it's easier
  // to catch issues.
  function normalizeRow(row: MulticardinalRow): MulticardinalRow {
    return {
      idCols: row.idCols.toSorted(),
      idValues: row.idValues,
      restCols: row.restCols.toSorted(),
      restValues: Object.fromEntries(
        Object.entries(row.restValues)
          .map(([k, v]) => [k, v.toSorted()] as const satisfies unknown[])
      ),
    }
  }

  const sorter = makeMulticardinalRowSorter(idCols);

  const a = actualRows.toSorted(sorter).map(normalizeRow);
  const b = expectedRows.toSorted(sorter).map(normalizeRow);
  expect(a).toEqual(b);
}

// NOTE: As long as limit is not reached (in both counter and result query) count payload's
// globalCount should always match the row count that paginated result query gives.
function expectTableCountToMatchCountPayload({
  resultingTable,
  expectedCountPayload,
}: {
  resultingTable: SparqlTableResult,
  expectedCountPayload: { globalCount: number, groupedCount: number },
}) {
  expect(resultingTable.results.bindings.length).toEqual(expectedCountPayload.globalCount);
}

const propNameVar = "__propName";
const propValVar = "__propVal";

function testIntegration({
  name,
  queryStoreProvider,
}: {
  name: string,
  queryStoreProvider: QueryStoreProvider,
}) {
  describe(name, async () => {
    describe("basic test", async () => {
      const ttl = `
    @base <https://example.com/resource/>.
    @prefix voc: <https://example.com/vocabulary/> .
    <watch/1>
      voc:productType voc:Watch;
      voc:color "blue";
      voc:price "9999";
      voc:buildType "new" .

    <watch/2>
      voc:productType voc:Watch;
      voc:color "blue";
      voc:notes "this is a budget-friendly option" ;
      voc:price "4999";
      voc:buildType "new" .

    <watch/3>
      voc:productType voc:Watch;
      voc:color "black";
      voc:price "7999";
      voc:buildType "new" .

    <rice-cooker>
      voc:notes "this is for internal use only";
      voc:color "gray" .

    <phone/1>
      voc:productType voc:Phone;
      voc:color "black";
      voc:price "999";
      voc:buildType "refurbished" .

    <phone/1>
      voc:productType voc:Phone;
      voc:color "black";
      voc:price "899";
      voc:buildType "refurbished" .
`;
      const store = await queryStoreProvider.storeFromTtl({ ttl });

      // NOTE: Ordering results so that it's easier to assert the results
      const queryToWrap = `PREFIX voc: <https://example.com/vocabulary/>
    SELECT ?productType ?color ?buildType ?price WHERE {
      ?this voc:productType ?productType .
      ?this voc:color ?color .
      ?this voc:buildType ?buildType .
      ?this voc:price ?price .
    } ORDER BY ?productType ?color ?buildType ?price`;

      const idCols = ["productType", "color"];
      const restCols = ["price", "buildType"];

      const expectedCountPayload = { groupedCount: 3, globalCount: 8 };

      test("sanity check", () => {
        expect(queryToWrap).toBeValidSparqlQuery();
      });

      test("row retrieval", async () => {
        const newQuery = formatPaginatedQuery({
          globalLimit: 10000,
          groupLimit: 100,
          groupOffset: 0,
          idVars: idCols,
          propNameVar,
          propValVar,
          queryToWrap,
        });

        const resultingTable = await store.executeQuery({ query: newQuery });

        expectTableCountToMatchCountPayload({ resultingTable, expectedCountPayload });

        const actualRows = tableToMulticardinalRow({ resultingTable, propNameVar, propValVar });

        const expectedRows: MulticardinalRow[] = [
          {
            idCols,
            idValues: { productType: "https://example.com/vocabulary/Phone", color: "black" },
            restCols,
            restValues: { price: ["899", "999"], buildType: ["refurbished"] },
          },
          {
            idCols,
            idValues: { productType: "https://example.com/vocabulary/Watch", color: "black" },
            restCols,
            restValues: { price: ["7999"], buildType: ["new"] },
          },
          {
            idCols,
            idValues: { productType: "https://example.com/vocabulary/Watch", color: "blue" },
            restCols,
            restValues: { price: ["4999", "9999"], buildType: ["new"] },
          },
        ];

        expectEquivalentRows({
          actualRows,
          expectedRows,
          idCols,
        });
      });

      test("counting", async () => {
        const globalRowCountVar = "__global_count";
        const groupedRowCountVar = "__grouped_count";

        const counterQuery = formatPaginatedCounterQuery({
          queryToWrap,
          globalLimit: 10_000,
          globalRowCountVar,
          groupedRowCountVar,
          idVars: idCols,
          propNameVar,
          propValVar,
        });

        expect(counterQuery).toBeValidSparqlQuery();

        const resultingTable = await store.executeQuery({ query: counterQuery });
        const countPayload = tableToCountPayload({
          resultingTable,
          globalRowCountVar,
          groupedRowCountVar,
        });

        expect(countPayload).toEqual(expectedCountPayload);
      });
    });

    describe("keys may be unbound", async () => {
      // NOTE: The example showcases a previously-encountered edge case where unbound key values
      // previously caused issues.
      // NOTE: This example is taken from Academy Sampo https://ldf.fi/yoma/sparql using this
      // construct query:
      /**
        PREFIX y: <http://ldf.fi/schema/yoma/>
        PREFIX schema: <http://schema.org/>
        PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        CONSTRUCT {?s ?p ?o} WHERE {
          ?s rdf:type y:StudentNation .
          ?s ?p ?o.
          FILTER(?p IN (skos:prefLabel, y:comment))
        }
       */
      const ttl = `@base <http://ldf.fi/yoma/nations/> .
    @prefix y: <http://ldf.fi/schema/yoma/> .
    @prefix skos: <http://www.w3.org/2004/02/skos/core#> .
    @prefix voc: <https://example.com/vocabulary/> .

<sn29> y:comment "Aineistossa mainittu ruotsalainen osakunta"@fi .
<sn29> skos:prefLabel "Uppsalan Länsigötanmaalainen osakunta"@fi .
<sn23> y:comment "Aineistossa mainittu ruotsalainen osakunta"@fi .
<sn23> skos:prefLabel "Uppsalan Västmanlantilainen osakunta"@fi .
<sn24> y:comment "Aineistossa mainittu ruotsalainen osakunta"@fi .
<sn24> skos:prefLabel "Uppsalan Smålandilainen osakunta"@fi .
<sn6> skos:prefLabel "Itägötanmaalainen osakunta"@fi .
<sn30> y:comment "Aineistossa mainittu ruotsalainen osakunta"@fi .
<sn30> skos:prefLabel "Lundin Itägötanmaalainen osakunta"@fi .
<sn26> y:comment "Aineistossa mainittu ruotsalainen osakunta"@fi .
<sn26> skos:prefLabel "Uppsalan Pohjalainen osakunta"@fi .
<sn25> y:comment "Aineistossa mainittu ruotsalainen osakunta"@fi .
<sn25> skos:prefLabel "Lundin Smålandilainen osakunta"@fi .
<sn15> skos:prefLabel "Satakunda nation"@sv .
<sn15> skos:prefLabel "Satakuntalainen osakunta"@fi .
<sn13> skos:prefLabel "Sveagotiska nationen"@sv .
<sn13> skos:prefLabel "Ruotsalainen osakunta"@fi .
<sn2> skos:prefLabel "Borealiska nationen"@sv .
<sn2> skos:prefLabel "Boreaalinen osakunta"@fi .
<sn17> skos:prefLabel "Smålands nation"@sv .
<sn17> skos:prefLabel "Smålandilainen osakunta"@fi .
<sn19> skos:prefLabel "Åbo nation"@sv .
<sn19> skos:prefLabel "Turkulainen osakunta"@fi .
<sn5> skos:prefLabel "Tavastehus nation"@sv .
<sn5> skos:prefLabel "Hämäläinen osakunta"@fi .
<sn21> skos:prefLabel "Viborgska nationen"@sv .
<sn21> skos:prefLabel "Viipurilainen osakunta"@fi .
<sn16> skos:prefLabel "Savokarelska avdelningen 1833–52"@sv .
<sn16> skos:prefLabel "Savokarjalainen osakunta 1833–52"@fi .
<sn20> skos:prefLabel "Nylands nation"@sv .
<sn20> skos:prefLabel "Uusmaalainen osakunta"@fi .
<sn7> skos:prefLabel "Västfinska nationen"@sv .
<sn7> skos:prefLabel "Länsisuomalainen osakunta"@fi .
<sn11> skos:prefLabel "Österbottniska nationen"@sv .
<sn11> skos:prefLabel "Pohjalainen osakunta"@fi .
<sn28> y:comment "Aineistossa mainittu ruotsalainen osakunta"@fi .
<sn28> skos:prefLabel "Uppsalan Västmanland-Dala osakunta"@fi .
<sn12> skos:prefLabel "Nordösterbottniska avdelningen"@sv .
<sn12> skos:prefLabel "Pohjoispohjalainen osakunta"@fi .
<sn27> y:comment "Aineistossa mainittu ruotsalainen osakunta"@fi .
<sn27> skos:prefLabel "Uppsalan Suomalainen osakunta"@fi .
<sn1> skos:prefLabel "Austraalinen osakunta"@fi .
<sn14> skos:prefLabel "Sveagotiska nationen 1798–"@sv .
<sn14> skos:prefLabel "Ruotsalainen (yhd.) osakunta vuodesta 1798"@fi .
<sn3> skos:prefLabel "Sydösterbottniska avdelningen"@sv .
<sn3> skos:prefLabel "Eteläpohjalainen osakunta"@fi .`

      const queryToWrap = `PREFIX y: <http://ldf.fi/schema/yoma/>
PREFIX schema: <http://schema.org/>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT * WHERE{
  OPTIONAL{?StudentNation skos:prefLabel ?prefLabel .  }
  OPTIONAL{?StudentNation y:comment ?comment .  }
} ORDER BY ?comment ?StudentNation ?prefLabel`
      const store = await queryStoreProvider.storeFromTtl({ ttl });
      const idCols = ["comment"];
      const restCols = ["StudentNation", "prefLabel"];

      const expectedCountPayload = { groupedCount: 2, globalCount: 62 };

      test("sanity check", () => {
        expect(queryToWrap).toBeValidSparqlQuery();
      });

      test("row retrieval", async () => {
        const newQuery = formatPaginatedQuery({
          globalLimit: 10000,
          groupLimit: 100,
          groupOffset: 0,
          idVars: idCols,
          propNameVar,
          propValVar,
          queryToWrap,
        });

        const resultingTable = await store.executeQuery({ query: newQuery });

        expectTableCountToMatchCountPayload({ expectedCountPayload, resultingTable });

        const actualRows = tableToMulticardinalRow({ resultingTable, propNameVar, propValVar });

        const expectedRows: MulticardinalRow[] = [
          {
            idCols,
            idValues: { comment: null },
            restCols,
            restValues: {
              StudentNation: [
                'http://ldf.fi/yoma/nations/sn1',
                'http://ldf.fi/yoma/nations/sn11',
                'http://ldf.fi/yoma/nations/sn12',
                'http://ldf.fi/yoma/nations/sn13',
                'http://ldf.fi/yoma/nations/sn14',
                'http://ldf.fi/yoma/nations/sn15',
                'http://ldf.fi/yoma/nations/sn16',
                'http://ldf.fi/yoma/nations/sn17',
                'http://ldf.fi/yoma/nations/sn19',
                'http://ldf.fi/yoma/nations/sn2',
                'http://ldf.fi/yoma/nations/sn20',
                'http://ldf.fi/yoma/nations/sn21',
                'http://ldf.fi/yoma/nations/sn3',
                'http://ldf.fi/yoma/nations/sn5',
                'http://ldf.fi/yoma/nations/sn6',
                'http://ldf.fi/yoma/nations/sn7',
              ],
              prefLabel: [
                'Austraalinen osakunta',
                'Boreaalinen osakunta',
                'Borealiska nationen',
                'Eteläpohjalainen osakunta',
                'Hämäläinen osakunta',
                'Itägötanmaalainen osakunta',
                'Länsisuomalainen osakunta',
                'Nordösterbottniska avdelningen',
                'Nylands nation',
                'Pohjalainen osakunta',
                'Pohjoispohjalainen osakunta',
                'Ruotsalainen (yhd.) osakunta vuodesta 1798',
                'Ruotsalainen osakunta',
                'Satakunda nation',
                'Satakuntalainen osakunta',
                'Savokarelska avdelningen 1833–52',
                'Savokarjalainen osakunta 1833–52',
                'Smålandilainen osakunta',
                'Smålands nation',
                'Sveagotiska nationen',
                'Sveagotiska nationen 1798–',
                'Sydösterbottniska avdelningen',
                'Tavastehus nation',
                'Turkulainen osakunta',
                'Uusmaalainen osakunta',
                'Viborgska nationen',
                'Viipurilainen osakunta',
                'Västfinska nationen',
                'Åbo nation',
                'Österbottniska nationen'
              ]
              ,
            },
          },
          {
            idCols,
            idValues: { comment: "Aineistossa mainittu ruotsalainen osakunta" },
            restCols,
            restValues: {
              StudentNation: [
                'http://ldf.fi/yoma/nations/sn23',
                'http://ldf.fi/yoma/nations/sn24',
                'http://ldf.fi/yoma/nations/sn25',
                'http://ldf.fi/yoma/nations/sn26',
                'http://ldf.fi/yoma/nations/sn27',
                'http://ldf.fi/yoma/nations/sn28',
                'http://ldf.fi/yoma/nations/sn29',
                'http://ldf.fi/yoma/nations/sn30',
              ],
              prefLabel: [
                'Lundin Itägötanmaalainen osakunta',
                'Lundin Smålandilainen osakunta',
                'Uppsalan Länsigötanmaalainen osakunta',
                'Uppsalan Pohjalainen osakunta',
                'Uppsalan Smålandilainen osakunta',
                'Uppsalan Suomalainen osakunta',
                'Uppsalan Västmanland-Dala osakunta',
                'Uppsalan Västmanlantilainen osakunta'
              ],
            },
          },
        ];

        expectEquivalentRows({
          actualRows,
          expectedRows,
          idCols,
        });
      });

      test("counting", async () => {
        const globalRowCountVar = "__global_count";
        const groupedRowCountVar = "__grouped_count";

        const counterQuery = formatPaginatedCounterQuery({
          queryToWrap,
          globalLimit: 10_000,
          globalRowCountVar,
          groupedRowCountVar,
          idVars: idCols,
          propNameVar,
          propValVar,
        });

        expect(counterQuery).toBeValidSparqlQuery();

        const resultingTable = await store.executeQuery({ query: counterQuery });
        const countPayload = tableToCountPayload({
          resultingTable,
          globalRowCountVar,
          groupedRowCountVar,
        });

        expect(countPayload).toEqual(expectedCountPayload);
      });
    });

    // NOTE: What are we testing?
    // - GROUP BY
    // - ORDER BY
    // - paginated querying (where query result is smaller than the dataset)
    // - working with calculated values (?TotalAmount)
    // - ensuring that globalLimit is applied to the final result (not the result set that is matched
    //   by `queryToWrap`)
    describe("Grouping, ordering and pagination", async () => {
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
`

      const queryToWrap = `PREFIX : <http://example.com/vocabulary/>
    SELECT ?TransactionRegion (SUM(?Amount) AS ?TotalAmount) WHERE{
      ?this :TransactionRegion ?TransactionRegion .
      ?this :Amount ?Amount .
    } GROUP BY ?TransactionRegion ORDER BY DESC(?TotalAmount)`;
      const store = await queryStoreProvider.storeFromTtl({ ttl });
      const idCols = ["TransactionRegion"];
      const restCols = ["TotalAmount"];

      const expectedCountPayload = { groupedCount: 4, globalCount: 4 };

      test("sanity check", () => {
        expect(queryToWrap).toBeValidSparqlQuery();
      });

      test("row retrieval", async () => {
        const newQuery = formatPaginatedQuery({
          globalLimit: 2,
          groupLimit: 2,
          groupOffset: 0,
          idVars: idCols,
          propNameVar,
          propValVar,
          queryToWrap,
        });

        const resultingTable = await store.executeQuery({ query: newQuery });

        // NOTE: This query doesn't fetch all items, expectedCountPayload is different
        expectTableCountToMatchCountPayload({
          expectedCountPayload: { groupedCount: 2, globalCount: 2 },
          resultingTable,
        });

        const actualRows = tableToMulticardinalRow({ resultingTable, propNameVar, propValVar });

        const expectedRows: MulticardinalRow[] = [
          {
            idCols,
            idValues: { TransactionRegion: "Africa" },
            restCols,
            restValues: { TotalAmount: ["1400"] },
          },
          {
            idCols,
            idValues: { TransactionRegion: "Europe" },
            restCols,
            restValues: { TotalAmount: ["1000"] },
          },
        ];

        expectEquivalentRows({
          actualRows,
          expectedRows,
          idCols,
        });
      });

      test("counting", async () => {
        const globalRowCountVar = "__global_count";
        const groupedRowCountVar = "__grouped_count";

        const counterQuery = formatPaginatedCounterQuery({
          queryToWrap,
          globalLimit: 10_000,
          globalRowCountVar,
          groupedRowCountVar,
          idVars: idCols,
          propNameVar,
          propValVar,
        });

        expect(counterQuery).toBeValidSparqlQuery();

        const resultingTable = await store.executeQuery({ query: counterQuery });
        const countPayload = tableToCountPayload({
          resultingTable,
          globalRowCountVar,
          groupedRowCountVar,
        });

        expect(countPayload).toEqual(expectedCountPayload);
      });
    });
  });
}

testIntegration({ name: "Oxigraph", queryStoreProvider: OxigraphQueryStoreProvider });
testIntegration({ name: "QLever", queryStoreProvider: QLeverQueryStoreProvider });
