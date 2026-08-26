import { expect, test, describe } from 'vitest'
import {
  rewriteQueryWithPrefixes,
  findVars,
  isQueryValid,
  reorderOptional,
} from './query-util';

describe("rewriteQueryWithPrefixes", () => {
  test("no prefixes initially", () => {
    const query = `SELECT * WHERE {
   OPTIONAL { ?this <http://xmlns.com/foaf/0.1/name> ?name }
  OPTIONAL { ?this <http://www.w3.org/2000/01/rdf-schema#label> ?label }
  OPTIONAL { ?this <http://dbpedia.org/property/dateOfBirth> ?dateOfBirth }
  OPTIONAL { ?this <http://xmlns.com/foaf/0.1/birthday> ?birthday }
  OPTIONAL { ?this <http://xmlns.com/foaf/0.1/givenName> ?givenName }
  OPTIONAL { ?this <http://dbpedia.org/ontology/birthPlace> ?birthPlace }
  OPTIONAL { ?this <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?type }
  OPTIONAL { ?this <http://dbpedia.org/ontology/deathPlace> ?deathPlace }
  ?this a <http://data.nobelprize.org/terms/Laureate> .
}`;

    const newQuery = rewriteQueryWithPrefixes({
      query,
      prefixInfo: [
        { prefix: "", uri: "http://data.nobelprize.org/terms/" },
        { prefix: "foaf", uri: "http://xmlns.com/foaf/0.1/" },
        { prefix: "rdfs", uri: "http://www.w3.org/2000/01/rdf-schema#" },
        { prefix: "dbp", uri: "http://dbpedia.org/property/" },
        { prefix: "dbo", uri: "http://dbpedia.org/ontology/" },
        { prefix: "rdf", uri: "http://www.w3.org/1999/02/22-rdf-syntax-ns#" },
      ],
    });

    const prefixBoundary = newQuery.indexOf("SELECT");
    if (prefixBoundary === -1) throw "Could not find SELECT!";

    const prefixArea = newQuery.slice(0, prefixBoundary);
    const restArea = newQuery.slice(prefixBoundary);

    // NOTE: should not match uris outside prefix zone
    expect(restArea).not.toMatch(/<.*>/);

    const prefixedNames = [
      "foaf:name",
      "rdfs:label",
      ":Laureate",
      "foaf:givenName",
      "dbp:dateOfBirth",
    ];

    prefixedNames.forEach((it) => expect(restArea).toMatch(it));

    const prefixDefs = [
      "PREFIX : <http://data.nobelprize.org/terms/>",
      "PREFIX foaf: <http://xmlns.com/foaf/0.1/>",
      "PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>",
      "PREFIX dbp: <http://dbpedia.org/property/>",
      "PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>",
      "PREFIX dbo: <http://dbpedia.org/ontology/>",
    ]
    // NOTE: match prefix definitions
    prefixDefs.forEach((it) => expect(prefixArea).toMatch(it));
  });

  test("partially prefixed", () => {
    const query = `PREFIX : <http://data.nobelprize.org/terms/>
PREFIX dbo: <http://dbpedia.org/ontology/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT DISTINCT * WHERE{
  ?Award rdf:type dbo:Award .
  OPTIONAL{?Award rdfs:label ?label .  }
  OPTIONAL{?Award :motivation ?motivation .  }
  OPTIONAL{?Award <http://data.nobelprize.org/terms/year> ?year .  }
  OPTIONAL{?Award <http://data.nobelprize.org/terms/share> ?share .  }
  OPTIONAL{?Award :sortOrder ?sortOrder .  }
  OPTIONAL{?Award :categoryOrder ?categoryOrder .  }
}`;

    const newQuery = rewriteQueryWithPrefixes({ query, prefixInfo: [
      { prefix: "", uri: "http://data.nobelprize.org/terms/" }
    ] });

    const prefixBoundary = newQuery.indexOf("SELECT");
    if (prefixBoundary === -1) throw "Could not find SELECT!";

    const prefixArea = newQuery.slice(0, prefixBoundary);
    const restArea = newQuery.slice(prefixBoundary);

    // NOTE: should not match uris outside prefix zone
    expect(restArea).not.toMatch(/<.*>/);

    const matches = [...prefixArea.matchAll(/http:\/\/data.nobelprize.org\/terms\//g)];

    // NOTE: prefix should not be redefined if it already exists
    expect(matches).toHaveLength(1);
  })
});

describe("findVars", () => {
  test("basic test", () => {
    const query = `SELECT * WHERE {
    OPTIONAL { ?this <http://xmlns.com/foaf/0.1/name> ?name }
    OPTIONAL { ?this <http://www.w3.org/2000/01/rdf-schema#label> ?label }
    OPTIONAL { ?this <http://dbpedia.org/property/dateOfBirth> ?dateOfBirth }
    OPTIONAL { ?this <http://xmlns.com/foaf/0.1/birthday> ?birthday }
    OPTIONAL { ?this <http://xmlns.com/foaf/0.1/givenName> ?givenName }
    OPTIONAL { ?this <http://dbpedia.org/ontology/birthPlace> ?birthPlace }
    OPTIONAL { ?this <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> ?type }
    OPTIONAL { ?this <http://dbpedia.org/ontology/deathPlace> ?deathPlace }
    ?this a <http://data.nobelprize.org/terms/Laureate> .
    }`;

    const vars = findVars({ query });

    expect(vars).toIncludeAllMembers([
      "this",
      "name",
      "label",
      "dateOfBirth",
      "birthday",
      "givenName",
      "birthPlace",
      "type",
      "deathPlace",
    ]);
  });
});

describe("isQueryValid", () => {
  test("valid query", () => {
    const query = "SELECT * WHERE { ?s ?p ?o }";
    expect(isQueryValid(query)).toBeTrue();
  });

  test("invalid query", () => {
    const query = "SELECT * WHERE ?s ?p ?o";
    expect(isQueryValid(query)).toBeFalse();
  });
});

describe("reorderOptional", () => {
  test("basic test", () => {
    const query = `PREFIX kbv: <https://id.kb.se/vocab/>
PREFIX : <https://id.kb.se/marc/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT * WHERE {
  OPTIONAL {
    ?this kbv:label ?label .
  }
  OPTIONAL {
    ?this :fieldref ?fieldref .
  }
  ?this rdf:type kbv:Note .
  OPTIONAL {
    ?this :headingOrSubdivisionTerm ?headingOrSubdivisionTerm .
  }
  OPTIONAL {
    ?this kbv:scopeNote ?scopeNote .
  }
  OPTIONAL {
    ?this kbv:hasNote ?hasNote .
  }
  FILTER(?label != "H3299A")
} LIMIT 100`;

    const expectedQuery = `PREFIX kbv: <https://id.kb.se/vocab/>
PREFIX : <https://id.kb.se/marc/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
SELECT * WHERE {
  ?this rdf:type kbv:Note .
  OPTIONAL { ?this kbv:label ?label . }
  OPTIONAL { ?this :fieldref ?fieldref . }
  OPTIONAL { ?this :headingOrSubdivisionTerm ?headingOrSubdivisionTerm . }
  OPTIONAL { ?this kbv:scopeNote ?scopeNote . }
  OPTIONAL { ?this kbv:hasNote ?hasNote . }
  FILTER ( ( ?label != "H3299A" ) )
}
LIMIT 100`;

    expect(query).toBeValidSparqlQuery();
    expect(expectedQuery).toBeValidSparqlQuery();

    const newQuery = reorderOptional(query);

    expect(newQuery).toEqual(expectedQuery);
  });
});
