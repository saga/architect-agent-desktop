const assert = require("node:assert/strict");
const path = require("node:path");
const { app, session } = require("electron");
const {
  clearScheduleBrowserProfileData,
  scheduleBrowserPartition,
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

  throw new Error("Unknown integration stage: " + stage);
}

app.whenReady().then(run).then(
  () => app.quit(),
  (error) => {
    console.error(error && error.stack ? error.stack : error);
    app.exit(1);
  },
);
