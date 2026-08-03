import { expect, test, describe } from "vitest";
import {
  formatPaginatedQuery,
  formatPaginatedCounterQuery,
  tableToMulticardinalRow,
} from "./compact-pagination";
import type { SparqlTableResult } from "./sparql_queries";
import type { MulticardinalRow } from "./multi-cardinal-table-util";

function expectPrefixesToNotBeNested(query: string) {
    const lines = query.split("\n");

    const lineIsPrefixStmt = (line: string) => !!line.match(/\s*PREFIX/);
    const lineIsBlank = (line: string) => !!line.match(/^\s*$/);

    const maxPrefixIndex = ([...lines.entries()])
        .filter(([_, l]) => lineIsPrefixStmt(l))
        .map(([i]) => i)
        .reduce((a, b) => Math.max(a, b));

    expect(lines.slice(0, maxPrefixIndex + 1))
        .toSatisfyAll((line) => lineIsPrefixStmt(line) || lineIsBlank(line));
}



const propNameVar = "__propName";
const propValVar = "__propVal";

describe("formatPaginatedQuery", () => {
  test("basic query with one distinct variable", () => {
    const q = `
SELECT * WHERE {
  ?sub ?pred ?obj .
}
`;
    const res = formatPaginatedQuery({
      queryToWrap: q,
      groupLimit: 50,
      groupOffset: 100,
      globalLimit: 1000,
      idVars: ["sub"],
      propNameVar,
      propValVar,
    });

    expect(res).toBeValidSparqlQuery();

    // NOTE: Should have a distinct query involving the ?sub column
    expect(res).toMatch(/SELECT\s+DISTINCT\s+\?sub/);
    // NOTE: Match passed parameters
    expect(res).toMatch(/LIMIT 50/);
    expect(res).toMatch(/OFFSET 100/);
    expect(res).toMatch(/LIMIT 1000/);
    // NOTE: Those vars should appear
    expect(res).toMatch(`?${propNameVar}`);
    expect(res).toMatch(`?${propValVar}`);
  });

  test("basic query with two distinct variables", () => {
    const q = `
SELECT * WHERE {
  ?sub ?pred ?obj .
}
`;
    const res = formatPaginatedQuery({
      queryToWrap: q,
      groupLimit: 20,
      groupOffset: 30,
      globalLimit: 2000,
      idVars: ["sub", "pred"],
      propNameVar,
      propValVar,
    });

    // NOTE: Match "DISTINCT ?sub ?pred"
    expect(res).toMatch(/SELECT\s+DISTINCT\s+\?sub\s+\?pred/);
    // NOTE: Match passed parameters
    expect(res).toMatch(/LIMIT 20/);
    expect(res).toMatch(/OFFSET 30/);
    expect(res).toMatch(/LIMIT 2000/);
    // NOTE: Those vars should appear
    expect(res).toMatch(`?${propNameVar}`);
    expect(res).toMatch(`?${propValVar}`);
  });

  test("query with prefixes", () => {
    // NOTE: applying weird spacing to check that our function can handle various situations
    const q = `
    PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX dct: <http://purl.org/dc/terms/>

PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT * WHERE{
        ?Catalog rdf:type dcat:Catalog .
        OPTIONAL{?Catalog dct:title ?title .  }
        OPTIONAL{?Catalog dct:description ?description .  }
} LIMIT 20`;

    const res = formatPaginatedQuery({
      queryToWrap: q,
      groupLimit: 20,
      groupOffset: 30,
      globalLimit: 2000,
      idVars: ["Catalog"],
      propNameVar,
      propValVar,
    });

    expect(res).toBeValidSparqlQuery();
    expectPrefixesToNotBeNested(res);
  });

  test("query with prefixes #2", () => {
    const queryToWrap = `PREFIX : <https://dblp.org/rdf/schema#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT * WHERE{
  ?Publication rdf:type :Publication .
  OPTIONAL{?Publication rdfs:label ?label .  }
  OPTIONAL{?Publication :numberOfCreators ?numberOfCreators .  }
  OPTIONAL{?Publication :title ?title .  }
  OPTIONAL{?Publication :yearOfPublication ?yearOfPublication .  }
  OPTIONAL{?Publication :publishedIn ?publishedIn .  }
  OPTIONAL{?Publication :pagination ?pagination .  }
  OPTIONAL{?Publication :publishedInJournal ?publishedInJournal .  }
    }`;

    expect(queryToWrap).toBeValidSparqlQuery();

    const res = formatPaginatedQuery({
      queryToWrap,
      groupLimit: 20,
      groupOffset: 30,
      globalLimit: 2000,
      idVars: ["Publication"],
      propNameVar,
      propValVar,
    });

    expect(res).toBeValidSparqlQuery();
    expectPrefixesToNotBeNested(res);
  });
});


