import { app } from "electron";
import path from "node:path";
import { loadEnvironmentFile } from "./env-file.js";

const environmentFile = app.isPackaged
  ? path.join(app.getPath("userData"), ".env")
  : path.join(app.getAppPath(), ".env");

loadEnvironmentFile(environmentFile);
