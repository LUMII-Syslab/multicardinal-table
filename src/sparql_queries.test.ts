import { expect, test, describe } from "vitest";
import {
    formatUniversalPaginatorQuery,
    formatUniversalPaginatorQueryCounter
} from "./sparql_queries";

describe("formatUniversalPaginationQuery", () => {
    test("basic query with one distinct variable", () => {
        const q = `
SELECT * WHERE {
  ?sub ?pred ?obj .
}
`;
        expect(q).toBeValidSparqlQuery();

        const res = formatUniversalPaginatorQuery({
            queryToWrap: q,
            groupLimit: 50,
            groupOffset: 100,
            globalLimit: 1000,
            idVars: ["sub"],
        });

        expect(res).toBeValidSparqlQuery();

        // NOTE: Should have a distinct query involving the ?sub column
        expect(res).toMatch(/SELECT\s+DISTINCT\s+\?sub/);
        // NOTE: Match passed parameters
        expect(res).toMatch(/LIMIT 50/);
        expect(res).toMatch(/OFFSET 100/);
        expect(res).toMatch(/LIMIT 1000/);
    });

    test("basic query with two distinct variables", () => {
        const q = `
SELECT * WHERE {
  ?sub ?pred ?obj .
}
`;
        expect(q).toBeValidSparqlQuery();

        const res = formatUniversalPaginatorQuery({
            queryToWrap: q,
            groupLimit: 20,
            groupOffset: 30,
            globalLimit: 2000,
            idVars: ["sub", "pred"],
        });

        expect(res).toBeValidSparqlQuery();

        // NOTE: Match "DISTINCT ?sub ?pred"
        expect(res).toMatch(/SELECT\s+DISTINCT\s+\?sub\s+\?pred/);
        // NOTE: Match passed parameters
        expect(res).toMatch(/LIMIT 20/);
        expect(res).toMatch(/OFFSET 30/);
        expect(res).toMatch(/LIMIT 2000/);
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

        expect(q).toBeValidSparqlQuery();

        const res = formatUniversalPaginatorQuery({
            queryToWrap: q,
            groupLimit: 20,
            groupOffset: 30,
            globalLimit: 2000,
            idVars: ["Catalog"],
        });

        expect(res).toBeValidSparqlQuery();
    });
});

describe("formatUniversalPaginatorQueryCounter", () => {
    test("basic limitless query", () => {
        const globalRowCountVar = "__global_count";
        const groupedRowCountVar = "__grouped_count";

        const queryToWrap = `SELECT * WHERE { ?sub ?pred ?obj }`;

        expect(queryToWrap).toBeValidSparqlQuery();

        const q =formatUniversalPaginatorQueryCounter({
            globalRowCountVar,
            groupedRowCountVar,
            idVars: ["sub", "pred"],
            queryToWrap,
        });

        expect(q).toBeValidSparqlQuery();

        expect(q).toMatch(`?${globalRowCountVar}`);
        expect(q).toMatch(`?${groupedRowCountVar}`);
        expect(q).toMatch("?sub");
        expect(q).toMatch("?pred");
        expect(q).toMatch("?obj");
    });
    test("basic limited query", () => {
        const globalRowCountVar = "__another_global_count";
        const groupedRowCountVar = "__another_grouped_count";
        const globalLimit = 1000;
        const groupLimit = 20;

        const queryToWrap = `SELECT * WHERE { ?sub ?pred ?obj }`;

        expect(queryToWrap).toBeValidSparqlQuery();

        const q =formatUniversalPaginatorQueryCounter({
            globalRowCountVar,
            groupedRowCountVar,
            idVars: ["sub", "pred"],
            queryToWrap,
            globalLimit,
            groupLimit,
        });

        expect(q).toBeValidSparqlQuery();

        expect(q).toMatch(`?${globalRowCountVar}`);
        expect(q).toMatch(`?${groupedRowCountVar}`);
        expect(q).toMatch("?sub");
        expect(q).toMatch("?pred");
        expect(q).toMatch("?obj");
        expect(q).toMatch(`LIMIT ${globalLimit}`);
        // NOTE: groupLimit doesn't matter in this context
        //expect(q).toMatch(`LIMIT ${groupLimit}`);
    });
    test("query with prefixes", () => {
        const globalRowCountVar = "__another_global_count";
        const groupedRowCountVar = "__another_grouped_count";
        const globalLimit = 1000;
        const groupLimit = 20;

        const queryToWrap = `
    PREFIX dcat: <http://www.w3.org/ns/dcat#>
PREFIX dct: <http://purl.org/dc/terms/>

PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT DISTINCT * WHERE{
        ?Catalog rdf:type dcat:Catalog .
        OPTIONAL{?Catalog dct:title ?title .  }
        OPTIONAL{?Catalog dct:description ?description .  }
} LIMIT 20`;

        expect(queryToWrap).toBeValidSparqlQuery();

        const q = formatUniversalPaginatorQueryCounter({
            globalRowCountVar,
            groupedRowCountVar,
            idVars: ["sub", "pred"],
            queryToWrap,
            globalLimit,
            groupLimit,
        });

        expect(q).toBeValidSparqlQuery();
    });
});
