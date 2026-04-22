import { useEffect, useRef } from "react";

export interface ContextMenuItem {
	label: string;
	icon?: string;
	shortcut?: string;
	onClick: () => void;
	separator?: boolean;
}

interface Props {
	x: number;
	y: number;
	items: ContextMenuItem[];
	onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				onClose();
			}
		};
		const handleKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		// Use setTimeout so the current right-click event doesn't immediately close
		setTimeout(() => {
			window.addEventListener("mousedown", handleClick);
			window.addEventListener("keydown", handleKey);
		}, 0);
		return () => {
			window.removeEventListener("mousedown", handleClick);
			window.removeEventListener("keydown", handleKey);
		};
	}, [onClose]);

	// Adjust position to stay within viewport
	const adjustedX = Math.min(x, window.innerWidth - 200);
	const adjustedY = Math.min(y, window.innerHeight - items.length * 34 - 16);

	return (
		<div
			ref={menuRef}
			style={{
				position: "fixed",
				left: adjustedX,
				top: adjustedY,
				zIndex: 2000,
				minWidth: 180,
				background: "rgba(14,14,28,0.95)",
				backdropFilter: "blur(20px)",
				border: "1px solid rgba(255,255,255,0.1)",
				borderRadius: 10,
				boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
				padding: "4px 0",
				overflow: "hidden",
			}}
			onContextMenu={(e) => e.preventDefault()}
		>
			{items.map((item, i) => (
				<div key={i}>
					{item.separator && i > 0 && (
						<div
							style={{
								height: 1,
								background: "rgba(255,255,255,0.06)",
								margin: "4px 8px",
							}}
						/>
					)}
					<button
						onClick={() => {
							item.onClick();
							onClose();
						}}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							width: "100%",
							padding: "7px 14px",
							background: "transparent",
							border: "none",
							color: "#c8d0e0",
							fontSize: 12,
							cursor: "pointer",
							textAlign: "left",
							transition: "background 0.1s",
						}}
						onMouseEnter={(e) => {
							e.currentTarget.style.background = "rgba(59,130,246,0.15)";
						}}
						onMouseLeave={(e) => {
							e.currentTarget.style.background = "transparent";
						}}
					>
						{item.icon && (
							<span style={{ width: 16, textAlign: "center", fontSize: 13, flexShrink: 0 }}>
								{item.icon}
							</span>
						)}
						<span style={{ flex: 1 }}>{item.label}</span>
						{item.shortcut && (
							<span
								style={{
									fontSize: 10,
									color: "#4d5a73",
									fontFamily: '"JetBrains Mono", monospace',
									flexShrink: 0,
								}}
							>
								{item.shortcut}
							</span>
						)}
					</button>
				</div>
			))}
		</div>
	);
}
