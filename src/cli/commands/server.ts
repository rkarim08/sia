import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIA_HOME } from "@/shared/config";

const SERVER_DIR = join(SIA_HOME, "server");
const CONFIG_PATH = join(SERVER_DIR, "server.json");
const ENV_PATH = join(SERVER_DIR, ".env");
const COMPOSE_PATH = join(SERVER_DIR, "docker-compose.yml");

interface ServerConfig {
	url: string;
	running: boolean;
	startedAt: number | null;
}

function readConfig(): ServerConfig {
	if (!existsSync(CONFIG_PATH)) {
		return { url: "", running: false, startedAt: null };
	}
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as ServerConfig;
	} catch {
		return { url: "", running: false, startedAt: null };
	}
}

function writeServerConfig(config: ServerConfig): void {
	mkdirSync(SERVER_DIR, { recursive: true });
	writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

const COMPOSE_TEMPLATE = `version: "3.8"
services:
  sqld:
    image: ghcr.io/tursodatabase/libsql-server:latest
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - sqld-data:/var/lib/sqld
volumes:
  sqld-data:
`;

export function serverStart(opts?: { port?: number }): ServerConfig {
	const port = opts?.port ?? 8080;
	mkdirSync(SERVER_DIR, { recursive: true });

	// Generate JWT secret
	const jwtSecret = randomBytes(32).toString("hex");
	writeFileSync(ENV_PATH, `SQLD_AUTH_JWT_KEY=${jwtSecret}\n`, { encoding: "utf-8", mode: 0o600 });

	// Write docker-compose.yml
	const compose = COMPOSE_TEMPLATE.replace("8080:8080", `${port}:8080`);
	writeFileSync(COMPOSE_PATH, compose, "utf-8");

	// Start container
	try {
		execFileSync("docker", ["compose", "-f", COMPOSE_PATH, "up", "-d"], { stdio: "pipe" });
	} catch (err) {
		throw new Error(`Failed to start server: ${(err as Error).message}`);
	}

	const config: ServerConfig = {
		url: `http://localhost:${port}`,
		running: true,
		startedAt: Date.now(),
	};
	writeServerConfig(config);
	return config;
}

export function serverStop(): ServerConfig {
	try {
		if (existsSync(COMPOSE_PATH)) {
			execFileSync("docker", ["compose", "-f", COMPOSE_PATH, "down"], { stdio: "pipe" });
		}
	} catch {
		// Container may not be running
	}
	const config: ServerConfig = { url: "", running: false, startedAt: null };
	writeServerConfig(config);
	return config;
}

export function serverStatus(): ServerConfig {
	return readConfig();
}
