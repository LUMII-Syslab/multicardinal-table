import type { MulticardinalRow } from "./multi-cardinal-table-util";
import { findVars, splitQueryPreamble } from "./query-util";
import type { SparqlTableResult } from "./sparql_queries";
import { Data, Option, MutableHashMap } from "effect";
import { Parser } from '@traqula/parser-sparql-1-1';
import { type SolutionModifierOrder } from '@traqula/rules-sparql-1-1';
import { Generator } from '@traqula/generator-sparql-1-1';

const indentation = "  ";
const indent = (line: string) => `${indentation}${line}`;
const lineAwareIndent = (src: string) => src.split("\n").map(indent).join("\n");
const fmtVars = (vars: string[]) => vars.map((it) => `?${it}`).join(" ");
const fmtSubquery = (subquery: string) => lineAwareIndent(["{", subquery, "}"].join("\n"));

function formatValueSelection({
  queryToWrap: query,
  propNameVar,
  propValVar,
  idVars,
}: {
  queryToWrap: string,
  propNameVar: string,
  propValVar: string,
  idVars: string[],
}): string[] {
  const { main } = splitQueryPreamble(query);
  const valueVars: string[] = findVars({ query }).filter((it) => !idVars.includes(it));

  function formatUnionClause(valVarName: string) {
    return fmtSubquery([
      fmtSubquery(main),
      `BIND("${valVarName}" AS ?${propNameVar})`,
      `BIND(?${valVarName} as ?${propValVar})`,
      // NOTE: Filtering within BIND clause seems to be more performant than adding a constraint
      // outside the unionized query.
      `FILTER(BOUND(?${propValVar}))`,
    ].join("\n"));
  }

  return [
    valueVars.map((valueVar) => formatUnionClause(valueVar)).join(" UNION "),
  ];
}


function getOrderModifier(query: string): SolutionModifierOrder | undefined {
  const parser = new Parser();
  const ast = parser.parse(query);
  if (!(ast.type === "query" && ast.subType === "select")) return undefined;
  return ast.solutionModifiers.order;
}

function injectOrderBy({
  queryToWrap,
  newQuery,
}: {
  queryToWrap: string,
  newQuery: string,
}): string {
  const orderModifier = getOrderModifier(queryToWrap);
  // NOTE: Nothing to inject and thus we can return the query as is
  if (!orderModifier) return newQuery;

  const parser = new Parser();
  const generator = new Generator();

  const ast = parser.parse(newQuery);

  if (!(ast.type === "query" && ast.subType === "select")) {
    throw new Error("Expected SELECT query, got something else!")
  }

  const newAst: typeof ast = {
    ...ast,
    solutionModifiers: {
      ...ast.solutionModifiers,
      order: orderModifier,
    },
  };

  return generator.generate(newAst);
}

export function formatPaginatedQuery({
  queryToWrap: query,
  idVars,
  groupLimit,
  globalLimit,
  groupOffset,
  propNameVar,
  propValVar,
}: {
  queryToWrap: string,
  idVars: string[],
  groupLimit: number,
  groupOffset: number,
  globalLimit: number,
  propNameVar: string,
  propValVar: string,
}): string {
  const { preamble, main } = splitQueryPreamble(query);

  // NOTE: Candidates are key column value sets that are retrieved during pagination.
  const varToCandidateVarName = (varName: string) => `__candidate_${varName}`;

  const selectedVars = [...idVars, propNameVar, propValVar];

  // NOTE: Checking for equality is not enough -- BOUND() checks are required to allow unbound
  // variables to be used as keys.
  const candidateFilters = idVars.map((k) => {
    const newK = varToCandidateVarName(k);
    return `FILTER( (?${k} = ?${newK}) || (!BOUND(?${k}) && !BOUND(?${newK})))`;
  });

  function getKeyConstraintSubquery() {
    const selection = idVars
      .map((it) => `(?${it} AS ?${varToCandidateVarName(it)})`)
      .join(" ");

    const initialConstraint = `SELECT DISTINCT ${selection}
WHERE {
${lineAwareIndent(main)}
}
LIMIT ${groupLimit}
OFFSET ${groupOffset}`;

    const orderedWithPrefix = injectOrderBy({
      queryToWrap: query,
      // NOTE: We need to inject preamble so that parser can recognize prefixes
      newQuery: preamble.concat(initialConstraint),
    });

    // NOTE: And then remove prefixes so that we can use this as subquery
    return splitQueryPreamble(orderedWithPrefix).main;
  }

  const resWithoutOrder = [
    preamble,
    `SELECT DISTINCT ${fmtVars(selectedVars)} {`,
    fmtSubquery(getKeyConstraintSubquery()),
    ...formatValueSelection({ idVars, propNameVar, propValVar, queryToWrap: query }),
    ...candidateFilters,
    `} LIMIT ${globalLimit}`,
  ].join("\n");

  // NOTE: Preserve the result order in display
  const res = injectOrderBy({ queryToWrap: query, newQuery: resWithoutOrder });

  return res;
}