describe("formatPaginatedCounterQuery", () => {
  test("basic limited query", () => {
    const globalRowCountVar = "__another_global_count";
    const groupedRowCountVar = "__another_grouped_count";
    const globalLimit = 1000;

    const queryToWrap = `SELECT * WHERE { ?sub ?pred ?obj }`;
    expect(queryToWrap).toBeValidSparqlQuery();

    const q = formatPaginatedCounterQuery({
      globalRowCountVar,
      groupedRowCountVar,
      idVars: ["sub", "pred"],
      queryToWrap,
      globalLimit,
      propNameVar,
      propValVar,
    });

    expect(q).toBeValidSparqlQuery();
    expect(q).toMatch(`?${globalRowCountVar}`);
    expect(q).toMatch(`?${groupedRowCountVar}`);
    expect(q).toMatch("?sub");
    expect(q).toMatch("?pred");
    expect(q).toMatch("?obj");
    expect(q).toMatch(`LIMIT ${globalLimit}`);
  });

  test("query with prefixes", () => {
    const globalRowCountVar = "__another_global_count";
    const groupedRowCountVar = "__another_grouped_count";
    const globalLimit = 1000;

    const queryToWrap = `
    PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX dct: <http://purl.org/dc/terms/>

PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT * WHERE{
        ?Catalog rdf:type dcat:Catalog .
        OPTIONAL{?Catalog dct:title ?title .  }
        OPTIONAL{?Catalog dct:description ?description .  }
} LIMIT 20`;
    expect(queryToWrap).toBeValidSparqlQuery;

    const q = formatPaginatedCounterQuery({
      propNameVar,
      propValVar,
      globalRowCountVar,
      groupedRowCountVar,
      idVars: ["sub", "pred"],
      queryToWrap,
      globalLimit,
    });

    expect(q).toBeValidSparqlQuery();

    expectPrefixesToNotBeNested(q);
  });
});

describe("tableToMulticardinalRow", () => {
  test("basic example", () => {
    const v = (value: string) => ({ value, type: "literal" });

    const row = (a: string, b: string, c: string, d: string) => ({
      productType: v(a),
      color: v(b),
      [propNameVar]: v(c),
      [propValVar]: v(d),
    })

    const resultingTable: SparqlTableResult = {
      head: { vars: [propNameVar, propValVar, "productType", "color"] },
      results: {
        bindings: [
          row("watch", "blue", "price", "9999"),
          row("watch", "blue", "price", "4999"),
          row("watch", "blue", "buildType", "new"),

          row("watch", "black", "price", "7999"),
          row("watch", "black", "buildType", "new"),

          row("phone", "black", "price", "999"),
          row("phone", "black", "price", "899"),
          row("phone", "black", "buildType", "refurbished"),
        ],
      },
    };

    const rows = tableToMulticardinalRow({ propNameVar, propValVar, resultingTable });

    const idCols = ["productType", "color"];
    const restCols = ["price", "buildType"];

    const expectedRows: MulticardinalRow[] = [
      {
        idCols,
        idValues: { productType: "watch", color: "blue" },
        restCols,
        restValues: { price: ["9999", "4999"], buildType: ["new"] },
      },
      {
        idCols,
        idValues: { productType: "watch", color: "black" },
        restCols,
        restValues: { price: ["7999"], buildType: ["new"] },
      },
      {
        idCols,
        idValues: { productType: "phone", color: "black" },
        restCols,
        restValues: { price: ["999", "899"], buildType: ["refurbished"] },
      },
    ];

    expect(rows).toEqual(expectedRows);
  });
});
