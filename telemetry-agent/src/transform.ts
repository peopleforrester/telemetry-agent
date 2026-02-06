// ABOUTME: Code transformation module — adds OTel imports, tracer, and span wrappers.
// ABOUTME: Uses ts-morph for AST-based manipulation with span insertion and error handling.

import { Project } from "ts-morph";

export interface SpanAttribute {
  key: string;
  valueExpression: string;
}

export interface SpanTransform {
  functionName: string;
  spanName: string;
  attributes: SpanAttribute[];
  variableName: string;
}

export interface TransformPlan {
  serviceName: string;
  spans: SpanTransform[];
}

function createProject(code: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile("transform-target.ts", code);
}

export function addOtelImports(fileContent: string): string {
  if (fileContent.includes("@opentelemetry/api")) {
    return fileContent;
  }

  const sf = createProject(fileContent);
  sf.addImportDeclaration({
    namedImports: ["trace", "SpanStatusCode"],
    moduleSpecifier: "@opentelemetry/api",
  });

  // Move the new import to be sorted with others
  const imports = sf.getImportDeclarations();
  if (imports.length > 1) {
    const otelImport = imports[imports.length - 1];
    otelImport.setOrder(0);
  }

  return sf.getFullText();
}

export function addTracerDeclaration(
  fileContent: string,
  serviceName: string
): string {
  if (fileContent.includes("const tracer")) {
    return fileContent;
  }

  const sf = createProject(fileContent);

  // Find position after last import
  const imports = sf.getImportDeclarations();
  const lastImport = imports[imports.length - 1];

  if (lastImport) {
    const insertPos = lastImport.getEnd();
    sf.insertText(
      insertPos,
      `\n\nconst tracer = trace.getTracer('${serviceName}');`
    );
  }

  return sf.getFullText();
}

export function wrapFunctionWithSpan(
  fileContent: string,
  functionName: string,
  spanName: string,
  attributes: SpanAttribute[],
  variableName: string = "span"
): string {
  const sf = createProject(fileContent);
  const fn = sf.getFunction(functionName);
  if (!fn) return fileContent;

  const body = fn.getBody();
  if (!body) return fileContent;

  const bodyText = body.getText();
  // Strip the outer braces
  const inner = bodyText.slice(1, -1).trim();

  const attrLines = attributes
    .map((a) => `    ${variableName}.setAttribute('${a.key}', ${a.valueExpression});`)
    .join("\n");

  const attrBlock = attrLines ? `\n${attrLines}` : "";

  const newBody = `{
  return tracer.startActiveSpan('${spanName}', async (${variableName}) => {
    try {${attrBlock}
      ${inner}
    } catch (error) {
      ${variableName}.recordException(error as Error);
      ${variableName}.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      ${variableName}.end();
    }
  });
}`;

  fn.setBodyText(newBody.slice(1, -1)); // setBodyText expects inner content

  return sf.getFullText();
}

export function applyTransformations(
  fileContent: string,
  transforms: TransformPlan
): string {
  if (transforms.spans.length === 0) {
    return fileContent;
  }

  let result = fileContent;

  // Add OTel imports
  result = addOtelImports(result);

  // Add tracer declaration
  result = addTracerDeclaration(result, transforms.serviceName);

  // Wrap each function
  for (const span of transforms.spans) {
    result = wrapFunctionWithSpan(
      result,
      span.functionName,
      span.spanName,
      span.attributes,
      span.variableName
    );
  }

  return result;
}
