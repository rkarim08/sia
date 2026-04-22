import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFeedbackContext } from "../App";
import type { SearchResult } from "../lib/api";
import { searchNodes } from "../lib/api";
import type { SiaNodeType } from "../lib/constants";
import { NODE_COLORS } from "../lib/constants";

interface Props {
	onSelect: (nodeId: string) => void;
	onClose: () => void;
}

export default function SearchOverlay({ onSelect, onClose }: Props) {
	const isLarge = typeof window !== "undefined" && window.innerWidth >= 2000;
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<SearchResult[]>([]);
	const [loading, setLoading] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const feedback = useFeedbackContext();

	// Auto-focus input on mount
	useEffect(() => {
		inputRef.current?.focus();
	}, []);

	// Close on Escape
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onClose();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [onClose]);

	// Debounced search
	const doSearch = useCallback(async (q: string) => {
		if (!q.trim()) {
			setResults([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const res = await searchNodes(q, 15);
			setResults(res);
			setSelectedIndex(0);
		} catch {
			setResults([]);
		}
		setLoading(false);
	}, []);

	const grouped = useMemo(() => {
		const groups = new Map<string, SearchResult[]>();
		for (const r of results) {
			const key = r.type.toUpperCase();
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key)!.push(r);
		}
		return groups;
	}, [results]);

	const handleChange = (value: string) => {
		setQuery(value);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => doSearch(value), 300);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter" && results.length > 0) {
			e.preventDefault();
			const picked = results[selectedIndex];
			feedback?.recordSearchClick(picked.id, query);
			onSelect(picked.id);
			onClose();
		}
	};

	const handleResultClick = (nodeId: string) => {
		feedback?.recordSearchClick(nodeId, query);
		onSelect(nodeId);
		onClose();
	};

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 1000,
				display: "flex",
				alignItems: "flex-start",
				justifyContent: "center",
				paddingTop: "15vh",
			}}
		>
			<button
				type="button"
				aria-label="Close search"
				onClick={onClose}
				style={{
					position: "fixed",
					inset: 0,
					background: "rgba(0, 0, 0, 0.5)",
					backdropFilter: "blur(20px)",
					border: "none",
					padding: 0,
					cursor: "default",
				}}
			/>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Search"
				style={{
					position: "relative",
					width: isLarge ? 680 : 520,
					maxWidth: "90vw",
					background: "rgba(14,14,28,0.9)",
					border: "1px solid rgba(255,255,255,0.08)",
					borderRadius: 14,
					boxShadow: "0 32px 100px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
					backdropFilter: "blur(24px)",
					overflow: "hidden",
				}}
			>
				{/* Input */}
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 10,
						padding: "14px 16px",
						borderBottom: "1px solid rgba(255,255,255,0.08)",
					}}
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="#6b7a99"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
						role="presentation"
						aria-hidden="true"
					>
						<circle cx="11" cy="11" r="8" />
						<line x1="21" y1="21" x2="16.65" y2="16.65" />
					</svg>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => handleChange(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Try: 'decisions about auth' or 'bug in parser'"
						style={{
							flex: 1,
							background: "transparent",
							border: "none",
							outline: "none",
							color: "#e4e4ed",
							fontSize: isLarge ? 18 : 15,
							fontFamily: "inherit",
						}}
					/>
					<kbd
						style={{
							fontSize: 10,
							color: "#6b7a99",
							background: "rgba(255,255,255,0.06)",
							padding: "2px 6px",
							borderRadius: 4,
							border: "1px solid rgba(255,255,255,0.08)",
						}}
					>
						ESC
					</kbd>
				</div>

				{/* Results */}
				{loading && (
					<div style={{ padding: "12px 16px", color: "#6b7a99", fontSize: 13 }}>Searching...</div>
				)}

				{!loading && query.trim() && results.length === 0 && (
					<div style={{ padding: "12px 16px", color: "#6b7a99", fontSize: 13 }}>
						No results found
					</div>
				)}

				{!loading && !query.trim() && (
					<div style={{ padding: "16px", color: "#4d5a73", fontSize: 12 }}>
						<div style={{ marginBottom: 8, color: "#6b7a99" }}>Quick actions</div>
						<div>Type to search files, functions, decisions...</div>
					</div>
				)}

				{results.length > 0 && (
					<div style={{ maxHeight: 360, overflowY: "auto", padding: "6px 0" }}>
						{Array.from(grouped.entries()).map(([type, items]) => (
							<div key={type}>
								<div
									style={{
										padding: "6px 16px",
										fontSize: isLarge ? 12 : 9,
										color: "#4d5a73",
										textTransform: "uppercase",
										letterSpacing: "0.1em",
										fontWeight: 600,
									}}
								>
									{type}
								</div>
								{items.map((r) => {
									const globalIndex = results.indexOf(r);
									const isSelected = globalIndex === selectedIndex;
									const dotColor = NODE_COLORS[r.type as SiaNodeType] || "#666";
									return (
										<button
											type="button"
											key={r.id}
											onClick={() => handleResultClick(r.id)}
											onMouseEnter={() => setSelectedIndex(globalIndex)}
											style={{
												display: "flex",
												alignItems: "center",
												gap: 10,
												padding: "8px 16px",
												cursor: "pointer",
												background: isSelected ? "rgba(59,130,246,0.12)" : "transparent",
												transition: "background 0.1s",
												border: "none",
												width: "100%",
												textAlign: "left",
												color: "inherit",
												font: "inherit",
											}}
										>
											<span
												style={{
													width: 8,
													height: 8,
													borderRadius: "50%",
													background: dotColor,
													flexShrink: 0,
													boxShadow: `0 0 6px ${dotColor}40`,
												}}
											/>
											<div style={{ flex: 1, minWidth: 0 }}>
												<div
													style={{
														fontSize: isLarge ? 16 : 13,
														color: "#e4e4ed",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
													}}
												>
													{r.name}
												</div>
												<div
													style={{
														fontSize: isLarge ? 13 : 11,
														color: "#4d5a73",
														overflow: "hidden",
														textOverflow: "ellipsis",
														whiteSpace: "nowrap",
													}}
												>
													{r.path}
												</div>
											</div>
											<span
												style={{
													fontSize: isLarge ? 12 : 9,
													color: "#6b7a99",
													textTransform: "uppercase",
													letterSpacing: "0.5px",
													fontWeight: 600,
													flexShrink: 0,
													padding: "2px 6px",
													borderRadius: 4,
													background: "rgba(255,255,255,0.05)",
												}}
											>
												{r.type}
											</span>
										</button>
									);
								})}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
