// ABOUTME: npm registry client — searches for OTel instrumentation packages by framework name.
// ABOUTME: Uses native fetch (Node 18+) with multi-strategy search and import name inference.

import type { LibraryRequirement } from "./results.js";

export interface NpmSearchResult {
  packageName: string;
  version: string;
  description: string;
}

export interface PackageInfo {
  name: string;
  version: string;
  description: string;
  deprecated: boolean;
}

const NPM_REGISTRY = "https://registry.npmjs.org";
const NPM_SEARCH = "https://registry.npmjs.org/-/v1/search";

export function buildSearchUrls(frameworkName: string): string[] {
  return [
    `${NPM_REGISTRY}/@opentelemetry/instrumentation-${frameworkName}`,
    `${NPM_REGISTRY}/@${frameworkName}/otel`,
    `${NPM_SEARCH}?text=opentelemetry+instrumentation+${frameworkName}&size=5`,
  ];
}

export async function searchOtelLibrary(
  frameworkName: string
): Promise<NpmSearchResult | null> {
  // Strategy 1: Direct package lookup
  const directPkg = `@opentelemetry/instrumentation-${frameworkName}`;
  const info = await getPackageInfo(directPkg);
  if (info && !info.deprecated) {
    return {
      packageName: info.name,
      version: info.version,
      description: info.description,
    };
  }

  // Strategy 2: Framework-maintained package
  const fwPkg = `@${frameworkName}/otel`;
  const fwInfo = await getPackageInfo(fwPkg);
  if (fwInfo && !fwInfo.deprecated) {
    return {
      packageName: fwInfo.name,
      version: fwInfo.version,
      description: fwInfo.description,
    };
  }

  // Strategy 3: General search
  try {
    const searchUrl = `${NPM_SEARCH}?text=opentelemetry+instrumentation+${frameworkName}&size=5`;
    const response = await fetch(searchUrl);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      objects: Array<{
        package: { name: string; version: string; description: string };
      }>;
    };

    const match = data.objects.find(
      (o) =>
        o.package.name.includes("opentelemetry") &&
        o.package.name.includes(frameworkName)
    );

    if (match) {
      return {
        packageName: match.package.name,
        version: match.package.version,
        description: match.package.description,
      };
    }
  } catch {
    // Search failed — return null
  }

  return null;
}

export async function getPackageInfo(
  packageName: string
): Promise<PackageInfo | null> {
  try {
    const response = await fetch(`${NPM_REGISTRY}/${packageName}`);
    if (!response.ok) return null;

    const data = (await response.json()) as {
      name: string;
      "dist-tags": { latest: string };
      description?: string;
      versions?: Record<string, { deprecated?: string }>;
    };

    const latest = data["dist-tags"]?.latest;
    const deprecated = !!(
      latest &&
      data.versions?.[latest]?.deprecated
    );

    return {
      name: data.name,
      version: latest ?? "0.0.0",
      description: data.description ?? "",
      deprecated,
    };
  } catch {
    return null;
  }
}

export function toLibraryRequirement(
  searchResult: NpmSearchResult
): LibraryRequirement {
  return {
    package: searchResult.packageName,
    import: inferImportName(searchResult.packageName),
    config: {},
  };
}

function inferImportName(packageName: string): string {
  // @opentelemetry/instrumentation-pg -> PgInstrumentation
  const instrMatch = packageName.match(
    /@opentelemetry\/instrumentation-(.+)/
  );
  if (instrMatch) {
    const name = instrMatch[1];
    return toPascalCase(name) + "Instrumentation";
  }

  // @fastify/otel -> FastifyOtel
  const scopedMatch = packageName.match(/@(.+)\/(.+)/);
  if (scopedMatch) {
    return toPascalCase(scopedMatch[1]) + toPascalCase(scopedMatch[2]);
  }

  return toPascalCase(packageName);
}

function toPascalCase(str: string): string {
  return str
    .split(/[-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
