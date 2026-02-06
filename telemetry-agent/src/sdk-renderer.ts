// ABOUTME: SDK init file renderer — deterministically adds instrumentation libraries.
// ABOUTME: Parses existing SDK file, adds imports and instrumentations array entries.

import type { LibraryRequirement } from "./results.js";

export function renderSdkInitFile(
  existingContent: string,
  libraries: LibraryRequirement[]
): string {
  if (libraries.length === 0) {
    return existingContent;
  }

  // Filter out libraries already imported in the file
  const newLibs = libraries.filter(
    (lib) => !existingContent.includes(lib.import)
  );

  if (newLibs.length === 0) {
    return existingContent;
  }

  // Sort new libraries alphabetically by import name for determinism
  const sorted = [...newLibs].sort((a, b) => a.import.localeCompare(b.import));

  let result = existingContent;

  // Add import statements after the last existing import
  const importLines = sorted.map(
    (lib) => `import { ${lib.import} } from '${lib.package}';`
  );

  const lastImportIdx = findLastImportIndex(result);
  if (lastImportIdx !== -1) {
    const insertPos = result.indexOf("\n", lastImportIdx) + 1;
    result =
      result.slice(0, insertPos) +
      importLines.join("\n") +
      "\n" +
      result.slice(insertPos);
  }

  // Add to instrumentations array
  const instrumentationEntries = sorted.map((lib) => `    new ${lib.import}(),`);
  const instrumentationsMatch = result.match(/instrumentations:\s*\[/);
  if (instrumentationsMatch && instrumentationsMatch.index !== undefined) {
    const bracketPos =
      instrumentationsMatch.index + instrumentationsMatch[0].length;
    const afterBracket = result.slice(bracketPos);
    // Check if there's content already in the array
    const closingBracket = afterBracket.indexOf("]");
    const arrayContent = afterBracket.slice(0, closingBracket).trim();

    if (arrayContent === "") {
      // Empty array — insert entries
      result =
        result.slice(0, bracketPos) +
        "\n" +
        instrumentationEntries.join("\n") +
        "\n  " +
        result.slice(bracketPos + closingBracket);
    } else {
      // Non-empty array — append entries before closing bracket
      const absClosing = bracketPos + closingBracket;
      result =
        result.slice(0, absClosing) +
        "\n" +
        instrumentationEntries.join("\n") +
        "\n  " +
        result.slice(absClosing);
    }
  }

  return result;
}

function findLastImportIndex(content: string): number {
  let lastIdx = -1;
  const importRegex = /^import\s.+from\s+['"].+['"]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    lastIdx = match.index;
  }
  return lastIdx;
}
