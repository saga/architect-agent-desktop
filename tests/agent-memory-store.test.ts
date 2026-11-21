import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMemoryStore } from "../src/main/memory/agent-memory-store";

const directories: string[] = [];
function temporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "architect-agent-memory-"));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("AgentMemoryStore", () => {
  it("stores sourced notes per workspace, supports review, and injects a bounded index", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const prepared = store.prepareDreaming("/workspace/portfolio", [{
      sessionId: "session-1",
      messageId: "source-1",
      kind: "user",
      content: "The holdings workbook uses one row per security; verify the as-of date before comparing returns.",
      createdAt: Date.now(),
    }, {
      sessionId: "session-2",
      messageId: "tool-1",
      kind: "tool",
      content: "Workbook schema inspection confirms one row per security and an as-of date column.",
      createdAt: Date.now() + 1,
    }]);
    const evidence = prepared!.evidence.find(source => source.kind === "user")!;
    const toolEvidence = prepared!.evidence.find(source => source.kind === "tool")!;
    const note = store.saveNote({
      scope: "/workspace/portfolio",
      title: "Portfolio data convention",
      content: "The holdings workbook uses one row per security; verify the as-of date before comparing returns.",
      claimType: "project_fact",
      tags: ["portfolio", "excel"],
      sourceSessionId: "session-1",
      sourceTraceId: "trace-1",
      sourceRefs: [evidence.sourceId, toolEvidence.sourceId],
    });

    expect(note.validation).toBe("unverified");
    expect(note.sourceSessionId).toBe("session-1");
    expect(store.search("/workspace/portfolio", "holdings")).toHaveLength(1);
    expect(store.search("/workspace/another-project", "holdings")).toHaveLength(0);

    const reviewed = store.setValidation(note.id, "validated", 0.95, [evidence.sourceId, toolEvidence.sourceId], "/workspace/portfolio");
    expect(reviewed.validation).toBe("validated");
    expect(reviewed.confidence).toBe(0.95);

    store.publishRepresentation({
      scope: "/workspace/portfolio",
      slug: "portfolio-data",
      title: "Portfolio data model",
      content: "Holdings data contains one row per security and requires an explicit as-of date.",
      sourceNoteIds: [note.id],
    });
    const context = store.getInjectedContext("/workspace/portfolio", 1200);
    expect(context).toContain("Portfolio data model");
    expect(context).toContain("[validated");
    expect(context.length).toBeLessThanOrEqual(1300);

    store.archive(note.id, "/workspace/portfolio");
    expect(store.getNote(note.id, "/workspace/portfolio")).toBeNull();
    store.close();
  });

  it("shares Personal Memory across Workspaces without exposing project Notes", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const personalRun = store.prepareDreaming(null, [{
      sessionId: "personal-session",
      messageId: "personal-source",
      kind: "user",
      content: "I prefer concise architecture reviews with explicit trade-offs and operational constraints.",
      createdAt: Date.now(),
    }]);
    const personalSource = personalRun!.evidence[0]!;
    const personalNote = store.saveNote({
      scope: null,
      title: "Architecture review preference",
      content: "Prefer concise architecture reviews with explicit trade-offs and operational constraints.",
      claimType: "user_preference",
      sourceRefs: [personalSource.sourceId],
    });
    store.saveNote({
      scope: "/workspace/portfolio-a",
      title: "Portfolio A private convention",
      content: "Portfolio A uses a confidential internal valuation convention.",
    });

    expect(store.search("/workspace/portfolio-a", "architecture review preference").map(note => note.id)).toContain(personalNote.id);
    expect(store.search("/workspace/portfolio-b", "architecture review preference").map(note => note.id)).toContain(personalNote.id);
    expect(store.search("/workspace/portfolio-b", "confidential internal valuation convention")).toHaveLength(0);
    const contextA = store.getInjectedContext("/workspace/portfolio-a");
    const contextB = store.getInjectedContext("/workspace/portfolio-b");
    expect(contextA).toContain("Architecture review preference");
    expect(contextA).toContain("Portfolio A private convention");
    expect(contextB).toContain("Architecture review preference");
    expect(contextB).not.toContain("Portfolio A private convention");
    expect(store.getSourceById(personalSource.sourceId, "/workspace/portfolio-b")).toBeNull();
    expect(store.getAgentAccessibleSource(personalSource.sourceId, "/workspace/portfolio-b")).toEqual(personalSource);
    store.abandonDreaming(null, personalRun!.id, "test complete");
    store.close();
  });

  it("requires source-class and independent-session evidence before validating facts", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const run = store.prepareDreaming("/workspace/validation-policy", [{
      sessionId: "assistant-session",
      messageId: "assistant-source",
      kind: "assistant",
      content: "The portfolio uses a single base currency.",
      createdAt: Date.now(),
    }, {
      sessionId: "user-session",
      messageId: "user-source",
      kind: "user",
      content: "The portfolio reports in USD.",
      createdAt: Date.now() + 1,
    }]);
    const assistant = run!.evidence.find(source => source.kind === "assistant")!;
    const user = run!.evidence.find(source => source.kind === "user")!;
    const fact = store.saveNote({
      scope: "/workspace/validation-policy",
      title: "Portfolio reporting currency",
      content: "The portfolio reports in USD.",
      claimType: "project_fact",
      sourceRefs: [assistant.sourceId, user.sourceId],
    });
    expect(() => store.setValidation(fact.id, "validated", 0.9, [assistant.sourceId, user.sourceId], "/workspace/validation-policy"))
      .toThrow(/at least two separate sessions.*direct user statement and a tool observation/);

    const preference = store.saveNote({
      scope: "/workspace/validation-policy",
      title: "User preference",
      content: "The user prefers concise output.",
      claimType: "user_preference",
      sourceRefs: [assistant.sourceId],
    });
    expect(() => store.setValidation(preference.id, "validated", 0.9, [assistant.sourceId], "/workspace/validation-policy"))
      .toThrow(/direct user statement/);

    const validPreference = store.saveNote({
      scope: "/workspace/validation-policy",
      title: "Directly stated preference",
      content: "The user asked for concise output.",
      claimType: "user_preference",
      sourceRefs: [user.sourceId],
    });
    const validated = store.setValidation(validPreference.id, "validated", 0.96, [user.sourceId], "/workspace/validation-policy");
    expect(validated.validation).toBe("validated");
    expect(validated.validationEvidence?.eligible).toBe(true);
    expect(validated.validationEvidence?.directUserSources).toBe(1);
    expect(validated.validationEvidence?.independentSessions).toBe(1);
    store.abandonDreaming("/workspace/validation-policy", run!.id, "test complete");
    store.close();
  });

  it("retrieves partial multi-term and Chinese phrase matches", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const english = store.saveNote({
      scope: "/workspace/search",
      title: "Portfolio risk monitoring",
      content: "Track issuer concentration and liquidity exposure before the monthly review.",
    });
    const chinese = store.saveNote({
      scope: "/workspace/search",
      title: "估值日期与基准币种",
      content: "跨组合收益比较前先核对估值日期和基准币种。",
    });

    expect(store.search("/workspace/search", "liquidity drawdown exposure").map(note => note.id)).toContain(english.id);
    expect(store.search("/workspace/search", "核对基准币").map(note => note.id)).toContain(chinese.id);
    store.close();
  });

  it("does not return unrelated semantic-only vectors", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const relevant = store.saveNote({
      scope: "/workspace/semantic-threshold",
      title: "Unrelated lexical title",
      content: "No matching query words appear in this content.",
    });
    const irrelevant = store.saveNote({
      scope: "/workspace/semantic-threshold",
      title: "Another unrelated title",
      content: "This note is not semantically similar either.",
    });
    const pending = store.listNotesMissingEmbeddings("/workspace/semantic-threshold", "ollama", "nomic-embed-text", 10);
    const relevantPending = pending.find(note => note.id === relevant.id)!;
    const irrelevantPending = pending.find(note => note.id === irrelevant.id)!;
    const base = [1, 0, 0, 0, 0, 0, 0, 0];
    const opposite = [-1, 0, 0, 0, 0, 0, 0, 0];
    store.upsertEmbedding({
      noteId: relevant.id, scope: "/workspace/semantic-threshold", provider: "ollama",
      model: "nomic-embed-text", contentHash: relevantPending.contentHash, vector: base,
    });
    store.upsertEmbedding({
      noteId: irrelevant.id, scope: "/workspace/semantic-threshold", provider: "ollama",
      model: "nomic-embed-text", contentHash: irrelevantPending.contentHash, vector: opposite,
    });

    const results = store.search("/workspace/semantic-threshold", "rare terminology absent from both notes", 10, {
      provider: "ollama", model: "nomic-embed-text", vector: base,
    });
    expect(results.map(note => note.id)).toContain(relevant.id);
    expect(results.map(note => note.id)).not.toContain(irrelevant.id);
    store.close();
  });

  it("performs scope-safe semantic retrieval and invalidates stale vectors", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const workspace = store.saveNote({
      scope: "/workspace/semantic",
      title: "Issuer liquidity and funding risk",
      content: "Assess refinancing concentration, cash buffers and counterparty funding.",
    });
    const personal = store.saveNote({
      scope: null,
      title: "General research preference",
      content: "Prefer primary sources and distinguish fact from inference.",
    });
    const unrelatedWorkspace = store.saveNote({
      scope: "/workspace/other",
      title: "Confidential acquisition model",
      content: "Private valuation assumptions for another project.",
    });

    const pendingWorkspace = store.listNotesMissingEmbeddings("/workspace/semantic", "ollama", "nomic-embed-text", 20);
    const pendingPersonal = pendingWorkspace.find(note => note.id === personal.id)!;
    const pendingIssuer = pendingWorkspace.find(note => note.id === workspace.id)!;
    const pendingOther = store.listNotesMissingEmbeddings("/workspace/other", "ollama", "nomic-embed-text", 20)
      .find(note => note.id === unrelatedWorkspace.id)!;
    const base = [1, 0, 0, 0, 0, 0, 0, 0];
    const near = [0.98, 0.2, 0, 0, 0, 0, 0, 0];

    expect(store.upsertEmbedding({
      noteId: workspace.id, scope: "/workspace/semantic", provider: "ollama", model: "nomic-embed-text",
      contentHash: pendingIssuer.contentHash, vector: base,
    })).toBe(true);
    expect(store.upsertEmbedding({
      noteId: personal.id, scope: null, provider: "ollama", model: "nomic-embed-text",
      contentHash: pendingPersonal.contentHash, vector: near,
    })).toBe(true);
    expect(store.upsertEmbedding({
      noteId: unrelatedWorkspace.id, scope: "/workspace/other", provider: "ollama", model: "nomic-embed-text",
      contentHash: pendingOther.contentHash, vector: base,
    })).toBe(true);

    const results = store.search("/workspace/semantic", "rare terminology absent from the notes", 10, {
      provider: "ollama", model: "nomic-embed-text", vector: base,
    });
    expect(results.map(note => note.id)).toContain(workspace.id);
    expect(results.map(note => note.id)).toContain(personal.id);
    expect(results.map(note => note.id)).not.toContain(unrelatedWorkspace.id);
    expect(store.getEmbeddingIndexStatus("/workspace/semantic", "ollama", "nomic-embed-text"))
      .toMatchObject({ total: 2, indexed: 2, missing: 0 });

    const changed = store.saveNote({
      id: workspace.id,
      scope: "/workspace/semantic",
      title: "Issuer liquidity and funding risk",
      content: "Updated: include collateral calls and contingent liquidity facilities.",
    });
    expect(changed.version).toBe(workspace.version + 1);
    expect(store.getEmbeddingIndexStatus("/workspace/semantic", "ollama", "nomic-embed-text"))
      .toMatchObject({ total: 2, indexed: 1, missing: 1 });
    expect(store.listNotesMissingEmbeddings("/workspace/semantic", "ollama", "nomic-embed-text", 20)
      .map(note => note.id)).toContain(workspace.id);

    const pendingAfterContentEdit = store.listNotesMissingEmbeddings("/workspace/semantic", "ollama", "nomic-embed-text", 20)
      .find(note => note.id === workspace.id)!;
    expect(store.upsertEmbedding({
      noteId: workspace.id, scope: "/workspace/semantic", provider: "ollama", model: "nomic-embed-text",
      contentHash: pendingAfterContentEdit.contentHash, vector: base,
    })).toBe(true);
    store.saveNote({
      id: workspace.id,
      scope: "/workspace/semantic",
      title: "Issuer liquidity and contingent funding risk",
      content: changed.content,
    });
    expect(store.getEmbeddingIndexStatus("/workspace/semantic", "ollama", "nomic-embed-text"))
      .toMatchObject({ total: 2, indexed: 1, missing: 1 });
    expect(store.listNotesMissingEmbeddings("/workspace/semantic", "ollama", "nomic-embed-text", 20)
      .map(note => note.id)).toContain(workspace.id);
    store.close();
  });

  it("does not treat sibling subdomains as independent external publishers", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const run = store.prepareDreaming("/workspace/external-subdomains", [{
      sessionId: "claim-session",
      messageId: "claim",
      kind: "user",
      content: "The regulator issued this reporting notice.",
      createdAt: Date.now(),
    }, {
      sessionId: "regulator-session",
      messageId: "apex-source",
      kind: "tool",
      content: "Fetched https://regulator.example.gov/notices/42.",
      createdAt: Date.now() + 1,
    }, {
      sessionId: "news-session",
      messageId: "subdomain-source",
      kind: "tool",
      content: "Fetched https://news.regulator.example.gov/coverage/42.",
      createdAt: Date.now() + 2,
    }]);
    const userSource = run!.evidence.find(source => source.kind === "user")!;
    const apexSource = run!.evidence.find(source => source.messageId === "apex-source")!;
    const subdomainSource = run!.evidence.find(source => source.messageId === "subdomain-source")!;
    const note = store.saveNote({
      scope: "/workspace/external-subdomains",
      title: "Regulatory reporting notice",
      content: "The regulator issued this reporting notice.",
      claimType: "external_fact",
      sourceRefs: [userSource.sourceId],
    });
    const recorded = store.recordExternalSources("/workspace/external-subdomains", {
      noteId: note.id,
      baseVersion: note.version,
      sources: [
        { sourceRef: apexSource.sourceId, url: "https://regulator.example.gov/notices/42", publisher: "Regulator" },
        { sourceRef: subdomainSource.sourceId, url: "https://news.regulator.example.gov/coverage/42", publisher: "Regulator News" },
      ],
      note: "Two URLs are from sibling subdomains of the same registrable domain.",
    });
    expect(recorded.externalVerification?.status).toBe("single_domain_sources_recorded");
    expect(() => store.confirmExternalVerification("/workspace/external-subdomains", note.id, recorded.version))
      .toThrow(/两个不同注册域名/);

    // Older versions counted arbitrary hostnames as independent domains.
    // Re-read must normalize their persisted status using registrable domains.
    const database = (store as unknown as { database: DatabaseSync }).database;
    database.prepare("UPDATE memory_notes SET external_verification_json=? WHERE id=?").run(
      {},
      JSON.stringify({
        ...recorded.externalVerification,
        status: "multi_domain_sources_recorded",
      }),
      note.id,
    );
    const reread = store.listNotes("/workspace/external-subdomains", true).find(item => item.id === note.id);
    expect(reread?.externalVerification?.status).toBe("single_domain_sources_recorded");
    store.abandonDreaming("/workspace/external-subdomains", run!.id, "test complete");
    store.close();
  });

  it("requires a human confirmation after recording distinct external source domains", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const run = store.prepareDreaming("/workspace/external-facts", [{
      sessionId: "user-session",
      messageId: "user-claim",
      kind: "user",
      content: "The reporting obligation applies to the portfolio under this regulation.",
      createdAt: Date.now(),
    }, {
      sessionId: "official-source-session",
      messageId: "official-source-result",
      kind: "tool",
      content: "Opened https://regulator.example.gov/notices/2026/42 and retrieved the official notice text.",
      createdAt: Date.now() + 1,
    }, {
      sessionId: "independent-source-session",
      messageId: "independent-source-result",
      kind: "tool",
      content: "Search result and article from https://industry-association.example.org/briefing-42 describing the same notice.",
      createdAt: Date.now() + 2,
    }]);
    const userSource = run!.evidence.find(source => source.kind === "user")!;
    const officialSource = run!.evidence.find(source => source.messageId === "official-source-result")!;
    const independentSource = run!.evidence.find(source => source.messageId === "independent-source-result")!;
    const note = store.saveNote({
      scope: "/workspace/external-facts",
      title: "Reporting obligation",
      content: "The regulation establishes a reporting obligation for this portfolio.",
      claimType: "external_fact",
      sourceRefs: [userSource.sourceId],
    });

    expect(() => store.setValidation(
      note.id, "validated", 0.99,
      [userSource.sourceId, officialSource.sourceId, independentSource.sourceId],
      "/workspace/external-facts",
    )).toThrow(/External facts cannot be validated by Agent evidence alone/);

    const first = store.recordExternalSources("/workspace/external-facts", {
      noteId: note.id,
      baseVersion: note.version,
      sources: [{
        sourceRef: officialSource.sourceId,
        url: "https://regulator.example.gov/notices/2026/42",
        publisher: "National Regulator",
        publishedAt: "2026-11-20",
      }],
      note: "Official notice plus independent reporting.",
    });
    expect(first.externalVerification?.status).toBe("single_domain_sources_recorded");
    expect(first.validation).toBe("unverified");
    expect(() => store.confirmExternalVerification("/workspace/external-facts", note.id, first.version))
      .toThrow(/两个不同注册域名/);

    const recorded = store.recordExternalSources("/workspace/external-facts", {
      noteId: note.id,
      baseVersion: first.version,
      sources: [{
        sourceRef: independentSource.sourceId,
        url: "https://industry-association.example.org/briefing-42",
        publisher: "Industry Association",
        publishedAt: "2026-11-21",
      }],
      note: "Two separate source domains have been recorded; awaiting human review.",
    });
    expect(recorded.externalVerification?.status).toBe("multi_domain_sources_recorded");
    expect(recorded.validation).toBe("unverified");

    const confirmed = store.confirmExternalVerification("/workspace/external-facts", note.id, recorded.version);
    expect(confirmed.validation).toBe("validated");
    expect(confirmed.validationEvidence?.policy).toBe("human_confirmed_multi_domain_source_review");
    expect(confirmed.validationEvidence?.eligible).toBe(true);
    expect(confirmed.externalVerification?.sources.map(source => source.domain)).toEqual([
      "regulator.example.gov",
      "industry-association.example.org",
    ]);

    const metadataUpdated = store.saveNote({
      id: note.id,
      scope: "/workspace/external-facts",
      title: note.title,
      content: note.content,
      claimType: "external_fact",
      tags: ["regulation", "reviewed"],
    });
    expect(metadataUpdated.validation).toBe("validated");
    expect(metadataUpdated.validationEvidence?.policy).toBe("human_confirmed_multi_domain_source_review");
    expect(metadataUpdated.externalVerification?.status).toBe("multi_domain_sources_recorded");

    const disputed = store.setValidation(
      note.id, "disputed", 0.2,
      [userSource.sourceId, officialSource.sourceId, independentSource.sourceId],
      "/workspace/external-facts",
    );
    expect(disputed.validation).toBe("disputed");
    expect(() => store.confirmExternalVerification("/workspace/external-facts", note.id, disputed.version))
      .toThrow(/争议状态/);
    expect(() => store.recordExternalSources("/workspace/external-facts", {
      noteId: note.id, baseVersion: disputed.version,
      sources: [{
        sourceRef: officialSource.sourceId,
        url: "https://regulator.example.gov/notices/2026/42?revised=1",
        publisher: "National Regulator",
      }],
      note: "Trying to bypass an unresolved dispute.",
    })).toThrow(/仍存在争议/);
    store.abandonDreaming("/workspace/external-facts", run!.id, "test complete");
    store.close();
  });

  it("rejects external source records without same-Workspace tool evidence or public HTTPS URLs", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const run = store.prepareDreaming("/workspace/external-source-guard", [{
      sessionId: "user-source-guard",
      messageId: "claim",
      kind: "user",
      content: "Confirm this external regulatory statement.",
      createdAt: Date.now(),
    }, {
      sessionId: "tool-source-guard",
      messageId: "tool-result",
      kind: "tool",
      content: "Fetched https://regulator.example.gov/notice.",
      createdAt: Date.now() + 1,
    }]);
    const userSource = run!.evidence.find(source => source.kind === "user")!;
    const toolSource = run!.evidence.find(source => source.kind === "tool")!;
    const note = store.saveNote({
      scope: "/workspace/external-source-guard",
      title: "External regulatory statement",
      content: "The regulator published the notice.",
      claimType: "external_fact",
      sourceRefs: [userSource.sourceId],
    });
    expect(() => store.recordExternalSources("/workspace/external-source-guard", {
      noteId: note.id, baseVersion: note.version,
      sources: [{ sourceRef: userSource.sourceId, url: "https://regulator.example.gov/notice", publisher: "Regulator" }],
      note: "",
    })).toThrow(/tool 证据/);
    expect(() => store.recordExternalSources("/workspace/external-source-guard", {
      noteId: note.id, baseVersion: note.version,
      sources: [{ sourceRef: toolSource.sourceId, url: "http://regulator.example.gov/notice", publisher: "Regulator" }],
      note: "",
    })).toThrow(/公开 HTTPS/);
    expect(() => store.recordExternalSources("/workspace/external-source-guard", {
      noteId: note.id, baseVersion: note.version,
      sources: [{ sourceRef: toolSource.sourceId, url: "https://127.0.0.1/notice", publisher: "Regulator" }],
      note: "",
    })).toThrow(/公开 HTTPS/);
    expect(() => store.recordExternalSources("/workspace/external-source-guard", {
      noteId: note.id, baseVersion: note.version,
      sources: [{ sourceRef: toolSource.sourceId, url: "https://regulator.example.gov/notice?access_token=secret-value", publisher: "Regulator" }],
      note: "",
    })).toThrow(/access token|signed URL|访问令牌/);
    store.abandonDreaming("/workspace/external-source-guard", run!.id, "test complete");
    store.close();
  });

  it("marks evidence previews when a Transcript message exceeds the per-source limit", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const run = store.prepareDreaming("/workspace/truncated-source", [{
      sessionId: "session-large",
      messageId: "message-large",
      kind: "assistant",
      content: "A long Transcript message. ".repeat(300),
      createdAt: Date.now(),
    }]);
    const evidence = run!.evidence[0]!;
    expect(evidence.content).toContain("[TRUNCATED:");
    expect(evidence.content.length).toBeLessThanOrEqual(4000);
    store.abandonDreaming("/workspace/truncated-source", run!.id, "test complete");
    store.close();
  });

  it("reads historical source evidence only within its Workspace", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const run = store.prepareDreaming("/workspace/source-read", [{
      sessionId: "session-source",
      messageId: "message-source",
      kind: "user",
      content: "The source transcript confirms the project naming convention.",
      createdAt: Date.now(),
    }]);
    const source = run!.evidence[0]!;
    expect(store.getSourceById(source.sourceId, "/workspace/source-read")).toEqual(source);
    expect(store.getSourceById(source.sourceId, "/workspace/other")).toBeNull();
    store.abandonDreaming("/workspace/source-read", run!.id, "test complete");
    store.close();
  });

  it("supports Chinese fallback search and preserves disputed notes as disputed", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/cn",
      title: "组合风控口径",
      content: "组合风险分析必须区分净敞口、总敞口和衍生品名义本金。",
    });
    expect(store.search("/workspace/cn", "衍生品名义本金")).toHaveLength(1);

    const prepared = store.prepareDreaming("/workspace/cn", [{
      sessionId: "session-cn",
      messageId: "source-cn",
      kind: "user",
      content: "已确认组合风险分析必须区分净敞口、总敞口和衍生品名义本金。",
      createdAt: Date.now(),
    }]);
    store.setValidation(note.id, "disputed", 0.2, [prepared!.evidence[0]!.sourceId], "/workspace/cn");
    expect(store.getInjectedContext("/workspace/cn")).toContain("[disputed");
    store.close();
  });

  it("commits evidence-backed Dreaming atomically, advances the cursor, and can roll back", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const createdAt = Date.now();
    const run = store.prepareDreaming("/workspace/dream", [{
      sessionId: "session-dream",
      messageId: "message-dream",
      kind: "assistant",
      content: "成功流程：每次组合收益比较必须核对估值日、币种和费用口径。",
      createdAt,
    }]);
    expect(run?.status).toBe("prepared");
    expect(store.getDreamCursor("/workspace/dream")).toEqual({
      createdAt: 0, sessionId: "", messageId: "", transcriptRevision: 0,
    });

    const sourceId = run!.evidence[0]!.sourceId;
    const committed = store.commitDreaming({
      scope: "/workspace/dream",
      runId: run!.id,
      summary: "沉淀组合收益比较前必须核对估值日、币种和费用口径的成功检查流程。",
      operations: [{
        op: "upsert_note",
        title: "组合收益比较检查",
        content: "比较组合收益前，必须先确认估值日、币种和费用口径。",
        tags: ["portfolio", "performance"],
        importance: 0.9,
        sourceRefs: [sourceId],
        reason: "这是可复用且能避免分析错误的稳定成功流程。",
      }],
    });
    expect(committed.status).toBe("completed");
    expect(committed.createdNoteIds).toHaveLength(1);
    expect(store.getDreamCursor("/workspace/dream")).toEqual({
      createdAt, sessionId: "session-dream", messageId: "message-dream", transcriptRevision: 0,
    });
    const note = store.getNote(committed.createdNoteIds[0]!, "/workspace/dream");
    expect(note?.validation).toBe("unverified");
    expect(note?.sourceRefs).toContain(sourceId);
    expect(store.listDreamRuns("/workspace/dream")[0]?.status).toBe("completed");

    expect(store.search("/workspace/dream", "组合收益比较")).toHaveLength(1);
    const rolledBack = store.rollbackDreaming("/workspace/dream", run!.id, "验证回滚功能");
    expect(rolledBack.rolledBackOperations).toBeGreaterThan(0);
    expect(store.getNote(committed.createdNoteIds[0]!, "/workspace/dream")).toBeNull();
    expect(store.getDreamCursor("/workspace/dream")).toEqual({
      createdAt: 0, sessionId: "", messageId: "", transcriptRevision: 0,
    });
    store.close();
  });

  it("does not commit a Dreaming plan when a note version has changed", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const first = store.prepareDreaming("/workspace/conflict", [{
      sessionId: "session-conflict",
      messageId: "message-conflict",
      kind: "user",
      content: "项目规定 SQL 表和字段必须使用小写 snake_case。",
      createdAt: Date.now(),
    }]);
    const sourceId = first!.evidence[0]!.sourceId;
    const note = store.saveNote({
      scope: "/workspace/conflict",
      title: "SQL 命名约定",
      content: "SQL 表和字段使用 snake_case。",
      sourceRefs: [sourceId],
    });
    store.saveNote({
      id: note.id,
      scope: "/workspace/conflict",
      title: "SQL 命名约定",
      content: "SQL 表和字段必须使用小写 snake_case，并避免保留字。",
    });

    expect(() => store.commitDreaming({
      scope: "/workspace/conflict",
      runId: first!.id,
      summary: "合并一条同名约定",
      operations: [{
        op: "upsert_note",
        id: note.id,
        baseVersion: note.version,
        title: "SQL 命名约定",
        content: "SQL 表和字段使用 snake_case。",
        sourceRefs: [sourceId],
        reason: "版本冲突应阻止覆盖后续更新。",
      }],
    })).toThrow(/版本已变化/);
    expect(store.getDreamRun(first!.id, "/workspace/conflict")?.status).toBe("prepared");
    expect(store.getDreamCursor("/workspace/conflict").createdAt).toBe(0);
    expect(store.getNote(note.id, "/workspace/conflict")?.content).toContain("避免保留字");
    store.abandonDreaming("/workspace/conflict", first!.id, "版本冲突后放弃");
    store.close();
  });

  it("rejects a Dreaming knowledge-page update when its base version is stale", () => {
    const directory = temporaryDirectory();
    const store = new AgentMemoryStore(path.join(directory, "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/knowledge-conflict",
      title: "Portfolio calculation rule",
      content: "Use the approved valuation date.",
    });
    const initialPage = store.publishRepresentation({
      scope: "/workspace/knowledge-conflict",
      slug: "portfolio-method",
      title: "Portfolio method",
      content: "Version one.",
      sourceNoteIds: [note.id],
    });
    const run = store.prepareDreaming("/workspace/knowledge-conflict", [{
      sessionId: "session-knowledge",
      messageId: "message-knowledge",
      kind: "user",
      content: "Use the approved valuation date and reporting currency.",
      createdAt: Date.now(),
    }]);
    store.publishRepresentation({
      scope: "/workspace/knowledge-conflict",
      slug: "portfolio-method",
      title: "Portfolio method",
      content: "A newer manual revision.",
      sourceNoteIds: [note.id],
    });

    expect(() => store.commitDreaming({
      scope: "/workspace/knowledge-conflict",
      runId: run!.id,
      summary: "Attempt to update a knowledge page from a stale snapshot.",
      operations: [{
        op: "publish_knowledge",
        slug: "portfolio-method",
        title: "Portfolio method",
        content: "A stale Dreaming revision.",
        sourceNoteIds: [note.id],
        baseVersion: initialPage.version,
        sourceRefs: [run!.evidence[0]!.sourceId],
        reason: "This update must not overwrite a newer knowledge-page revision.",
      }],
    })).toThrow(/知识页版本已变化/);
    expect(store.getRepresentations("/workspace/knowledge-conflict")[0]?.content).toBe("A newer manual revision.");
    expect(store.getDreamCursor("/workspace/knowledge-conflict").createdAt).toBe(0);
    store.abandonDreaming("/workspace/knowledge-conflict", run!.id, "stale knowledge page");
    store.close();
  });

  it("performs an audited quality review without advancing the Transcript revision cursor", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const createdAt = Date.now() - 45 * 24 * 60 * 60 * 1000;
    const transcriptRun = store.prepareDreaming("/workspace/quality-review", [{
      sessionId: "session-quality",
      messageId: "message-quality",
      kind: "user",
      content: "The project requires all risk comparisons to use the approved reporting date and base currency.",
      createdAt,
    }, {
      sessionId: "session-quality-tool",
      messageId: "message-quality-tool",
      kind: "tool",
      content: "The project risk report schema contains an approved reporting date and base currency.",
      createdAt: createdAt + 1,
    }]);
    const originalSourceIds = transcriptRun!.evidence.map(source => source.sourceId);
    const note = store.commitDreaming({
      scope: "/workspace/quality-review",
      runId: transcriptRun!.id,
      summary: "Create a durable project rule.",
      operations: [{
        op: "upsert_note",
        title: "Risk comparison convention",
        content: "Risk comparisons must use the approved reporting date and base currency.",
        claimType: "project_fact",
        sourceRefs: originalSourceIds,
        reason: "This is a reusable project convention.",
      }],
    }).createdNoteIds[0]!;
    const cursorBefore = store.getDreamCursor("/workspace/quality-review");
    const qualityAsOf = Date.now() + 45 * 24 * 60 * 60 * 1000;
    const candidates = store.listQualityReviewCandidates("/workspace/quality-review", 10, qualityAsOf);
    expect(candidates.map(item => item.id)).toContain(note);

    const reviewRun = store.prepareQualityReview("/workspace/quality-review", 10, qualityAsOf);
    expect(reviewRun?.purpose).toBe("quality_review");
    expect(reviewRun?.evidence.length).toBeGreaterThan(0);
    expect(store.getDreamCursor("/workspace/quality-review")).toEqual(cursorBefore);
    const mappedCandidates = store.listQualityReviewCandidatesForRun("/workspace/quality-review", reviewRun!.id, 80, qualityAsOf);
    const mapped = mappedCandidates.find(item => item.id === note);
    expect(mapped).toBeDefined();
    expect(mapped?.qualityReviewSourceRefs).toContain(reviewRun!.evidence[0]!.sourceId);
    const currentNote = store.getNote(note, "/workspace/quality-review")!;
    expect(() => store.commitDreaming({
      scope: "/workspace/quality-review",
      runId: reviewRun!.id,
      summary: "An empty quality review is not a completed review.",
      operations: [],
    })).toThrow(/至少需要复核一条候选 Note/);
    expect(store.getDreamRun(reviewRun!.id, "/workspace/quality-review")?.status).toBe("prepared");
    const result = store.commitDreaming({
      scope: "/workspace/quality-review",
      runId: reviewRun!.id,
      summary: "Reviewed the original source and confirmed the convention remains applicable.",
      operations: [{
        op: "review_note",
        id: note,
        baseVersion: currentNote.version,
        validation: "validated",
        confidence: 0.93,
        qualityScore: 0.91,
        sourceRefs: reviewRun!.evidence.map(source => source.sourceId),
        reason: "The source remains clear, specific and consistent with the active project rule.",
      }],
    });
    expect(result.status).toBe("completed");
    const reviewed = store.getNote(note, "/workspace/quality-review")!;
    expect(reviewed.qualityScore).toBe(0.91);
    expect(reviewed.lastQualityReviewedAt).toBeGreaterThan(0);
    expect(store.getDreamCursor("/workspace/quality-review")).toEqual(cursorBefore);

    store.rollbackDreaming("/workspace/quality-review", reviewRun!.id, "Verify quality review rollback.");
    const restored = store.getNote(note, "/workspace/quality-review")!;
    expect(restored.qualityScore).toBeNull();
    expect(restored.lastQualityReviewedAt).toBeNull();
    expect(store.getDreamCursor("/workspace/quality-review")).toEqual(cursorBefore);
    store.close();
  });

  it("uses the latest retained Transcript revision as quality review evidence", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const createdAt = Date.now() - 60 * 24 * 60 * 60 * 1000;
    const first = store.prepareDreaming("/workspace/latest-quality-source", [{
      sessionId: "session-latest",
      messageId: "message-latest",
      kind: "user",
      content: "The old project rule used USD.",
      createdAt,
    }]);
    const firstSource = first!.evidence[0]!.sourceId;
    const noteId = store.commitDreaming({
      scope: "/workspace/latest-quality-source",
      runId: first!.id,
      summary: "Save the first project rule.",
      operations: [{
        op: "upsert_note",
        title: "Project base currency",
        content: "The old project rule used USD.",
        sourceRefs: [firstSource],
        reason: "Initial transcript evidence.",
      }],
    }).createdNoteIds[0]!;

    const second = store.prepareDreaming("/workspace/latest-quality-source", [{
      sessionId: "session-latest",
      messageId: "message-latest",
      kind: "user",
      content: "Correction: the current project base currency is EUR.",
      createdAt,
      revision: 41,
      changeType: "updated",
    }]);
    const secondSource = second!.evidence[0]!.sourceId;
    const note = store.getNote(noteId, "/workspace/latest-quality-source")!;
    store.commitDreaming({
      scope: "/workspace/latest-quality-source",
      runId: second!.id,
      summary: "Correct the project base currency.",
      operations: [{
        op: "upsert_note",
        id: noteId,
        baseVersion: note.version,
        title: "Project base currency",
        content: "The current project base currency is EUR.",
        sourceRefs: [secondSource],
        reason: "A later revision explicitly corrects the earlier rule.",
      }],
    });

    const review = store.prepareQualityReview(
      "/workspace/latest-quality-source",
      10,
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    );
    expect(review?.evidence).toHaveLength(1);
    expect(review?.evidence[0]?.revision).toBe(41);
    expect(review?.evidence[0]?.content).toContain("EUR");
    store.abandonDreaming("/workspace/latest-quality-source", review!.id, "test complete");
    store.close();
  });

  it("does not mark ordinary transcript review as a quality review", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const run = store.prepareDreaming("/workspace/ordinary-review", [{
      sessionId: "session-ordinary-review",
      messageId: "message-ordinary-review",
      kind: "user",
      content: "The project naming rule uses lowercase snake_case.",
      createdAt: Date.now(),
    }]);
    const note = store.saveNote({
      scope: "/workspace/ordinary-review",
      title: "Project naming rule",
      content: "The project uses lowercase snake_case.",
      claimType: "user_intent",
      sourceRefs: [run!.evidence[0]!.sourceId],
    });
    store.commitDreaming({
      scope: "/workspace/ordinary-review",
      runId: run!.id,
      summary: "Reviewed the new project naming convention.",
      operations: [{
        op: "review_note",
        id: note.id,
        baseVersion: note.version,
        validation: "validated",
        confidence: 0.9,
        sourceRefs: [run!.evidence[0]!.sourceId],
        reason: "The latest transcript directly confirms the naming convention.",
      }],
    });
    const reviewed = store.getNote(note.id, "/workspace/ordinary-review")!;
    expect(reviewed.validation).toBe("validated");
    expect(reviewed.qualityScore).toBeNull();
    expect(reviewed.lastQualityReviewedAt).toBeNull();
    store.close();
  });

  it("archives stale knowledge pages with version checks and rollback support", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/knowledge-archive",
      title: "Archived page source",
      content: "The old workflow is no longer applicable.",
    });
    const page = store.publishRepresentation({
      scope: "/workspace/knowledge-archive",
      slug: "old-workflow",
      title: "Old workflow",
      content: "The retired process.",
      sourceNoteIds: [note.id],
    });
    const run = store.prepareDreaming("/workspace/knowledge-archive", [{
      sessionId: "session-archive",
      messageId: "message-archive",
      kind: "user",
      content: "The old workflow has been replaced by the new approval process.",
      createdAt: Date.now(),
    }]);

    store.commitDreaming({
      scope: "/workspace/knowledge-archive",
      runId: run!.id,
      summary: "Archive a knowledge page that no longer represents the current process.",
      operations: [{
        op: "archive_knowledge",
        slug: "old-workflow",
        baseVersion: page.version,
        sourceRefs: [run!.evidence[0]!.sourceId],
        reason: "The source transcript confirms that this process has been replaced.",
      }],
    });
    expect(store.getRepresentations("/workspace/knowledge-archive")).toHaveLength(0);
    const archiveOperation = store.getDreamOperations(run!.id, "/workspace/knowledge-archive")
      .find(operation => operation.operation === "archive_knowledge");
    expect(archiveOperation).toBeDefined();
    expect(JSON.parse(String(archiveOperation!.after)).source_refs_json).toContain(run!.evidence[0]!.sourceId);

    store.rollbackDreaming("/workspace/knowledge-archive", run!.id, "Verify knowledge-page rollback.");
    expect(store.getRepresentations("/workspace/knowledge-archive")[0]?.content).toBe("The retired process.");
    expect(store.getDreamCursor("/workspace/knowledge-archive").createdAt).toBe(0);
    store.close();
  });

  it("stores before and after versions when expired notes are pruned", () => {
    const directory = temporaryDirectory();
    const databasePath = path.join(directory, "memory.sqlite");
    const store = new AgentMemoryStore(databasePath);
    const note = store.saveNote({
      scope: "/workspace/expiry",
      title: "Temporary project decision",
      content: "This decision is valid only for a short period.",
      expiresAt: 100,
    });

    expect(store.hasExpiredNotes("/workspace/expiry", 101)).toBe(true);
    expect(store.pruneExpired("/workspace/expiry", 101)).toEqual({ archived: 1 });
    expect(store.hasExpiredNotes("/workspace/expiry", 101)).toBe(false);
    const archived = store.listNotes("/workspace/expiry", true).find(item => item.id === note.id);
    expect(archived?.status).toBe("archived");
    expect(archived?.version).toBe(note.version + 1);
    store.close();

    const database = new DatabaseSync(databasePath);
    try {
      const rows = database.prepare(
        "SELECT version,snapshot_json FROM memory_versions WHERE entity_type='note' AND entity_id=? ORDER BY version"
      ).all(note.id) as Array<{ version: number; snapshot_json: string }>;
      expect(rows.map(row => row.version)).toContain(note.version + 1);
      const archivedSnapshot = rows.find(row => row.version === note.version + 1);
      expect(archivedSnapshot).toBeDefined();
      expect(JSON.parse(archivedSnapshot!.snapshot_json).status).toBe("archived");
    } finally {
      database.close();
    }
  });

  it("keeps priority notes ahead of large knowledge-page context", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const pinned = store.saveNote({
      scope: "/workspace/context-priority",
      title: "Critical workspace convention",
      content: "Always reconcile the reporting currency before comparing portfolio returns.",
      pinned: true,
      importance: 1,
    });
    for (let index = 0; index < 8; index++) {
      const note = store.saveNote({
        scope: "/workspace/context-priority",
        title: "Knowledge source " + index,
        content: "A reusable knowledge source.",
      });
      store.publishRepresentation({
        scope: "/workspace/context-priority",
        slug: "knowledge-" + index,
        title: "Large knowledge page " + index,
        content: "A long knowledge summary. ".repeat(400),
        sourceNoteIds: [note.id],
      });
    }

    const context = store.getInjectedContext("/workspace/context-priority", 1000);
    expect(context).toContain(pinned.title);
    expect(context.indexOf(pinned.title)).toBeLessThan(context.indexOf("Workspace Knowledge Index"));
    expect(context.length).toBeLessThanOrEqual(1000);
    store.close();
  });

  it("uses a stable composite cursor to avoid skipping messages with equal timestamps", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const timestamp = Date.now();
    const first = store.prepareDreaming("/workspace/tie", [{
      sessionId: "session-a",
      messageId: "message-1",
      kind: "user",
      content: "第一条消息",
      createdAt: timestamp,
    }]);
    const sourceA = first!.evidence[0]!.sourceId;
    store.commitDreaming({
      scope: "/workspace/tie",
      runId: first!.id,
      summary: "处理第一条消息",
      operations: [{
        op: "upsert_note",
        title: "第一条记录",
        content: "第一条消息内容",
        sourceRefs: [sourceA],
        reason: "记录第一条消息。",
      }],
    });

    const second = store.prepareDreaming("/workspace/tie", [
      { sessionId: "session-b", messageId: "message-2", kind: "user", content: "第二条消息", createdAt: timestamp },
      { sessionId: "session-c", messageId: "message-3", kind: "user", content: "第三条消息", createdAt: timestamp },
    ]);
    expect(second?.evidence.map(source => source.sessionId)).toEqual(["session-b", "session-c"]);
    store.abandonDreaming("/workspace/tie", second!.id, "验证同时间戳游标");
    store.close();
  });
  it("reprocesses an old message when a higher Transcript revision arrives", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const createdAt = Date.now() - 90_000;
    const first = store.prepareDreaming("/workspace/revision-aware", [{
      sessionId: "session-revision",
      messageId: "old-message",
      kind: "user",
      content: "The earlier assumption was that the portfolio base currency is USD.",
      createdAt,
      revision: 10,
      changeType: "created",
    }]);
    store.commitDreaming({
      scope: "/workspace/revision-aware",
      runId: first!.id,
      summary: "Capture the initial transcript revision.",
      operations: [],
    });
    expect(store.getDreamCursor("/workspace/revision-aware").transcriptRevision).toBe(10);

    const revised = store.prepareDreaming("/workspace/revision-aware", [{
      sessionId: "session-revision",
      messageId: "old-message",
      kind: "user",
      content: "Correction: the approved portfolio base currency is EUR, not USD.",
      createdAt,
      revision: 11,
      changeType: "updated",
    }]);
    expect(revised?.evidence).toHaveLength(1);
    expect(revised?.evidence[0]?.createdAt).toBe(createdAt);
    expect(revised?.evidence[0]?.content).toContain("EUR, not USD");
    store.commitDreaming({
      scope: "/workspace/revision-aware",
      runId: revised!.id,
      summary: "Re-evaluate a historical message that changed after the earlier Dreaming run.",
      operations: [{
        op: "upsert_note",
        title: "Portfolio base currency",
        content: "The approved portfolio base currency is EUR.",
        sourceRefs: [revised!.evidence[0]!.sourceId],
        reason: "A later revision explicitly corrected the old assumption.",
      }],
    });
    expect(store.getDreamCursor("/workspace/revision-aware").transcriptRevision).toBe(11);
    expect(store.search("/workspace/revision-aware", "approved portfolio base currency")[0]?.content).toContain("EUR");
    store.close();
  });

  it("advances the cursor for a reviewed batch with no durable memory changes", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const createdAt = Date.now();
    const run = store.prepareDreaming("/workspace/no-op", [{
      sessionId: "session-no-op",
      messageId: "message-no-op",
      kind: "user",
      content: "这个请求是一次性信息，没有长期适用的项目事实或工作偏好。",
      createdAt,
    }]);
    const result = store.commitDreaming({
      scope: "/workspace/no-op",
      runId: run!.id,
      summary: "已评估证据；该请求没有应沉淀为长期记忆的内容。",
      operations: [],
    });
    expect(result.operationCount).toBe(0);
    expect(store.getDreamRun(run!.id, "/workspace/no-op")?.status).toBe("completed");
    expect(store.getDreamCursor("/workspace/no-op")).toEqual({
      createdAt, sessionId: "session-no-op", messageId: "message-no-op", transcriptRevision: 0,
    });
    expect(store.listNotes("/workspace/no-op", true)).toHaveLength(0);
    store.close();
  });

  it("persists Workspace Dreaming schedules with claims and exponential retry", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const scope = "/workspace/dream-schedule";
    expect(store.getDreamSchedule(scope)).toMatchObject({
      enabled: false,
      intervalMinutes: 1440,
      nextRunAt: null,
      lastRunStatus: null,
    });

    const saved = store.saveDreamSchedule(scope, { enabled: true, intervalMinutes: 360 }, 1000);
    expect(saved.nextRunAt).toBe(1000 + 360 * 60_000);
    expect(store.listDueDreamSchedules(1000 + 360 * 60_000 - 1)).toHaveLength(0);
    expect(store.claimDreamSchedule(scope, 1000 + 360 * 60_000)).toBe(true);
    expect(store.claimDreamSchedule(scope, 1000 + 360 * 60_000 + 1)).toBe(false);
    expect(store.getDreamSchedule(scope).lastRunStatus).toBe("running");

    const firstFailureAt = 1000 + 360 * 60_000 + 2;
    const failed = store.finishDreamSchedule(scope, "error", "Expert does not have the memory tools enabled.", firstFailureAt);
    expect(failed.consecutiveFailures).toBe(1);
    expect(failed.nextRunAt).toBe(firstFailureAt + 15 * 60_000);
    expect(failed.lastError).toContain("memory tools");

    expect(store.claimDreamSchedule(scope, failed.nextRunAt!)).toBe(true);
    const secondFailureAt = failed.nextRunAt! + 1;
    const retried = store.finishDreamSchedule(scope, "error", "Provider temporarily unavailable.", secondFailureAt);
    expect(retried.consecutiveFailures).toBe(2);
    expect(retried.nextRunAt).toBe(secondFailureAt + 30 * 60_000);

    const disabled = store.saveDreamSchedule(scope, { enabled: false, intervalMinutes: 360 }, secondFailureAt + 2);
    expect(disabled.enabled).toBe(false);
    expect(disabled.nextRunAt).toBeNull();
    expect(store.listDueDreamSchedules(Number.MAX_SAFE_INTEGER)).toHaveLength(0);
    store.close();
  });

  it("supports a separate Personal-scope Dreaming schedule", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const now = Date.now();
    const saved = store.saveDreamSchedule(null, { enabled: true, intervalMinutes: 360 }, now);
    expect(saved.enabled).toBe(true);
    expect(saved.intervalMinutes).toBe(360);
    expect(saved.nextRunAt).toBe(now + 360 * 60_000);

    const due = store.listDueDreamSchedules(now + 360 * 60_000);
    expect(due).toHaveLength(1);
    expect(due[0]?.scope).toBeNull();
    expect(store.claimDreamSchedule(null, now + 360 * 60_000)).toBe(true);
    const completed = store.finishDreamSchedule(null, "success", null, now + 360 * 60_000 + 1);
    expect(completed.lastRunStatus).toBe("success");
    expect(completed.enabled).toBe(true);
    store.close();
  });

  it("scopes manual pin and archive operations to the selected Workspace", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const note = store.saveNote({
      scope: "/workspace/alpha",
      title: "Workspace Alpha convention",
      content: "Alpha-specific rule.",
    });
    expect(() => store.setPinned(note.id, true, "/workspace/beta")).toThrow(/当前 Workspace/);
    expect(() => store.archive(note.id, "/workspace/beta")).toThrow(/当前 Workspace/);
    expect(store.getNote(note.id, "/workspace/alpha")?.pinned).toBe(false);

    const pinned = store.setPinned(note.id, true, "/workspace/alpha");
    expect(pinned.pinned).toBe(true);
    expect(() => store.archive(note.id, "/workspace/alpha")).toThrow(/置顶/);
    store.setPinned(note.id, false, "/workspace/alpha");
    store.archive(note.id, "/workspace/alpha");
    expect(store.getNote(note.id, "/workspace/alpha")).toBeNull();
    expect(store.listNotes("/workspace/alpha", true).find(item => item.id === note.id)?.status).toBe("archived");
    store.close();
  });

  it("redacts common credentials from direct Memory and Knowledge writes", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const apiKey = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    const note = store.saveNote({
      scope: "/workspace/redaction",
      title: "Credential " + apiKey,
      content: "Do not retain this token: " + apiKey,
    });
    expect(note.title).not.toContain(apiKey);
    expect(note.content).not.toContain(apiKey);
    expect(note.content).toContain("[REDACTED_SECRET]");

    const run = store.prepareDreaming("/workspace/redaction", [{
      sessionId: "session-redaction",
      messageId: "source-redaction",
      kind: "user",
      content: "Please review an ordinary workflow, with no secrets.",
      createdAt: Date.now(),
    }]);
    const page = store.publishRepresentation({
      scope: "/workspace/redaction",
      slug: "safe-knowledge",
      title: "Safe knowledge " + apiKey,
      content: "This page must not retain " + apiKey,
      sourceNoteIds: [note.id],
    });
    expect(page.title).not.toContain(apiKey);
    expect(page.content).not.toContain(apiKey);
    store.abandonDreaming("/workspace/redaction", run!.id, "test complete");
    store.close();
  });


  it("prevents rollback while a later evidence batch is prepared", () => {
    const store = new AgentMemoryStore(path.join(temporaryDirectory(), "memory.sqlite"));
    const firstTime = Date.now();
    const first = store.prepareDreaming("/workspace/pending-rollback", [{
      sessionId: "session-a",
      messageId: "message-1",
      kind: "user",
      content: "第一批已整理的证据。",
      createdAt: firstTime,
    }]);
    store.commitDreaming({
      scope: "/workspace/pending-rollback",
      runId: first!.id,
      summary: "提交第一批证据。",
      operations: [{
        op: "upsert_note",
        title: "第一批记忆",
        content: "第一批长期知识。",
        sourceRefs: [first!.evidence[0]!.sourceId],
        reason: "记录有来源的长期知识。",
      }],
    });

    const second = store.prepareDreaming("/workspace/pending-rollback", [{
      sessionId: "session-a",
      messageId: "message-2",
      kind: "assistant",
      content: "第二批尚未提交的证据。",
      createdAt: firstTime + 1,
    }]);
    expect(second?.status).toBe("prepared");
    expect(() => store.rollbackDreaming("/workspace/pending-rollback", first!.id, "不应跨越待提交批次回滚"))
      .toThrow(/存在待提交的 Dreaming Run/);
    store.abandonDreaming("/workspace/pending-rollback", second!.id, "先放弃下一批");
    expect(store.rollbackDreaming("/workspace/pending-rollback", first!.id, "放弃后可以安全回滚").rolledBackOperations)
      .toBeGreaterThan(0);
    expect(store.getDreamCursor("/workspace/pending-rollback").createdAt).toBe(0);
    store.close();
  });

});
