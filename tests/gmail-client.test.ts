import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getMostRecentLoseItCsv } from "../lib/gmail/client";

const mockList = vi.fn();
const mockGet = vi.fn();
const mockAttachmentsGet = vi.fn();

vi.mock("googleapis", () => ({
  gmail_v1: {
    Gmail: vi.fn().mockImplementation(function MockGmail() {
      return {
        users: {
          messages: {
            list: mockList,
            get: mockGet,
            attachments: { get: mockAttachmentsGet },
          },
        },
      };
    }),
  },
}));

const LOSEIT_FROM = "LoseIt <donotreply@loseit.com>";

function messagePayload(overrides: Record<string, unknown> = {}) {
  return {
    headers: [{ name: "From", value: LOSEIT_FROM }],
    parts: [
      {
        filename: "loseit-daily-report.csv",
        body: { attachmentId: "attachment-1" },
      },
    ],
    ...overrides,
  };
}

function mockMessageWithFrom(fromValue: string) {
  mockList.mockResolvedValue({ data: { messages: [{ id: "msg-1" }] } });
  mockGet.mockResolvedValue({
    data: { payload: messagePayload({ headers: [{ name: "From", value: fromValue }] }) },
  });
}

describe("getMostRecentLoseItCsv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.env.GMAIL_REFRESH_TOKEN = "test-refresh-token";
    process.env.GMAIL_CLIENT_ID = "test-client-id";
    process.env.GMAIL_CLIENT_SECRET = "test-client-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when the message list is empty", async () => {
    mockList.mockResolvedValue({ data: { messages: [] } });

    const result = await getMostRecentLoseItCsv();

    expect(result).toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("throws when the From header doesn't match donotreply@loseit.com", async () => {
    mockList.mockResolvedValue({ data: { messages: [{ id: "msg-1" }] } });
    mockGet.mockResolvedValue({
      data: {
        payload: messagePayload({
          headers: [{ name: "From", value: "someone-else@example.com" }],
        }),
      },
    });

    await expect(getMostRecentLoseItCsv()).rejects.toThrow(
      "Unexpected sender: someone-else@example.com",
    );
    expect(mockAttachmentsGet).not.toHaveBeenCalled();
  });

  it("throws when no .csv attachment is present", async () => {
    mockList.mockResolvedValue({ data: { messages: [{ id: "msg-1" }] } });
    mockGet.mockResolvedValue({
      data: {
        payload: messagePayload({
          parts: [{ filename: "receipt.pdf", body: { attachmentId: "attachment-1" } }],
        }),
      },
    });

    await expect(getMostRecentLoseItCsv()).rejects.toThrow(
      "No CSV attachment in LoseIt email",
    );
  });

  it("returns the decoded CSV text on the happy path", async () => {
    const csvText = "Date,Name\n08/01/2026,Chicken Breast\n";
    const base64UrlData = Buffer.from(csvText, "utf-8").toString("base64url");

    mockList.mockResolvedValue({ data: { messages: [{ id: "msg-1" }] } });
    mockGet.mockResolvedValue({ data: { payload: messagePayload() } });
    mockAttachmentsGet.mockResolvedValue({ data: { data: base64UrlData } });

    const result = await getMostRecentLoseItCsv();

    expect(result).toBe(csvText);
    expect(mockAttachmentsGet).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "msg-1", id: "attachment-1" }),
    );
  });

  describe("sender spoofing protection", () => {
    it('throws when the trusted address is only in the display name (From: "donotreply@loseit.com" <attacker@evil.com>)', async () => {
      mockMessageWithFrom('"donotreply@loseit.com" <attacker@evil.com>');

      await expect(getMostRecentLoseItCsv()).rejects.toThrow(
        "Unexpected sender:",
      );
      expect(mockAttachmentsGet).not.toHaveBeenCalled();
    });

    it("throws for a lookalike domain (From: donotreply@loseit.com.evil.com)", async () => {
      mockMessageWithFrom("donotreply@loseit.com.evil.com");

      await expect(getMostRecentLoseItCsv()).rejects.toThrow(
        "Unexpected sender:",
      );
      expect(mockAttachmentsGet).not.toHaveBeenCalled();
    });

    it("still passes for a legitimate display name (From: LoseIt Daily <donotreply@loseit.com>)", async () => {
      const csvText = "Date,Name\n08/02/2026,Oatmeal\n";
      const base64UrlData = Buffer.from(csvText, "utf-8").toString("base64url");

      mockMessageWithFrom("LoseIt Daily <donotreply@loseit.com>");
      mockAttachmentsGet.mockResolvedValue({ data: { data: base64UrlData } });

      const result = await getMostRecentLoseItCsv();

      expect(result).toBe(csvText);
    });
  });

  it("throws when a required env var is missing", async () => {
    delete process.env.GMAIL_CLIENT_ID;

    await expect(getMostRecentLoseItCsv()).rejects.toThrow("GMAIL_CLIENT_ID is not set.");
    expect(mockList).not.toHaveBeenCalled();
  });
});
