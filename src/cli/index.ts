#!/usr/bin/env bun

import { runCommunityCommand } from "@/cli/commands/community";

const VERSION = "0.1.0";

function printHelp(): void {
        console.log(`sia v${VERSION} — Persistent graph memory for AI coding agents

Usage:
  sia <command> [options]

Commands:
  install              Install Sia in the current project
  workspace            Manage workspaces (create, list, add, remove, show)
  team                 Team sync (join, leave, status)
  search               Search the knowledge graph
  stats                Show graph statistics
  reindex              Re-index the repository
  community            Show community structure
  prune                Remove archived entities
  export               Export graph to JSON
  import               Import graph from JSON
  rollback             Restore graph from snapshot
  download-model       Download ONNX embedding model
  enable-flagging      Enable mid-session flagging
  disable-flagging     Disable mid-session flagging

Options:
  --version, -v        Show version
  --help, -h           Show this help
`);
}

async function main(): Promise<void> {
        const args = process.argv.slice(2);

        if (args.includes("--version") || args.includes("-v")) {
                console.log(`sia v${VERSION}`);
                return;
        }

        if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
                printHelp();
                return;
        }

        const command = args[0];
        const rest = args.slice(1);

        switch (command) {
                case "community":
                        await runCommunityCommand(rest);
                        return;
                default:
                        console.error(`Unknown command: ${command}. Run 'sia --help' for usage.`);
        }
}

main().catch((err) => {
        console.error(err);
        process.exit(1);
});
