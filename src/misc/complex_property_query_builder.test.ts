import { expect, test, describe } from "vitest";
import { formatQuery, sparqlVarRe, type VarInfo } from "./complex_property_query_builder";
import type { ComplexPropertySelection } from "@/components/complex_property_selector";
import { Parser } from "@traqula/parser-sparql-1-1";
import { AstTransformer } from '@traqula/rules-sparql-1-1';

function expectExpectedVarsToBeInQuery(
    expectedVarInfos: VarInfo[],
    query: string,
) {
    const expectedVars = expectedVarInfos.map((item) => item.varName);
    // NOTE: find vars and strip leading "?"
    const foundVars = [...new Set(query.match(sparqlVarRe)?.map((s) => s.slice(1)))];
    expect(foundVars).toIncludeAllMembers(expectedVars);
}

/**
 * Assert that bgp (basic graph patterns) appear before optional patterns.
 *
 * This has to be checked because some endpoints throw 500 when bgp are after optional.
 */
function expectCorrectOptionalPosition(query: string) {
    const parser = new Parser();
    const ast = parser.parse(query);
    const transformer = new AstTransformer();

    let visitCount = 0;

    transformer.visitNodeSpecific(ast, {}, {
        pattern: {
            group: {
                visitor: ({ patterns }) => {
                    visitCount++;
                    const bgps = patterns
                        .map((it, i) => [it, i] as const)
                        .filter(([it]) => it.subType === "bgp");
                    const optionals = patterns
                        .map((it, i) => [it, i] as const)
                        .filter(([it]) => it.subType === "optional");

                    // NOTE: if bgps or optionals are missing the order is guaranteed to be correct
                    if (bgps.length === 0 || optionals.length === 0) return;

                    const maxBgpIndex = Math.max(...bgps.map(([_, i]) => i));
                    const minOptionalIndex = Math.min(...optionals.map(([_, i]) => i));

                    expect(maxBgpIndex).toBeLessThan(minOptionalIndex);
                },
            },
        },
    });

    // NOTE: Sanity check, SELECT queries should always be visited at least once
    expect(visitCount).toBeGreaterThan(0);
}

function expectNoDuplicateVarInfo(varInfos: VarInfo[]) {
    expect(varInfos.length).toEqual((new Set(varInfos.map((item) => item.varName))).size);
}

function makeCommonAssertions({
   expectedVarInfos,
    query,
    varInfos
}: {
    varInfos: VarInfo[],
    expectedVarInfos: VarInfo[],
    query: string,
}) {
    expectExpectedVarsToBeInQuery(expectedVarInfos, query);
    expectNoDuplicateVarInfo(varInfos);
    expectCorrectOptionalPosition(query);
}

