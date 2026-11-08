import { describe, expect, it } from "vitest";
import { MESSAGE, decodeMessage, encodeMessage, messageLength, socketPathOf, splitSignature } from "./dbus";

describe("D-Bus wire format", () => {
  it("splits signatures into complete types", () => {
    expect(splitSignature("sa{sv}as")).toEqual(["s", "a{sv}", "as"]);
    expect(splitSignature("a(yv)u")).toEqual(["a(yv)", "u"]);
    expect(() => splitSignature("a(s")).toThrow();
    expect(() => splitSignature("z")).toThrow();
  });

  it("round-trips a signal with nested containers", () => {
    const message = {
      type: MESSAGE.signal,
      flags: 0,
      path: "/quest/nuvo/Nuvo/Player",
      interface: "org.freedesktop.DBus.Properties",
      member: "PropertiesChanged",
      signature: "sa{sv}as",
      body: [
        "quest.nuvo.Nuvo.Player",
        [
          ["Liked", ["b", true]],
          ["LyricsLine", ["s", "Ünïcode line"]],
          ["Big", ["x", 2 ** 40]],
          ["Ratio", ["d", 0.5]],
        ],
        ["Gone"],
      ],
    };
    const bytes = encodeMessage(message, 7);
    expect(messageLength(bytes)).toBe(bytes.length);
    const decoded = decodeMessage(bytes);
    expect(decoded).toMatchObject({ ...message, serial: 7 });
  });

  it("waits for a whole fixed header and refuses huge or foreign messages", () => {
    expect(messageLength(Buffer.alloc(10))).toBeNull();
    const huge = encodeMessage({ type: MESSAGE.call, path: "/", member: "M" }, 1);
    huge.writeUInt32LE(64 << 20, 4);
    expect(() => messageLength(huge)).toThrow(/too large/);
    const foreign = Buffer.alloc(16, 0);
    foreign[0] = "x".charCodeAt(0);
    expect(() => messageLength(foreign)).toThrow(/byte order/);
  });

  it("finds the unix socket in a bus address", () => {
    expect(socketPathOf("unix:path=/run/user/1000/bus")).toBe("/run/user/1000/bus");
    expect(socketPathOf("tcp:host=x,port=1;unix:abstract=/tmp/dbus-a%2cb,guid=1")).toBe("\0/tmp/dbus-a,b");
    expect(socketPathOf("unix:path=/bad%zz")).toBeNull();
    expect(socketPathOf(undefined)).toBeNull();
  });
});
