import { describe, expect, it } from "vitest";
import { parseEnvironmentDump, readLoginShellEnvironment } from "../src/main/login-shell-env";

const MARKER = "\0_ARCHITECT_SHELL_ENV_DELIMITER_\0";

describe("parseEnvironmentDump", () => {
  it("reads the environment between the markers and ignores prompt noise", () => {
    const output = `welcome to zsh\n${MARKER}PATH=/usr/local/bin:/usr/bin\0HOME=/Users/test\0${MARKER}logout`;
    expect(parseEnvironmentDump(output)).toEqual({
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/Users/test",
    });
  });

  it("keeps values that contain equals signs", () => {
    expect(parseEnvironmentDump(`${MARKER}TOKEN=a=b=c\0${MARKER}`)).toEqual({ TOKEN: "a=b=c" });
  });

  it("drops probe-shell and launcher-owned variables", () => {
    const dump = [
      MARKER,
      "PWD=/tmp",
      "OLDPWD=/old",
      "SHLVL=2",
      "_=/bin/zsh",
      "DISABLE_AUTO_UPDATE=true",
      "ZSH_TMUX_AUTOSTARTED=true",
      "ELECTRON_RUN_AS_NODE=1",
      "PATH=/bin",
      MARKER,
    ].join("\0");
    expect(parseEnvironmentDump(dump)).toEqual({ PATH: "/bin" });
  });

  it("returns an empty object for truncated or missing output", () => {
    expect(parseEnvironmentDump("")).toEqual({});
    expect(parseEnvironmentDump(`${MARKER}PATH=/bin\0`)).toEqual({});
  });

  it("skips entries without a key", () => {
    expect(parseEnvironmentDump(`${MARKER}=broken\0NOVALUE\0OK=1\0${MARKER}`)).toEqual({ OK: "1" });
  });
});

describe("readLoginShellEnvironment", () => {
  it("does not probe Windows", async () => {
    await expect(readLoginShellEnvironment({ platform: "win32" })).resolves.toBeNull();
  });

  it("honours an already aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readLoginShellEnvironment({ platform: "darwin", signal: controller.signal })
    ).resolves.toBeNull();
  });
});
