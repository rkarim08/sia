// Tests for csharp-project extractor — C# code + .csproj dependency extraction

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock node:fs before importing the module under test
vi.mock("node:fs", () => ({
	existsSync: vi.fn(() => false),
	readFileSync: vi.fn(() => ""),
	readdirSync: vi.fn(() => []),
}));

import * as fs from "node:fs";
import { extractCSharpProject } from "@/ast/extractors/csharp-project";

const existsSyncMock = fs.existsSync as ReturnType<typeof vi.fn>;
const readFileSyncMock = fs.readFileSync as ReturnType<typeof vi.fn>;
const readdirSyncMock = fs.readdirSync as ReturnType<typeof vi.fn>;

describe("extractCSharpProject", () => {
	beforeEach(() => {
		existsSyncMock.mockReturnValue(false);
		readFileSyncMock.mockReturnValue("");
		readdirSyncMock.mockReturnValue([]);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("non-.cs files", () => {
		it("returns [] for non-.cs files", () => {
			const facts = extractCSharpProject("public class Foo {}", "/project/src/Foo.js", "/project");
			expect(facts).toEqual([]);
		});

		it("returns [] for empty content", () => {
			const facts = extractCSharpProject("", "/project/src/Foo.cs", "/project");
			expect(facts).toEqual([]);
		});
	});

	describe("Phase 1 — C# code extraction", () => {
		it("extracts class from .cs file", () => {
			const cs = `
using System;

namespace MyApp {
    public class UserService {
        // ...
    }
}
`;
			const facts = extractCSharpProject(cs, "/project/src/UserService.cs", "/project");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("UserService");
			for (const f of classes) {
				expect(f.type).toBe("CodeEntity");
				expect(f.trust_tier).toBe(2);
				expect(f.confidence).toBe(0.92);
				expect(f.tags).toContain("csharp");
				expect(f.file_paths).toContain("/project/src/UserService.cs");
			}
		});

		it("extracts method with access modifier", () => {
			const cs = `
public class Service {
    public void Start() { }
    private int Calculate(int x) { return x; }
    protected async Task<string> FetchAsync() { return ""; }
}
`;
			const facts = extractCSharpProject(cs, "/project/src/Service.cs", "/project");
			const methods = facts.filter((f) => f.tags.includes("method"));
			const names = methods.map((f) => f.name);
			expect(names).toContain("Start");
			expect(names).toContain("Calculate");
			expect(names).toContain("FetchAsync");
			for (const m of methods) {
				expect(m.type).toBe("CodeEntity");
				expect(m.trust_tier).toBe(2);
				expect(m.confidence).toBe(0.92);
				expect(m.tags).toContain("csharp");
			}
		});

		it("extracts interface", () => {
			const cs = `
public interface IRepository {
    void Save(object entity);
    object Find(int id);
}
`;
			const facts = extractCSharpProject(cs, "/project/src/IRepository.cs", "/project");
			const interfaces = facts.filter((f) => f.tags.includes("class"));
			const names = interfaces.map((f) => f.name);
			expect(names).toContain("IRepository");
		});

		it("extracts struct and enum", () => {
			const cs = `
public struct Point { public int X; public int Y; }
public enum Status { Active, Inactive }
`;
			const facts = extractCSharpProject(cs, "/project/src/Types.cs", "/project");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("Point");
			expect(names).toContain("Status");
		});

		it("extracts using statements", () => {
			const cs = `
using System;
using System.Collections.Generic;
using Newtonsoft.Json;
`;
			const facts = extractCSharpProject(cs, "/project/src/Program.cs", "/project");
			const usings = facts.filter((f) => f.tags.includes("using"));
			const names = usings.map((f) => f.name);
			expect(names).toContain("System");
			expect(names).toContain("System.Collections.Generic");
			expect(names).toContain("Newtonsoft.Json");
			for (const u of usings) {
				expect(u.type).toBe("CodeEntity");
				expect(u.trust_tier).toBe(2);
				expect(u.confidence).toBe(0.92);
			}
		});

		it("extracts property with getter/setter", () => {
			const cs = `
public class MyClass {
    public string Name { get; set; }
    private int _count { get; private set; }
}
`;
			const facts = extractCSharpProject(cs, "/project/src/MyClass.cs", "/project");
			const props = facts.filter((f) => f.tags.includes("property"));
			const names = props.map((f) => f.name);
			expect(names).toContain("Name");
		});
	});

	describe("Phase 2 — .csproj dependency extraction", () => {
		const csprojContent = `
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="../Shared/Shared.csproj" />
    <ProjectReference Include="../Core/Core.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
    <PackageReference Include="Serilog" Version="3.1.1" />
    <PackageReference Include="Microsoft.Extensions.DependencyInjection" />
  </ItemGroup>
</Project>
`;

		it("extracts ProjectReference from adjacent .csproj", () => {
			// Simulate finding a .csproj in the same directory
			readdirSyncMock.mockImplementation((dir) => {
				if (String(dir) === "/project/src")
					return ["MyApp.csproj", "Service.cs"] as unknown as ReturnType<typeof fs.readdirSync>;
				return [] as unknown as ReturnType<typeof fs.readdirSync>;
			});
			existsSyncMock.mockImplementation((p) => {
				return String(p) === "/project/src/MyApp.csproj";
			});
			readFileSyncMock.mockImplementation((p) => {
				if (String(p) === "/project/src/MyApp.csproj") return csprojContent;
				return "";
			});

			const facts = extractCSharpProject(
				"public class Service {}",
				"/project/src/Service.cs",
				"/project",
			);
			const projectRefs = facts.filter((f) => f.tags.includes("project-reference"));
			const names = projectRefs.map((f) => f.name);
			expect(names).toContain("../Shared/Shared.csproj");
			expect(names).toContain("../Core/Core.csproj");
			for (const ref of projectRefs) {
				expect(ref.type).toBe("Dependency");
				expect(ref.tags).toContain("csharp");
				expect(ref.trust_tier).toBe(2);
				expect(ref.confidence).toBe(0.9);
				expect(ref.extraction_method).toBe("csharp-project");
			}
		});

		it("extracts PackageReference with version", () => {
			readdirSyncMock.mockImplementation((dir) => {
				if (String(dir) === "/project/src")
					return ["MyApp.csproj", "Service.cs"] as unknown as ReturnType<typeof fs.readdirSync>;
				return [] as unknown as ReturnType<typeof fs.readdirSync>;
			});
			existsSyncMock.mockImplementation((p) => {
				return String(p) === "/project/src/MyApp.csproj";
			});
			readFileSyncMock.mockImplementation((p) => {
				if (String(p) === "/project/src/MyApp.csproj") return csprojContent;
				return "";
			});

			const facts = extractCSharpProject(
				"public class Service {}",
				"/project/src/Service.cs",
				"/project",
			);
			const pkgRefs = facts.filter((f) => f.tags.includes("package-reference"));
			const names = pkgRefs.map((f) => f.name);
			expect(names).toContain("Newtonsoft.Json");
			expect(names).toContain("Serilog");
			expect(names).toContain("Microsoft.Extensions.DependencyInjection");

			const newtonsoftFact = pkgRefs.find((f) => f.name === "Newtonsoft.Json");
			expect(newtonsoftFact).toBeDefined();
			expect(newtonsoftFact?.content).toContain("13.0.3");
			expect(newtonsoftFact?.tags).toContain("nuget");
			expect(newtonsoftFact?.tags).toContain("csharp");
			expect(newtonsoftFact?.type).toBe("Dependency");
			expect(newtonsoftFact?.trust_tier).toBe(2);
			expect(newtonsoftFact?.confidence).toBe(0.9);
			expect(newtonsoftFact?.extraction_method).toBe("csharp-project");
		});

		it("PackageReference without version still extracted", () => {
			readdirSyncMock.mockImplementation((dir) => {
				if (String(dir) === "/project/src")
					return ["MyApp.csproj", "Service.cs"] as unknown as ReturnType<typeof fs.readdirSync>;
				return [] as unknown as ReturnType<typeof fs.readdirSync>;
			});
			existsSyncMock.mockImplementation((p) => {
				return String(p) === "/project/src/MyApp.csproj";
			});
			readFileSyncMock.mockImplementation((p) => {
				if (String(p) === "/project/src/MyApp.csproj") return csprojContent;
				return "";
			});

			const facts = extractCSharpProject(
				"public class Service {}",
				"/project/src/Service.cs",
				"/project",
			);
			const pkgRefs = facts.filter((f) => f.tags.includes("package-reference"));
			const noVersion = pkgRefs.find((f) => f.name === "Microsoft.Extensions.DependencyInjection");
			expect(noVersion).toBeDefined();
		});

		it("walks UP directories to find .csproj (not just same dir)", () => {
			// .csproj in parent directory, not same dir
			readdirSyncMock.mockImplementation((dir) => {
				if (String(dir) === "/project/src")
					return ["Service.cs"] as unknown as ReturnType<typeof fs.readdirSync>;
				if (String(dir) === "/project")
					return ["MyApp.csproj", "src"] as unknown as ReturnType<typeof fs.readdirSync>;
				return [] as unknown as ReturnType<typeof fs.readdirSync>;
			});
			existsSyncMock.mockImplementation((p) => {
				return String(p) === "/project/MyApp.csproj";
			});
			readFileSyncMock.mockImplementation((p) => {
				if (String(p) === "/project/MyApp.csproj") {
					return `<Project><ItemGroup><PackageReference Include="Serilog" Version="3.1.1" /></ItemGroup></Project>`;
				}
				return "";
			});

			const facts = extractCSharpProject(
				"public class Service {}",
				"/project/src/Service.cs",
				"/project",
			);
			const pkgRefs = facts.filter((f) => f.tags.includes("package-reference"));
			expect(pkgRefs.map((f) => f.name)).toContain("Serilog");
		});

		it("returns [] (no error) when .csproj not found", () => {
			// existsSync returns false by default (set in beforeEach)
			// readdirSync returns [] by default

			const facts = extractCSharpProject(
				"public class Service {}",
				"/project/src/Service.cs",
				"/project",
			);
			// Should still get CodeEntity facts from Phase 1
			const deps = facts.filter((f) => f.type === "Dependency");
			expect(deps).toEqual([]);
			// No error thrown
		});

		it("returns [] for Phase 2 when repoRoot is not provided", () => {
			// No repoRoot — should still work for Phase 1
			const cs = "public class Foo {}";
			expect(() => extractCSharpProject(cs, "/project/src/Foo.cs")).not.toThrow();
		});
	});

	describe("edge cases", () => {
		it("deduplicates extracted names", () => {
			const cs = `
public class Foo {}
public class Foo {}
`;
			const facts = extractCSharpProject(cs, "/project/src/Foo.cs", "/project");
			const foos = facts.filter((f) => f.name === "Foo" && f.tags.includes("class"));
			expect(foos.length).toBe(1);
		});

		it("file_paths contains filePath for all CodeEntity facts", () => {
			const cs = `
using System;
public class Bar {}
public void DoWork() {}
`;
			const facts = extractCSharpProject(cs, "/project/src/Bar.cs", "/project");
			const codeEntities = facts.filter((f) => f.type === "CodeEntity");
			for (const f of codeEntities) {
				expect(f.file_paths).toContain("/project/src/Bar.cs");
			}
		});
	});
});
