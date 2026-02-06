// ABOUTME: Library allowlist — maps framework import names to OTel instrumentation packages.
// ABOUTME: Hardcoded lookup table for known frameworks; used before npm registry fallback.

import type { LibraryRequirement } from "./results.js";

const ALLOWLIST = new Map<string, LibraryRequirement>([
  ["http", { package: "@opentelemetry/instrumentation-http", import: "HttpInstrumentation", config: {} }],
  ["https", { package: "@opentelemetry/instrumentation-http", import: "HttpInstrumentation", config: {} }],
  ["express", { package: "@opentelemetry/instrumentation-express", import: "ExpressInstrumentation", config: {} }],
  ["pg", { package: "@opentelemetry/instrumentation-pg", import: "PgInstrumentation", config: {} }],
  ["mysql", { package: "@opentelemetry/instrumentation-mysql", import: "MySQLInstrumentation", config: {} }],
  ["mysql2", { package: "@opentelemetry/instrumentation-mysql2", import: "MySQL2Instrumentation", config: {} }],
  ["mongodb", { package: "@opentelemetry/instrumentation-mongodb", import: "MongoDBInstrumentation", config: {} }],
  ["redis", { package: "@opentelemetry/instrumentation-redis", import: "RedisInstrumentation", config: {} }],
  ["ioredis", { package: "@opentelemetry/instrumentation-ioredis", import: "IORedisInstrumentation", config: {} }],
  ["@grpc/grpc-js", { package: "@opentelemetry/instrumentation-grpc", import: "GrpcInstrumentation", config: {} }],
  ["koa", { package: "@opentelemetry/instrumentation-koa", import: "KoaInstrumentation", config: {} }],
  ["fastify", { package: "@fastify/otel", import: "FastifyOtel", config: {} }],
  ["@nestjs/core", { package: "@opentelemetry/instrumentation-nestjs-core", import: "NestInstrumentation", config: {} }],
  ["mongoose", { package: "@opentelemetry/instrumentation-mongoose", import: "MongooseInstrumentation", config: {} }],
  ["kafkajs", { package: "@opentelemetry/instrumentation-kafkajs", import: "KafkaJsInstrumentation", config: {} }],
  ["pino", { package: "@opentelemetry/instrumentation-pino", import: "PinoInstrumentation", config: {} }],
]);

export function lookupLibrary(importName: string): LibraryRequirement | null {
  return ALLOWLIST.get(importName) ?? null;
}

export function isInAllowlist(importName: string): boolean {
  return ALLOWLIST.has(importName);
}
