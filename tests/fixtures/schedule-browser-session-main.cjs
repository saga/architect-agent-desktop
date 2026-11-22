const assert = require("node:assert/strict");
const path = require("node:path");
const { readFile, mkdir, rm } = require("node:fs/promises");
const { createServer } = require("node:http");
const { app, session, BrowserWindow } = require("electron");
const {
  clearScheduleBrowserProfileData,
  scheduleBrowserPartition,
  scheduleBrowserDownloadPath,
  scheduleBrowserDownloadsDirectory,
} = require(path.resolve(__dirname, "../../dist/main/schedule-browser-profile.js"));

const userDataDirectory = process.argv[2];
const stage = process.argv[3];
if (!userDataDirectory || !stage) {
  throw new Error("Expected userData directory and integration stage arguments.");
}

app.disableHardwareAcceleration();
app.setPath("userData", userDataDirectory);

const COOKIE_URL = "https://schedule-session-isolation.invalid/";
const COOKIE_NAME = "architect-schedule-session";
const SCHEDULE_A = "integration-schedule-a";
const SCHEDULE_B = "integration-schedule-b";
const MAIN_PARTITION = "persist:architect-agent-browser";

function scheduleSession(scheduleId) {
  return session.fromPartition(scheduleBrowserPartition(scheduleId));
}

function readCookie(profile) {
  return profile.cookies.get({ url: COOKIE_URL, name: COOKIE_NAME }).then((cookies) => {
    const cookie = cookies.find((item) => item.name === COOKIE_NAME);
    return cookie ? cookie.value : null;
  });
}

async function writeCookie(profile, value) {
  await profile.cookies.set({
    url: COOKIE_URL,
    name: COOKIE_NAME,
    value,
    expirationDate: Math.floor(Date.now() / 1000) + 3600,
  });
  profile.flushStorageData();
}

async function run() {
  const profileA = scheduleSession(SCHEDULE_A);
  const profileB = scheduleSession(SCHEDULE_B);
  const ordinaryBrowser = session.fromPartition(MAIN_PARTITION);

  if (stage === "seed") {
    await writeCookie(profileA, "schedule-a");
    await writeCookie(profileB, "schedule-b");
    await writeCookie(ordinaryBrowser, "ordinary-browser");
    assert.equal(await readCookie(profileA), "schedule-a");
    assert.equal(await readCookie(profileB), "schedule-b");
    assert.equal(await readCookie(ordinaryBrowser), "ordinary-browser");
    return;
  }

  if (stage === "verify-and-reset") {
    assert.equal(await readCookie(profileA), "schedule-a", "Schedule A Cookie must survive an Electron process restart.");
    assert.equal(await readCookie(profileB), "schedule-b", "Schedule B Cookie must survive an Electron process restart.");
    assert.equal(await readCookie(ordinaryBrowser), "ordinary-browser", "Ordinary Browser Cookie must survive an Electron process restart.");

    await clearScheduleBrowserProfileData(profileA);
    assert.equal(await readCookie(profileA), null, "Reset must remove Schedule A Cookie.");
    assert.equal(await readCookie(profileB), "schedule-b", "Resetting Schedule A must not change Schedule B.");
    assert.equal(await readCookie(ordinaryBrowser), "ordinary-browser", "Resetting Schedule A must not change the ordinary Browser Profile.");
    return;
  }

  if (stage === "verify-reset-persisted") {
    assert.equal(await readCookie(profileA), null, "Schedule A reset must remain effective after another process restart.");
    assert.equal(await readCookie(profileB), "schedule-b", "Schedule B must remain persistent after Schedule A reset.");
    assert.equal(await readCookie(ordinaryBrowser), "ordinary-browser", "Ordinary Browser Profile must remain persistent after Schedule A reset.");
    return;
  }

  if (stage === "download") {
    const downloadsRoot = path.join(path.dirname(userDataDirectory), "downloads");
    const downloadDirectory = scheduleBrowserDownloadsDirectory(downloadsRoot, SCHEDULE_B);
    await mkdir(downloadDirectory, { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === "/page") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Schedule download integration</title><p>Ready</p>");
        return;
      }
      if (request.url === "/file") {
        response.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "content-disposition": 'attachment; filename="../../unsafe?report.txt"',
          "content-length": Buffer.byteLength("schedule-download-ok"),
        });
        response.end("schedule-download-ok");
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    const address = server.address();
    assert.ok(address && typeof address === "object", "Local test server must have a TCP address.");
    const window = new BrowserWindow({
      show: false,
      width: 640,
      height: 480,
      webPreferences: {
        session: profileB,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    try {
      await window.loadURL("http://127.0.0.1:" + address.port + "/page");
      const completed = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Schedule download did not finish within 15 seconds.")), 15_000);
        profileB.once("will-download", (_event, item) => {
          try {
            const savePath = scheduleBrowserDownloadPath(downloadDirectory, 1234, item.getFilename(), 5678);
            item.setSavePath(savePath);
            item.once("done", (_downloadEvent, state) => {
              clearTimeout(timer);
              resolve({ state, savePath });
            });
          } catch (error) {
            clearTimeout(timer);
            reject(error);
          }
        });
      });
      window.webContents.downloadURL("http://127.0.0.1:" + address.port + "/file");
      const result = await completed;
      assert.equal(result.state, "completed", "Unattended download must complete after an explicit save path is assigned.");
      assert.ok(result.savePath.startsWith(downloadDirectory + path.sep), "Download must stay inside the Schedule-specific directory.");
      assert.ok(!result.savePath.includes(".."), "Remote filename must not escape the Schedule directory.");
      assert.match(path.basename(result.savePath), /^5678-1234-/);
      assert.equal(await readFile(result.savePath, "utf8"), "schedule-download-ok");
    } finally {
      if (!window.isDestroyed()) window.destroy();
      await new Promise(resolve => server.close(resolve));
      await rm(downloadsRoot, { recursive: true, force: true });
    }
    return;
  }

  throw new Error("Unknown integration stage: " + stage);
}

app.whenReady().then(run).then(
  () => app.quit(),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  },
);
