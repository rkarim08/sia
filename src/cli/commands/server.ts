// Module: server — lightweight sqld server status tracker (placeholder)

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIA_HOME } from "@/shared/config";

const STATUS_PATH = join(SIA_HOME, "sqld.status");

type ServerState = "running" | "stopped";

function readState(): ServerState {
        if (!existsSync(STATUS_PATH)) return "stopped";
        const raw = readFileSync(STATUS_PATH, "utf-8").trim();
        return raw === "running" ? "running" : "stopped";
}

function writeState(state: ServerState): void {
        writeFileSync(STATUS_PATH, state, "utf-8");
}

export function serverStatus(): ServerState {
        return readState();
}

export function serverStart(): ServerState {
        writeState("running");
        return "running";
}

export function serverStop(): ServerState {
        writeState("stopped");
        return "stopped";
}
