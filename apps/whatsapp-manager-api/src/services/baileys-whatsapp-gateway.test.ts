import { mkdtemp, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaileysWhatsAppGateway } from "./baileys-whatsapp-gateway.js";

const baileysMocks = vi.hoisted(() => ({
  makeWASocket: vi.fn(() => ({
    ev: {
      on: vi.fn(),
    },
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
  useMultiFileAuthState: baileysMocks.useMultiFileAuthState,
}));

describe("BaileysWhatsAppGateway", () => {
  let tempDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
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
});
