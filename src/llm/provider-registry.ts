/** Roles an LLM provider can fulfil within the Sia pipeline. */
export type OperationRole = "extract" | "consolidate" | "summarize" | "validate";

/** How raw knowledge enters the graph. */
export type CaptureMode = "hooks" | "api" | "hybrid";

/** Provider + model pair for a specific role. */
export interface ProviderConfig {
	provider: string; // "anthropic" | "openai" | "google" | "ollama"
	model: string;
}

/**
 * Registry that maps each OperationRole to a ProviderConfig.
 * Determines which roles are active based on the current CaptureMode.
 */
export class ProviderRegistry {
	private configs = new Map<OperationRole, ProviderConfig>();
	private captureMode: CaptureMode = "hooks";

	setCaptureMode(mode: CaptureMode): void {
		this.captureMode = mode;
	}

	getCaptureMode(): CaptureMode {
		return this.captureMode;
	}

	setProvider(role: OperationRole, config: ProviderConfig): void {
		this.configs.set(role, config);
	}

	getProvider(role: OperationRole): ProviderConfig | undefined {
		return this.configs.get(role);
	}

	/**
	 * Whether a role is active given the current capture mode.
	 * In hooks mode, extract and consolidate are dormant (handled by the host agent).
	 * In api or hybrid mode, all roles are active.
	 */
	isRoleActive(role: OperationRole): boolean {
		if (this.captureMode === "api") return true;
		if (this.captureMode === "hooks") {
			return role === "summarize" || role === "validate";
		}
		// hybrid: all active
		return true;
	}

	/** Get all configured providers for diagnostics. */
	getAll(): Map<OperationRole, ProviderConfig> {
		return new Map(this.configs);
	}
}
