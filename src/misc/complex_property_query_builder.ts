import type { ComplexPropertySelection } from "@/components/complex_property_selector";
import { reorderOptional } from "@/query-util";
import { HashSet, Data, HashMap, Option } from "effect";

// NOTE: technically there are more items that only can appear after the first character (not
// counting ? or $) but I think we can omit them for now.
const sparqlVarNameRanges = [
    ["0".codePointAt(0)!, "9".codePointAt(0)!],
    ["A".codePointAt(0)!, "Z".codePointAt(0)!],
    ["_".codePointAt(0)!, "_".codePointAt(0)!],
    ["a".codePointAt(0)!, "z".codePointAt(0)!],
    [0x00C0, 0x00D6],
    [0x00D8, 0x00F6],
    [0x00F8, 0x02FF],
    [0x0370, 0x037D],
    [0x037F, 0x1FFF],
    [0x200C, 0x200D],
    [0x2070, 0x218F],
    [0x2C00, 0x2FEF],
    [0x3001, 0xD7FF],
    [0xF900, 0xFDCF],
    [0xFDF0, 0xFFFD],
    // NOTE: This range is problematic for endpoints that don't support multi-byte characters
    [0x10000, 0xEFFFF],
] as const;

export const sparqlVarRe: RegExp = (() => {
    const fmtCodePoint = (it: number) => `\\u${it.toString(16).padStart(4, "0")}`;

    const ranges = sparqlVarNameRanges
        .map(([from, to]) => `${fmtCodePoint(from)}-${fmtCodePoint(to)}`);

    return new RegExp(`[?$][${ranges.join("")}]+`, "gu");
})();

const pathSeparatorChar = "__";
const pathItemSegmentSeparatorChar = "_";
const placeholderChar = "_";

function isCharLegalForVarName(ch: string) {
  const i = ch.codePointAt(0);
  if (i === undefined) throw "empty character";
  const res = sparqlVarNameRanges.find(([from, to]) => i >= from && i <= to);
  return !!res;
}

export interface VarInfo {
    /** Final sparql variable name */
    varName: string,
    /** List of URIs that were used to generated the var */
    path: readonly string[],
}

interface ConstraintPayload {
    constraints: string[],
    varInfos: VarInfo[],
}

