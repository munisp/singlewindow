/**
 * imoCompendium.test.ts — WP-3 IMO Compendium wire-conformance unit tests.
 * Pure (no DB): golden round-trip per form, fail-closed export rejections,
 * fail-closed import rejections, vendored-mapping structural drift checks.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  exportDeclarationToImo,
  importImoToDeclaration,
  ImoConformanceError,
  loadFormMapping,
  type ImoExportInput,
} from "./_core/imoCompendium";
import { canonicalizeJcs } from "./_core/pcsEnvelope";
import { MSW_FORM_TYPES } from "./_core/mswEnvelope";

const FIXTURE_DIR = path.join(__dirname, "_core", "fixtures", "mswImo");
const MAPPING_DIR = path.join(__dirname, "data", "imoMapping", "v1");
const FORMS = ["fal1", "fal2", "fal3", "fal4", "fal5", "fal6", "fal7", "mdoh"] as const;

function digestOf(payload: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalizeJcs(payload), "utf8").digest("hex")}`;
}

function fixtureInput(form: string): ImoExportInput {
  const f = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${form}.json`), "utf8"));
  return {
    formType: f.formType, declarationId: f.declarationId, visitId: f.visitId, version: f.version,
    formPayloadDigestSha256: digestOf(f.formPayload), formPayload: f.formPayload,
    sender: f.sender, messageId: f.messageId, issuedAt: f.issuedAt,
  };
}

describe("vendored mapping tables", () => {
  it("load for every form and stay structurally valid (drift detection)", () => {
    for (const formType of MSW_FORM_TYPES) {
      const mapping = loadFormMapping(formType);
      expect(mapping.form).toBe(formType);
      expect(mapping.mappingVersion).toBe("1.0");
      expect(mapping.fields.length).toBeGreaterThan(5);
      const raw = JSON.parse(readFileSync(path.join(MAPPING_DIR, `${formType.toLowerCase()}.json`), "utf8"));
      expect(raw.imoMessage).toMatch(/^IMOCompendium\//);
    }
  });

  it("coverage: every form has >=14 mapped fields and an honest extension registry", () => {
    const registry = JSON.parse(readFileSync(path.join(MAPPING_DIR, "extension-registry.json"), "utf8"));
    expect(registry.extensions.length).toBeGreaterThanOrEqual(9);
    for (const formType of MSW_FORM_TYPES) {
      const mapping = loadFormMapping(formType);
      const mapped = mapping.fields.reduce((n, f) => n + 1 + (f.itemFields?.length ?? 0), 0);
      expect(mapped).toBeGreaterThanOrEqual(14);
    }
  });
});

describe("golden round-trip (export → import lossless)", () => {
  for (const form of FORMS) {
    it(`${form.toUpperCase()}: export matches frozen fixture and round-trips losslessly`, () => {
      const input = fixtureInput(form);
      const exported = exportDeclarationToImo(input);
      const expected = JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${form}.expected.json`), "utf8"));
      expect(canonicalizeJcs(exported)).toBe(canonicalizeJcs(expected));
      // Digest-bound: source carries the declaration version digest.
      expect(exported.source?.formPayloadDigestSha256).toBe(input.formPayloadDigestSha256);

      const imported = importImoToDeclaration(exported, input.issuedAt);
      expect(canonicalizeJcs(imported.formPayload)).toBe(canonicalizeJcs(input.formPayload));
      expect(imported.provenance.direction).toBe("IMPORT");
      expect(imported.provenance.foreignSender).toBe(input.sender);
      expect(imported.provenance.sourceMessageId).toBe(input.messageId);
      const personal = ["fal4", "fal5", "fal6", "mdoh"].includes(form);
      expect(imported.containsPersonalData).toBe(personal);
    });
  }
});

describe("fail-closed export rejections", () => {
  it("rejects unmapped platform fields (never silently dropped)", () => {
    const input = fixtureInput("fal1");
    const p = { ...input.formPayload, internalOnlyField: "x" };
    expect(() => exportDeclarationToImo({ ...input, formPayload: p, formPayloadDigestSha256: digestOf(p) }))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_EXPORT_UNMAPPED_ELEMENT" }) as never);
  });

  it("rejects missing mandatory IMO elements", () => {
    const input = fixtureInput("fal1");
    const p = { ...input.formPayload } as Record<string, unknown>;
    delete p.vesselImoNumber;
    expect(() => exportDeclarationToImo({ ...input, formPayload: p, formPayloadDigestSha256: digestOf(p) }))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_EXPORT_MISSING_MANDATORY" }) as never);
  });

  it("rejects type/pattern violations", () => {
    const input = fixtureInput("fal1");
    const p = { ...input.formPayload, vesselImoNumber: "IMO9074729" };
    expect(() => exportDeclarationToImo({ ...input, formPayload: p, formPayloadDigestSha256: digestOf(p) }))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_EXPORT_TYPE_VIOLATION" }) as never);
  });

  it("rejects digest mismatch (no borrowed-digest exports)", () => {
    const input = fixtureInput("fal1");
    expect(() => exportDeclarationToImo({ ...input, formPayloadDigestSha256: `sha256:${"0".repeat(64)}` }))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_EXPORT_DIGEST_MISMATCH" }) as never);
  });

  it("rejects unknown fields nested inside repeating items", () => {
    const input = fixtureInput("fal2");
    const p = JSON.parse(JSON.stringify(input.formPayload)) as { cargoItems: Record<string, unknown>[] };
    p.cargoItems[0].secretSauce = true;
    expect(() => exportDeclarationToImo({ ...input, formPayload: p as never, formPayloadDigestSha256: digestOf(p) }))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_EXPORT_UNMAPPED_ELEMENT" }) as never);
  });
});

describe("fail-closed import rejections", () => {
  it("rejects unknown inbound IMO elements", () => {
    const exported = exportDeclarationToImo(fixtureInput("fal1")) as unknown as Record<string, unknown>;
    (exported.imoMessage as Record<string, unknown>).UnexpectedAggregate = { X: 1 };
    expect(() => importImoToDeclaration(exported, new Date().toISOString()))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_IMPORT_UNMAPPED_ELEMENT" }) as never);
  });

  it("rejects unregistered extension namespaces and fields", () => {
    const exported = JSON.parse(JSON.stringify(exportDeclarationToImo(fixtureInput("fal3")))) as Record<string, never>;
    exported.extensions = { evilNamespace: {} } as never;
    expect(() => importImoToDeclaration(exported, new Date().toISOString()))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_IMPORT_UNREGISTERED_EXTENSION" }) as never);
  });

  it("rejects missing mandatory inbound elements", () => {
    const exported = exportDeclarationToImo(fixtureInput("fal1")) as unknown as {
      imoMessage: { IMOCompendium: { GeneralDeclaration: { Ship: Record<string, unknown> } } };
    };
    delete exported.imoMessage.IMOCompendium.GeneralDeclaration.Ship.IMONumber;
    expect(() => importImoToDeclaration(exported, new Date().toISOString()))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_IMPORT_MISSING_MANDATORY" }) as never);
  });

  it("rejects malformed envelopes (shape violations fail closed)", () => {
    expect(() => importImoToDeclaration({ specVersion: "0.9" }, new Date().toISOString()))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_IMPORT_SHAPE_VIOLATION" }) as never);
    expect(() => importImoToDeclaration("not-an-object", new Date().toISOString()))
      .toThrowError(expect.objectContaining({ reasonCode: "IMO_IMPORT_SHAPE_VIOLATION" }) as never);
  });

  it("ImoConformanceError carries stable reason codes", () => {
    const err = new ImoConformanceError("IMO_EXPORT_UNMAPPED_ELEMENT", "x");
    expect(err.name).toBe("ImoConformanceError");
    expect(err.reasonCode).toBe("IMO_EXPORT_UNMAPPED_ELEMENT");
  });
});
