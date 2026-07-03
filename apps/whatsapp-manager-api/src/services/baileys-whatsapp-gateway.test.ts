import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaileysWhatsAppGateway } from "./baileys-whatsapp-gateway.js";

const baileysMocks = vi.hoisted(() => ({
  eventHandlers: new Map<string, (payload: unknown) => void | Promise<void>>(),
  downloadMediaMessage: vi.fn(async () => Buffer.from("image-bytes")),
  makeWASocket: vi.fn(() => ({
    ev: {
      on: vi.fn((eventName: string, handler: (payload: unknown) => void | Promise<void>) => {
        baileysMocks.eventHandlers.set(eventName, handler);
      }),
    },
    updateMediaMessage: vi.fn(),
  })),
  saveCreds: vi.fn(),
  useMultiFileAuthState: vi.fn(async () => ({
    state: {},
    saveCreds: vi.fn(),
  })),
}));

vi.mock("@whiskeysockets/baileys", () => ({
  default: baileysMocks.makeWASocket,
  DisconnectReason: {
    loggedOut: 401,
  },
  downloadMediaMessage: baileysMocks.downloadMediaMessage,
  useMultiFileAuthState: baileysMocks.useMultiFileAuthState,
}));

describe("BaileysWhatsAppGateway", () => {
  let tempDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    baileysMocks.eventHandlers.clear();
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it("renames persisted pending auth state to the linked WhatsApp account id before initialization", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "baileys-state-"));
    tempDirs.push(stateDir);
    const pendingPath = path.join(stateDir, "pending-test");
    await mkdir(pendingPath);
    await writeFile(
      path.join(pendingPath, "creds.json"),
      JSON.stringify({ me: { id: "15551234567:9@s.whatsapp.net" } }),
    );

    const gateway = new BaileysWhatsAppGateway(stateDir);

    await vi.waitFor(() => {
      expect(baileysMocks.useMultiFileAuthState).toHaveBeenCalledWith(
        path.join(stateDir, "15551234567"),
      );
    });

    await expect(readdir(path.join(stateDir, "pending-test"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readdir(path.join(stateDir, "15551234567"))).resolves.toContain("creds.json");
    await expect(gateway.listAccounts()).resolves.toEqual([
      {
        accountId: "15551234567",
        status: "connecting",
      },
    ]);
  });

  it("downloads live media messages before emitting the sync event", async () => {
    const stateDir = await mkdtemp(path.join(tmpdir(), "baileys-state-"));
    const mediaDir = await mkdtemp(path.join(tmpdir(), "whatsapp-media-"));
    tempDirs.push(stateDir, mediaDir);
    const gateway = new BaileysWhatsAppGateway(stateDir, mediaDir);
    const syncEvents: unknown[] = [];
    gateway.onSyncEvent((event) => syncEvents.push(event));

    await gateway.initializeAccount("15551234567");

    const handler = baileysMocks.eventHandlers.get("messages.upsert");
    expect(handler).toBeDefined();
    const payload = {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: "15559876543@s.whatsapp.net",
            id: "image-message-1",
          },
          message: {
            imageMessage: {
              mimetype: "image/jpeg",
              caption: "stored image",
            },
          },
          messageTimestamp: 1_700_000_000,
        },
      ],
    };

    handler?.(payload);

    const media = payload.messages[0]!.message.imageMessage as {
      localPath?: string;
      localSha256?: string;
      localSize?: number;
    };
    await vi.waitFor(() => {
      expect(media.localPath).toContain(mediaDir);
      expect(syncEvents).toHaveLength(1);
    });

    expect(baileysMocks.downloadMediaMessage).toHaveBeenCalledOnce();
    expect(media.localPath).toContain(mediaDir);
    expect(media.localSha256).toBe(createHash("sha256").update("image-bytes").digest("hex"));
    expect(media.localSize).toBe(Buffer.byteLength("image-bytes"));
    await expect(readFile(media.localPath!, "utf8")).resolves.toBe("image-bytes");
  });
});
