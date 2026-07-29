import type { MulticardinalRow } from "./multi-cardinal-table-util";
import { findVars, splitQueryPreamble } from "./query-util";
import type { SparqlTableResult } from "./sparql_queries";
import { Data, Option, MutableHashMap } from "effect";

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
}): string {
  const { main } = splitQueryPreamble(query);
  const valueVars: string[] = findVars({ query }).filter((it) => !idVars.includes(it));

  function formatUnionClause(valVarName: string) {
    return fmtSubquery([
      fmtSubquery(main),
      `BIND("${valVarName}" AS ?${propNameVar})`,
      `BIND(?${valVarName} as ?${propValVar})`,
    ].join("\n"));
  }

  // NOTE: In this scenario SELECT DISTINCT may have negative performance impact.
  // NOTE: It's possible to omit DISTINCT (or use REDUCED) and filter client-side.
  const valueSelectionSubquery = [
    `SELECT DISTINCT ${fmtVars([...idVars, propNameVar, propValVar])} {`,
    valueVars.map((valueVar) => formatUnionClause(valueVar)).join(" UNION "),
    `FILTER(BOUND(?${propValVar}))`,
    "}",
  ].join("\n");

  return valueSelectionSubquery;
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

  const selection = idVars
    .map((it) => `(?${it} AS ?${varToCandidateVarName(it)})`)
    .join(" ");

  const keyConstraintSubquery = `SELECT DISTINCT ${selection}
WHERE {
${lineAwareIndent(main)}
}
LIMIT ${groupLimit}
OFFSET ${groupOffset}`;

  const res = [
    preamble,
    `SELECT DISTINCT ${fmtVars(selectedVars)} {`,
    fmtSubquery(keyConstraintSubquery),
    fmtSubquery(formatValueSelection({ idVars, propNameVar, propValVar, queryToWrap: query })),
    ...candidateFilters,
    `} LIMIT ${globalLimit}`,
  ].join("\n");

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

  const justIdVars = [
    `SELECT ${fmtVars(idVars)} {`,
    fmtSubquery(formatValueSelection({ idVars, propNameVar, propValVar, queryToWrap })),
    "}",
  ].join("")

  const query = [
    preamble,
    "SELECT",
     `(COUNT(*) AS ?${globalRowCountVar})`,
     `(COUNT(DISTINCT *) AS ?${groupedRowCountVar})`,
    "WHERE {",
    justIdVars,
    `} LIMIT ${globalLimit}`,
  ].join("\n");

  return query;
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
