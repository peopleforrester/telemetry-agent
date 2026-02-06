// ABOUTME: Schema module — reads and extends Weaver registry YAML files.
// ABOUTME: Validates namespace prefix rules and produces updated YAML for signals.

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { WeaverGroup } from "./weaver.js";

export interface SchemaData {
  namespace: string;
  groups: WeaverGroup[];
  rawFiles: Map<string, string>;
}

export interface SchemaExtension {
  groupId: string;
  type: "span" | "attribute_group";
  brief: string;
  spanKind?: string;
  attributes: {
    ref?: string;
    id?: string;
    type?: string;
    requirement_level: string;
  }[];
}

export async function readSchema(schemaPath: string): Promise<SchemaData> {
  const rawFiles = new Map<string, string>();
  const groups: WeaverGroup[] = [];
  let namespace = "";

  const yamlFiles = fs
    .readdirSync(schemaPath)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));

  for (const file of yamlFiles) {
    const fullPath = path.join(schemaPath, file);
    const content = fs.readFileSync(fullPath, "utf-8");
    rawFiles.set(file, content);

    const parsed = parseYaml(content);
    if (parsed?.groups) {
      for (const g of parsed.groups) {
        groups.push({
          id: g.id,
          type: g.type,
          brief: g.brief ?? "",
          attributes: (g.attributes ?? []).map(
            (a: Record<string, unknown>) => ({
              id: a.id as string | undefined,
              ref: a.ref as string | undefined,
              type: a.type as string | undefined,
              requirement_level: a.requirement_level as string | undefined,
            })
          ),
        });

        // Derive namespace from first group ID
        if (!namespace && g.id) {
          const parts = g.id.split(".");
          if (parts.length > 1) {
            namespace = parts[0];
          }
        }
      }
    }
  }

  return { namespace, groups, rawFiles };
}

export function extendSchema(
  schema: SchemaData,
  extensions: SchemaExtension[]
): string {
  // Validate namespace prefix
  for (const ext of extensions) {
    const prefix = ext.groupId.split(".")[0];
    if (prefix !== schema.namespace && !ext.groupId.startsWith(`${schema.namespace}.`)) {
      throw new Error(
        `Group ID "${ext.groupId}" does not match namespace "${schema.namespace}". ` +
        `All new IDs must start with the schema namespace prefix.`
      );
    }
  }

  // Build the combined groups list
  const existingGroups = schema.groups.map((g) => ({
    id: g.id,
    type: g.type,
    brief: g.brief,
    attributes: g.attributes.map((a) => {
      const attr: Record<string, unknown> = {};
      if (a.ref) attr.ref = a.ref;
      if (a.id) attr.id = a.id;
      if (a.type) attr.type = a.type;
      if (a.requirement_level) attr.requirement_level = a.requirement_level;
      return attr;
    }),
  }));

  const newGroups = extensions.map((ext) => {
    const group: Record<string, unknown> = {
      id: ext.groupId,
      type: ext.type,
      brief: ext.brief,
    };
    if (ext.spanKind) {
      group.span_kind = ext.spanKind;
    }
    if (ext.attributes.length > 0) {
      group.attributes = ext.attributes.map((a) => {
        const attr: Record<string, unknown> = {};
        if (a.ref) attr.ref = a.ref;
        if (a.id) attr.id = a.id;
        if (a.type) attr.type = a.type;
        attr.requirement_level = a.requirement_level;
        return attr;
      });
    }
    return group;
  });

  const combined = {
    groups: [...existingGroups, ...newGroups],
  };

  return stringifyYaml(combined);
}
