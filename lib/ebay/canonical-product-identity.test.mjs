import test from "node:test"
import assert from "node:assert/strict"
import { resolveCanonicalProductIdentity } from "./canonical-product-identity.ts"

const base = { authoritativeFactsPackage: { facts: [{ key: "mpn", value: "08300" }, { key: "color", value: "White" }, { key: "netContent", value: "1.5" }] }, resolvedFacts: [{ key: "gtin", value: "036588083005", status: "CORROBORATED" }] }
test("Calypso uses corroborated GTIN when authoritative is absent", () => assert.equal(resolveCanonicalProductIdentity(base).identity.gtin, "036588083005"))
test("leading zero and invalid check digit fail closed", () => { assert.throws(() => resolveCanonicalProductIdentity({ ...base, resolvedFacts: [{ key: "gtin", value: "36588083005", status: "CORROBORATED" }] }), /GTIN/) })
test("contradictory GTIN fails closed", () => assert.throws(() => resolveCanonicalProductIdentity({ authoritativeFactsPackage: { facts: [{ key: "gtin", value: "036588083005" }] }, resolvedFacts: [{ key: "gtin", value: "036588083012", status: "CORROBORATED" }] }), /GTIN/))