const uriSplitterRe = /[\/|#]+/;

function sanitizeSparqlVarName(candidateName: string) {
    return candidateName
        .split("")
        .map((ch) => isCharLegalForVarName(ch) ? ch : placeholderChar)
        .join("");
}

function formatVar(path: readonly string[], sliceIndex: number = -1) {
    // NOTE: Since empty name is not allowed, we need something like this
    if (path.length === 0) return "this";
    // NOTE: URI items are usually segmented by slashes and sometimes "#", so we just split assume
    // that the last item is the most accurate identifier
    const candidateName = path
        .map(
            (item) => item
                .split(uriSplitterRe)
                .slice(sliceIndex)
                .join(pathItemSegmentSeparatorChar)
        )
        .join(pathSeparatorChar);
    return sanitizeSparqlVarName(candidateName);
}

function formatCollidingVars(varInfos: VarInfo[]): VarInfo[] {
    const maxI = Math.max(
        ...varInfos.flatMap(
            (item) => item.path.map((pathItem) => pathItem.split(uriSplitterRe).length)
        )
    );

    for (let i = -1; i >= -maxI; i--) {
        const newCandidates = varInfos.map((item) => formatVar(item.path, i));

        // NOTE: No collisions, we can use the new candidates
        if ((new Set(newCandidates)).size === newCandidates.length) {
            return varInfos.map((props, i) => ({
                ...props,
                varName: newCandidates[i],
            }));
        }
    }

    // NOTE: If we fail (should only happen when there are two same paths), just add numbers and
    // call it a day.
    return varInfos.map(({ varName, ...rest }, i) => ({ varName: `${varName}${i}`, ...rest }));
}

function formatVarInfo(path: readonly string[]): VarInfo {
    return {
        path,
        varName: formatVar(path),
    };
}

// NOTE: Made this helper function so that we can elegantly collect object properties.
function collectConstraints(
    varInfoMapping: HashMap.HashMap<readonly string[], VarInfo>,
    pathPrefix: string[],
    { rdfType, dataProps, objectProps }: ComplexPropertySelection,
): ConstraintPayload {
    function wrapOptional(constraint: string): string {
        return `OPTIONAL { ${constraint} }`;
    }

    function getByPath(path: readonly string[]): VarInfo {
        return varInfoMapping.pipe(
            HashMap.get(Data.array(path)),
            Option.getOrThrow,
        );
    }

    const thisVar = getByPath(pathPrefix);

    const dataVars = dataProps.map(({ name }) => {
        const varInfo = getByPath([...pathPrefix, name]);
        const constraint = wrapOptional(`?${thisVar.varName} <${name}> ?${varInfo.varName}`);
        return { varInfo, constraint };
    });

    const objectVars: ConstraintPayload[] = objectProps.map(({ name, selection }) => {
        const varInfo = getByPath([...pathPrefix, name]);
        const constraint = wrapOptional(`?${thisVar.varName} <${name}> ?${varInfo.varName}`);
        const { constraints, varInfos } = collectConstraints(
            varInfoMapping,
            [...pathPrefix, name],
            selection,
        );
        return {
            constraints: [constraint, ...constraints],
            varInfos: [varInfo, ...varInfos],
        };
    })

    const miscConstraints: string[] = [
        // NOTE: rdfType constraint should only be applied if the string is not empty
        ...(rdfType !== "" ?  [`?${thisVar.varName} a <${rdfType}> .`] : []),
    ];

    return {
        constraints: [
            ...dataVars.map((item) => item.constraint),
            ...objectVars.flatMap((item) => item.constraints),
            ...miscConstraints,
        ],
        varInfos: [
            thisVar,
            ...dataVars.map((item) => item.varInfo),
            ...objectVars.flatMap((item) => item.varInfos),
        ],
    };
}

function collectVarNames(
    selection: ComplexPropertySelection,
): HashMap.HashMap<readonly string[], VarInfo> {
    function collectPaths(
        currentSelection: ComplexPropertySelection,
        pathPrefix: string[],
    ): string[][] {
        return [
            pathPrefix, // NOTE: this
            ...currentSelection.dataProps.map((it) => [...pathPrefix, it.name]),
            ...currentSelection.objectProps.flatMap((it) => [
                [...pathPrefix, it.name],
                ...collectPaths(it.selection, [...pathPrefix, it.name]),
            ])
        ];
    }

    function adjustVarNames(currentVarNames: VarInfo[]): VarInfo[] {
        const grouped = Map.groupBy(currentVarNames, (it) => it.varName);
        return ([...grouped.values()]).flatMap((items) => {
            if (items.length <= 1) return items;
            return formatCollidingVars(items);
        });
    }

    function duplicatesExist(currentVarNames: VarInfo[]): boolean {
        return (new Set(currentVarNames.map((it) => it.varName))).size !== currentVarNames.length;
    }

    const possiblyDuplicatedPaths = collectPaths(selection, []);
    let currentVarInfos = HashSet.make(...possiblyDuplicatedPaths.map((path) => Data.array(path)))
        .pipe(HashSet.toValues)
        .map(formatVarInfo);

    while (duplicatesExist(currentVarInfos)) {
        currentVarInfos = adjustVarNames(currentVarInfos);
    }

    return HashMap.make(...currentVarInfos.map((it) => [Data.array(it.path), it] as const));
}

/**
 * Make a query that represents the passed selection.
 */
export function formatQuery(selection: ComplexPropertySelection): {
    query: string,
    varInfos: VarInfo[],
} {
    const collectedVarNames = collectVarNames(selection);

    const {
        constraints,
    } = collectConstraints(collectedVarNames, [], selection);

    const varInfos = collectedVarNames.pipe(HashMap.toValues);

    const indentation = "  ";

    const lines = [
        "SELECT * WHERE {",
        ...constraints.map((line) => `${indentation}${line}`),
        "}",
    ];

    const query = reorderOptional(lines.join("\n"));

    return { query, varInfos };
}
