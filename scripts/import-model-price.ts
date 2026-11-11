import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const argumentsByName = parseArguments(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const provider = required("provider");
const model = required("model");
const version = required("version");
const currency = (argumentsByName.get("currency") ?? "USD").toUpperCase();
const inputPriceMicrosPerMillion = nonnegativeBigInt("input-micros-per-million");
const outputPriceMicrosPerMillion = nonnegativeBigInt("output-micros-per-million");
const cachedInputValue = argumentsByName.get("cached-input-micros-per-million");
const cachedInputPriceMicrosPerMillion =
  cachedInputValue === undefined
    ? null
    : parseNonnegativeBigInt(cachedInputValue, "cached-input-micros-per-million");
const effectiveFrom = requiredDate("effective-from");
const effectiveTo = optionalDate("effective-to");
const sourceUrl = requiredUrl("source-url");
const supersedesVersion = argumentsByName.get("supersedes-version")?.trim();

if (!/^[A-Z]{3}$/u.test(currency)) throw new Error("--currency must be a three-letter code.");
if (effectiveTo && effectiveTo <= effectiveFrom) {
  throw new Error("--effective-to must be later than --effective-from.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const created = await prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`pricing:${provider}:${model}`}, 0))`;
    let supersededId: string | undefined;
    if (supersedesVersion) {
      const superseded = await transaction.aiModelPrice.findUnique({
        where: { version: supersedesVersion }
      });
      if (
        !superseded ||
        superseded.provider !== provider ||
        superseded.model !== model ||
        superseded.effectiveFrom >= effectiveFrom ||
        (superseded.effectiveTo !== null && superseded.effectiveTo < effectiveFrom)
      ) {
        throw new Error(
          "--supersedes-version must identify the active earlier price for this model."
        );
      }
      supersededId = superseded.id;
      await transaction.aiModelPrice.update({
        where: { id: superseded.id },
        data: { effectiveTo: effectiveFrom }
      });
    }
    const overlap = await transaction.aiModelPrice.findFirst({
      where: {
        provider,
        model,
        ...(supersededId ? { id: { not: supersededId } } : {}),
        effectiveFrom: { lt: effectiveTo ?? new Date("9999-12-31T23:59:59.999Z") },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }]
      },
      select: { version: true }
    });
    if (overlap) {
      throw new Error(`The effective window overlaps existing price version ${overlap.version}.`);
    }
    return transaction.aiModelPrice.create({
      data: {
        provider,
        model,
        version,
        currency,
        inputPriceMicrosPerMillion,
        outputPriceMicrosPerMillion,
        cachedInputPriceMicrosPerMillion,
        effectiveFrom,
        effectiveTo,
        sourceUrl
      },
      select: { id: true, version: true }
    });
  });
  console.info(`Imported immutable model price ${created.version} (${created.id}).`);
} finally {
  await prisma.$disconnect();
}

function parseArguments(values: readonly string[]) {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Arguments must use --name value pairs.");
    }
    result.set(flag.slice(2), value);
  }
  return result;
}

function required(name: string) {
  const value = argumentsByName.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required.`);
  return value;
}

function nonnegativeBigInt(name: string) {
  return parseNonnegativeBigInt(required(name), name);
}

function parseNonnegativeBigInt(value: string, name: string) {
  if (!/^\d{1,19}$/u.test(value)) throw new Error(`--${name} must be a non-negative integer.`);
  const parsed = BigInt(value);
  if (parsed > 9_223_372_036_854_775_807n) throw new Error(`--${name} exceeds BIGINT range.`);
  return parsed;
}

function requiredDate(name: string) {
  const value = new Date(required(name));
  if (!Number.isFinite(value.getTime())) throw new Error(`--${name} must be an ISO timestamp.`);
  return value;
}

function optionalDate(name: string) {
  const value = argumentsByName.get(name);
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`--${name} must be an ISO timestamp.`);
  return parsed;
}

function requiredUrl(name: string) {
  const value = required(name);
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error(`--${name} must use HTTPS.`);
  return parsed.toString();
}