export function formatPaginatedCounterQuery({
  queryToWrap,
  idVars,
  globalLimit,
  propNameVar,
  propValVar,
  globalRowCountVar,
  groupedRowCountVar,
}: {
  queryToWrap: string,
  idVars: string[],
  globalLimit: number,
  propNameVar: string,
  propValVar: string,
  globalRowCountVar: string,
  groupedRowCountVar: string,
}) {
  const { preamble } = splitQueryPreamble(queryToWrap);

  const valueConstraints = formatValueSelection({
    idVars, propNameVar, propValVar, queryToWrap,
  });

  // NOTE: Initially there used to be a more elegant solution -- first select rows and then only
  // keep the keys. COUNT(*) would correspond to global count and COUNT(DISTINCT *) would correspond
  // to grouped count. Unfortunately QLever has a bug where COUNT(DISTINCT *) returns 1 when using
  // subqueries. Thus a less elegant solution without `COUNT(DISTINCT *)` is used.
  // NOTE: COUNT(DISTINCT *) issue can be seen in https://github.com/ad-freiburg/qlever/issues/3158

  const compactRowSelection = [
    // NOTE: `valueConstraints` is projecting old variables and thus we need to be explicit about
    // the variables we are selecting for correct counting.
    `SELECT DISTINCT ${fmtVars([...idVars, propNameVar, propValVar])} WHERE {`,
    ...valueConstraints,
    `} LIMIT ${globalLimit}`,
  ].join("\n");

  const perKeyCountVar = `__perKeyCount`;

  const formatSelectBind = (valueExpression: string, varName: string) => {
    return `(${valueExpression} AS ?${varName})`;
  }

  const keyToCountSelection = [
    `SELECT ${fmtVars(idVars)} (COUNT(*) AS ?${perKeyCountVar}) WHERE {`,
    compactRowSelection,
    `} GROUP BY ${fmtVars(idVars)}`
  ].join("\n");

  const finalSelections = [
    formatSelectBind(`SUM(?${perKeyCountVar})`, globalRowCountVar),
    formatSelectBind(`COUNT(?${perKeyCountVar})`, groupedRowCountVar),
  ].join(" ");

  const finalQuery = [
    preamble,
    `SELECT ${finalSelections} WHERE {`,
    keyToCountSelection,
    `}`,
  ].join("\n");

  return finalQuery;
}

export function tableToMulticardinalRow({
  propNameVar,
  propValVar,
  resultingTable,
}: {
  resultingTable: SparqlTableResult,
  propNameVar: string,
  propValVar: string,
}): MulticardinalRow[] {
  const vars = resultingTable.head.vars;
  if (!vars.includes(propNameVar)) throw new Error(`Could not find ${propNameVar}`);
  if (!vars.includes(propValVar)) throw new Error(`Could not find ${propValVar}`);

  const idCols = vars.filter((it) => it !== propNameVar && it !== propValVar);

  type BindingItem = SparqlTableResult["results"]["bindings"][number]

  const collectingMap = MutableHashMap.fromIterable<readonly string[], BindingItem[]>([]);

  resultingTable.results.bindings.forEach((it) => {
    const mapKey = Data.array(idCols.map((idCol) => {
      // NOTE: Typescript not strict enough, merging "undefined" so that we get proper type hints.
      const maybeObj = it[idCol] as typeof it[string] | undefined;
      return maybeObj?.value ?? null;
    }));
    collectingMap.pipe(
      MutableHashMap.modifyAt(mapKey, (items) => {
        const current = Option.getOrElse(items, () => []);
        return Option.some([...current, it]);
      })
    );
  });

  const res: MulticardinalRow[] = collectingMap
    .pipe(MutableHashMap.keys)
    .map((k) => {
      const items = collectingMap.pipe(MutableHashMap.get(k), Option.getOrThrow);
      const propToVal = items.map((it) => [it[propNameVar].value, it[propValVar].value] as const);

      const propMap = new Map<string, string[]>();
      propToVal.forEach(([prop, val]) => propMap.set(prop, [...propMap.get(prop) ?? [], val]));

      return {
        idCols,
        idValues: Object.fromEntries(idCols.map((col, i) => [col, k[i]] as const)),
        restCols: [...propMap.keys()],
        restValues: Object.fromEntries(propMap),
      };
    });

  return res;
}

interface CountPayload {
  globalCount: number,
  groupedCount: number,
}

export function tableToCountPayload({
  resultingTable,
  globalRowCountVar,
  groupedRowCountVar,
}: {
  resultingTable: SparqlTableResult,
  globalRowCountVar: string,
  groupedRowCountVar: string,
}): CountPayload {
  const firstRow = resultingTable.results.bindings[0];
  if (!firstRow) throw new Error("No rows!");

  const maybeGlobalCount = firstRow[globalRowCountVar];
  if (!maybeGlobalCount) throw new Error("global count does not exist!");

  const globalCount = Number(maybeGlobalCount.value);

  const maybeGroupedCount = firstRow[groupedRowCountVar];
  if (!maybeGroupedCount) throw new Error("grouped count does not exist!");

  const groupedCount = Number(maybeGroupedCount.value);
  return { globalCount, groupedCount };
}