describe("formatQuery", () => {
    test("basic test", () => {
        const sampleSelection = {
            rdfType: "http://Person",
            dataProps: [{ name: "http://p0" }, { name: "http://p1" }],
            objectProps: [
                {
                    name: "http://relation",
                    selection: {
                        rdfType: "http://Item",
                        dataProps: [{ name: "http://p0" }],
                        objectProps: [
                            {
                                name: "http://anotherRelation",
                                selection: {
                                    rdfType: "http://anotherRelatedType",
                                    dataProps: [
                                        { name: "http://lastDataPropISwear" }
                                    ],
                                    objectProps: [],
                                },
                            }
                        ],
                    },
                },
            ],
        } satisfies ComplexPropertySelection;

        const expectedVarInfos = [
            { varName: "this", path: [] },
            { varName: "p0", path: ["http://p0"] },
            { varName: "p1", path: ["http://p1"] },
            { varName: "relation", path: ["http://relation"] },
            { varName: "relation__p0", path: ["http://relation", "http://p0"] },
            {
                varName: "relation__anotherRelation",
                path: ["http://relation", "http://anotherRelation"],
            },
            {
                varName: "relation__anotherRelation__lastDataPropISwear",
                path: ["http://relation", "http://anotherRelation", "http://lastDataPropISwear"],
            },
        ];

        const { query, varInfos } = formatQuery(sampleSelection);

        // NOTE: asserting one constraint that should appear
        expect(query).toMatch(`?this <${sampleSelection.dataProps[0]?.name}> ?p0`);

        makeCommonAssertions({ query, expectedVarInfos, varInfos });
    });
    test("more realistic test", () => {
        const sampleSelection = {
            "rdfType": "http://data.nobelprize.org/terms/Laureate",
            "dataProps": [
                {
                    "name": "http://xmlns.com/foaf/0.1/name"
                },
                {
                    "name": "http://www.w3.org/2000/01/rdf-schema#label"
                },
                {
                    "name": "http://dbpedia.org/property/dateOfBirth"
                },
                {
                    "name": "http://xmlns.com/foaf/0.1/birthday"
                },
                {
                    "name": "http://xmlns.com/foaf/0.1/givenName"
                }
            ],
            "objectProps": [
                {
                    "name": "http://dbpedia.org/ontology/birthPlace",
                    "selection": {
                        "rdfType": "",
                        "dataProps": [],
                        "objectProps": []
                    }
                },
                {
                    "name": "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
                    "selection": {
                        "rdfType": "",
                        "dataProps": [],
                        "objectProps": []
                    }
                },
                {
                    "name": "http://dbpedia.org/ontology/deathPlace",
                    "selection": {
                        "rdfType": "",
                        "dataProps": [],
                        "objectProps": []
                    }
                }
            ]
        } satisfies ComplexPropertySelection;

        const expectedVarInfos: VarInfo[] = [
            { varName: "this", path: [] },
            { varName: "name", path: ["http://xmlns.com/foaf/0.1/name"] },
            { varName: "label", path: ["http://www.w3.org/2000/01/rdf-schema#label"] },
            { varName: "dateOfBirth", path: ["http://dbpedia.org/property/dateOfBirth"] },
            { varName: "birthday", path: ["http://xmlns.com/foaf/0.1/birthday"] },
            { varName: "givenName", path: ["http://xmlns.com/foaf/0.1/givenName"] },
            { varName: "birthPlace", path: ["http://dbpedia.org/ontology/birthPlace"] },
            { varName: "type", path: ["http://www.w3.org/1999/02/22-rdf-syntax-ns#type"] },
            { varName: "deathPlace", path: ["http://dbpedia.org/ontology/deathPlace"] },
        ];

        const { query, varInfos } = formatQuery(sampleSelection);

        // NOTE: asserting some constraints that should appear
        expect(query).toMatch(`?this <http://dbpedia.org/property/dateOfBirth> ?dateOfBirth`);
        expect(query).toMatch(`?this <http://dbpedia.org/ontology/birthPlace> ?birthPlace`);

        expect(varInfos).toIncludeAllMembers(expectedVarInfos);

        makeCommonAssertions({ query, expectedVarInfos, varInfos });
    });
    test("potential varName collisions", () => {
        const sampleSelection = {
            "rdfType": "http://ldf.fi/schema/yoma/ReferencedPerson",
            "dataProps": [
                {
                    "name": "http://www.w3.org/2004/02/skos/core#prefLabel"
                },
                {
                    "name": "http://www.w3.org/2008/05/skos-xl#prefLabel"
                },
            ],
            "objectProps": []
        } satisfies ComplexPropertySelection;

        const expectedVarInfos: VarInfo[] = [
            { varName: "this", path: [] },
            { varName: "core_prefLabel", path: ["http://www.w3.org/2004/02/skos/core#prefLabel"] },
            { varName: "skos_xl_prefLabel", path: ["http://www.w3.org/2008/05/skos-xl#prefLabel"] },
        ];

        const { query, varInfos } = formatQuery(sampleSelection);

        makeCommonAssertions({ query, expectedVarInfos, varInfos });
    });
    test("prefixed var is handled correctly", () => {
        const sampleSelection = {
            "rdfType": "http://ldf.fi/schema/yoma/ReferencedPerson",
            "dataProps": [
                {
                    "name": "http://www.w3.org/2004/02/skos/core#prefLabel"
                },
                {
                    "name": "http://www.w3.org/2008/05/skos-xl#prefLabel"
                },
                {
                    "name": "http://www.w3.org/2004/02/skos/core#prefLabel123"
                },
            ],
            "objectProps": [],
        } satisfies ComplexPropertySelection;

        const { query, varInfos } = formatQuery(sampleSelection);

        const expectedVarInfos: VarInfo[] = [
            { varName: "this", path: [] },
            { varName: "core_prefLabel", path: ["http://www.w3.org/2004/02/skos/core#prefLabel"] },
            { varName: "skos_xl_prefLabel", path: ["http://www.w3.org/2008/05/skos-xl#prefLabel"] },
            { varName: "prefLabel123", path: ["http://www.w3.org/2004/02/skos/core#prefLabel123"] },
        ];

        makeCommonAssertions({ query, expectedVarInfos, varInfos });
    });
});
