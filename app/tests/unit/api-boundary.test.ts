import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the Tauri adapter's invoke at the module boundary.
vi.mock("../../src/api/tauri", () => ({
  tauriInvoke: vi.fn(),
  tauriInvokeVoid: vi.fn(),
  tauriListen: vi.fn().mockResolvedValue(() => {}),
  tauriConvertFileSrc: vi.fn().mockReturnValue("asset://localhost/test"),
}));

import { files, media, settings } from "../../src/api/index";
import { tauriInvoke, tauriInvokeVoid } from "../../src/api/tauri";

const mockInvoke = vi.mocked(tauriInvoke);
const mockInvokeVoid = vi.mocked(tauriInvokeVoid);

describe("Shelf Drive API boundary", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvokeVoid.mockReset();
  });

  it("files.list calls cmd_get_files with correct args", async () => {
    const fakeResult = { files: [], ownerId: "acc-1", hasMore: false };
    mockInvoke.mockResolvedValueOnce(fakeResult);

    const result = await files.list(42, "acc-1", "req-1");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_get_files", {
      folderId: 42,
      ownerId: "acc-1",
      requestId: "req-1",
    });
    expect(result).toEqual(fakeResult);
  });

  it("files.createFolder calls cmd_create_folder with name", async () => {
    const fakeFolder = { id: 1, name: "New Folder" };
    mockInvoke.mockResolvedValueOnce(fakeFolder);

    const result = await files.createFolder("New Folder");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_create_folder", { name: "New Folder" });
    expect(result).toEqual(fakeFolder);
  });

  it("files.deleteFile calls cmd_delete_file via tauriInvokeVoid", async () => {
    mockInvokeVoid.mockResolvedValueOnce(undefined);

    await files.deleteFile(42, null, "acc-1");

    expect(mockInvokeVoid).toHaveBeenCalledWith("cmd_delete_file", {
      messageId: 42,
      folderId: null,
      ownerId: "acc-1",
    });
  });

  it("media.getStreamInfo calls cmd_get_stream_info with fileId and folderId", async () => {
    const fakeStream = { token: "tok", base_url: "http://localhost:14201", operation_token: null };
    mockInvoke.mockResolvedValueOnce(fakeStream);

    const result = await media.getStreamInfo(42, "home");

    expect(mockInvoke).toHaveBeenCalledWith("cmd_get_stream_info", {
      fileId: 42,
      folderId: "home",
    });
    expect(result).toEqual(fakeStream);
  });

  it("media.getStreamInfo passes null folderId as 'home'", async () => {
    mockInvoke.mockResolvedValueOnce({ token: "t", base_url: "", operation_token: null });

    await media.getStreamInfo(1, null);

    expect(mockInvoke).toHaveBeenCalledWith("cmd_get_stream_info", {
      fileId: 1,
      folderId: "home",
    });
  });

  it("settings.getWebDav calls cmd_get_webdav_settings", async () => {
    const fakeSettings = {
      supported: true, enabled: false, running: false,
      port: 8551, token_set: false, webdav_url: "http://127.0.0.1:8551/dav/",
    };
    mockInvoke.mockResolvedValueOnce(fakeSettings);

    const result = await settings.getWebDav();

    expect(mockInvoke).toHaveBeenCalledWith("cmd_get_webdav_settings");
    expect(result).toEqual(fakeSettings);
  });

  it("errors propagate without swallowing", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("Rust error"));
    await expect(files.list(1, "acc", undefined)).rejects.toThrow("Rust error");
  });
});
