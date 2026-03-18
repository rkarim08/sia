import { describe, expect, it } from "vitest";
import { extractTierB } from "@/ast/extractors/tier-b";

describe("extractTierB", () => {
	describe("C (.c, .h)", () => {
		it("extracts function with return type", () => {
			const c = `
#include <stdio.h>
#include <stdlib.h>

int main(int argc, char *argv[]) {
    printf("hello");
    return 0;
}

void process_data(const char *input) {
    // processing
}
`;
			const facts = extractTierB(c, "src/main.c");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("main");
			expect(names).toContain("process_data");
			for (const fn of fns) {
				expect(fn.type).toBe("CodeEntity");
				expect(fn.tags).toContain("c");
				expect(fn.trust_tier).toBe(2);
				expect(fn.confidence).toBe(0.92);
				expect(fn.extraction_method).toBe("tree-sitter");
				expect(fn.file_paths).toEqual(["src/main.c"]);
			}
		});

		it("extracts struct and typedef", () => {
			const c = `
struct Point {
    int x;
    int y;
};

typedef struct {
    float r, g, b;
} Color;

union Data {
    int i;
    float f;
};
`;
			const facts = extractTierB(c, "include/types.h");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("Point");
			expect(names).toContain("Color");
			expect(names).toContain("Data");
		});

		it("extracts #include", () => {
			const c = `
#include <stdio.h>
#include "myheader.h"
`;
			const facts = extractTierB(c, "src/main.c");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("stdio.h");
			expect(names).toContain("myheader.h");
		});
	});

	describe("C++ (.cpp, .cc, .cxx, .hpp, .hxx)", () => {
		it("extracts class and namespace", () => {
			const cpp = `
#include <string>
using namespace std;

namespace MyLib {

class Widget {
public:
    Widget(int id);
    void render();
private:
    int m_id;
};

}
`;
			const facts = extractTierB(cpp, "src/widget.cpp");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("Widget");
			expect(names).toContain("MyLib");
			for (const f of facts) {
				expect(f.tags).toContain("cpp");
			}
		});

		it("extracts methods and templates", () => {
			const cpp = `
template<typename T>
T max_val(T a, T b) {
    return a > b ? a : b;
}

void Widget::render() {
    // rendering
}
`;
			const facts = extractTierB(cpp, "src/widget.cpp");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("max_val");
			expect(names).toContain("render");
		});

		it("extracts #include and using", () => {
			const cpp = `
#include <vector>
#include "myclass.hpp"
using std::string;
using namespace std;
`;
			const facts = extractTierB(cpp, "src/main.cpp");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("vector");
			expect(names).toContain("myclass.hpp");
		});
	});

	describe("C# (.cs)", () => {
		it("extracts class, interface, struct, enum", () => {
			const cs = `
using System;
using System.Collections.Generic;

namespace MyApp {

public class UserService {
    public List<User> GetAll() {
        return new List<User>();
    }

    private void Validate(User user) {
        // validation
    }
}

public interface IRepository {
    void Save(object entity);
}

public struct Point {
    public int X;
    public int Y;
}

public enum Status {
    Active,
    Inactive
}

}
`;
			const facts = extractTierB(cs, "Services/UserService.cs");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("UserService");
			expect(classNames).toContain("IRepository");
			expect(classNames).toContain("Point");
			expect(classNames).toContain("Status");

			for (const f of facts) {
				expect(f.tags).toContain("csharp");
			}
		});

		it("extracts methods with access modifiers", () => {
			const cs = `
public class Service {
    public void Start() { }
    private int Calculate(int x) { return x; }
    protected static string Format(object o) { return o.ToString(); }
}
`;
			const facts = extractTierB(cs, "Service.cs");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("Start");
			expect(names).toContain("Calculate");
			expect(names).toContain("Format");
		});

		it("extracts using statements", () => {
			const cs = `
using System;
using System.Collections.Generic;
using Newtonsoft.Json;
`;
			const facts = extractTierB(cs, "Program.cs");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("System");
		});
	});

	describe("Bash (.sh, .bash)", () => {
		it("extracts function keyword syntax", () => {
			const bash = `
#!/bin/bash

source ./utils.sh
. ./config.sh

function setup_env {
    export PATH="$HOME/bin:$PATH"
}

cleanup() {
    rm -rf /tmp/build
}
`;
			const facts = extractTierB(bash, "deploy.sh");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("setup_env");
			expect(names).toContain("cleanup");
			for (const f of fns) {
				expect(f.tags).toContain("bash");
			}
		});

		it("extracts source/dot imports", () => {
			const bash = `
source ./utils.sh
. ./config.sh
`;
			const facts = extractTierB(bash, "run.sh");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("./utils.sh");
			expect(names).toContain("./config.sh");
		});

		it("has no class extraction", () => {
			const bash = `
function greet {
    echo "hello"
}
`;
			const facts = extractTierB(bash, "test.sh");
			const classes = facts.filter((f) => f.tags.includes("class"));
			expect(classes.length).toBe(0);
		});
	});

	describe("Lua (.lua)", () => {
		it("extracts function and local function", () => {
			const lua = `
local json = require("cjson")

function greet(name)
    print("Hello, " .. name)
end

local function helper(x)
    return x * 2
end
`;
			const facts = extractTierB(lua, "main.lua");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("greet");
			expect(names).toContain("helper");
			for (const f of fns) {
				expect(f.tags).toContain("lua");
			}
		});

		it("extracts require", () => {
			const lua = `
local json = require("cjson")
local utils = require("app.utils")
`;
			const facts = extractTierB(lua, "init.lua");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("cjson");
			expect(names).toContain("app.utils");
		});
	});

	describe("Zig (.zig)", () => {
		it("extracts pub fn and fn", () => {
			const zig = `
const std = @import("std");

pub fn main() !void {
    const stdout = std.io.getStdOut().writer();
    try stdout.print("Hello", .{});
}

fn helper(x: u32) u32 {
    return x + 1;
}
`;
			const facts = extractTierB(zig, "src/main.zig");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("main");
			expect(names).toContain("helper");
			for (const f of fns) {
				expect(f.tags).toContain("zig");
			}
		});

		it("extracts struct, enum, union", () => {
			const zig = `
const Point = struct {
    x: f32,
    y: f32,
};

const Direction = enum {
    north,
    south,
};

const Value = union(enum) {
    int: i32,
    float: f64,
};
`;
			const facts = extractTierB(zig, "src/types.zig");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("Point");
			expect(names).toContain("Direction");
			expect(names).toContain("Value");
		});

		it("extracts @import", () => {
			const zig = `
const std = @import("std");
const math = @import("math");
`;
			const facts = extractTierB(zig, "main.zig");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("std");
			expect(names).toContain("math");
		});
	});

	describe("Perl (.pl, .pm)", () => {
		it("extracts sub", () => {
			const perl = `
use strict;
use warnings;
use Data::Dumper;

package MyModule;

sub new {
    my ($class, %args) = @_;
    return bless \\%args, $class;
}

sub process {
    my ($self, $data) = @_;
    return $data;
}
`;
			const facts = extractTierB(perl, "lib/MyModule.pm");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("new");
			expect(names).toContain("process");
			for (const f of fns) {
				expect(f.tags).toContain("perl");
			}
		});

		it("extracts package", () => {
			const perl = `
package MyApp::Util;
`;
			const facts = extractTierB(perl, "lib/Util.pm");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("MyApp::Util");
		});

		it("extracts use and require", () => {
			const perl = `
use strict;
use Data::Dumper;
require "helper.pl";
`;
			const facts = extractTierB(perl, "script.pl");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("strict");
			expect(names).toContain("Data::Dumper");
		});
	});

	describe("R (.r, .R)", () => {
		it("extracts name <- function", () => {
			const r = `
library(ggplot2)
require(dplyr)

process_data <- function(data) {
    data %>% filter(!is.na(value))
}

compute = function(x, y) {
    x + y
}
`;
			const facts = extractTierB(r, "analysis.R");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("process_data");
			expect(names).toContain("compute");
			for (const f of fns) {
				expect(f.tags).toContain("r");
			}
		});

		it("extracts library and require", () => {
			const r = `
library(ggplot2)
require(dplyr)
`;
			const facts = extractTierB(r, "script.r");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("ggplot2");
			expect(names).toContain("dplyr");
		});
	});

	describe("OCaml (.ml, .mli)", () => {
		it("extracts let and let rec", () => {
			const ml = `
open Printf

module Config = struct
  let default_port = 8080
end

let greet name =
  printf "Hello, %s\\n" name

let rec factorial n =
  if n <= 1 then 1 else n * factorial (n - 1)

type shape = Circle of float | Rect of float * float
`;
			const facts = extractTierB(ml, "src/main.ml");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("greet");
			expect(names).toContain("factorial");
			for (const f of fns) {
				expect(f.tags).toContain("ocaml");
			}
		});

		it("extracts module", () => {
			const ml = `
module Config = struct
  let port = 8080
end

module type Printable = sig
  val to_string : t -> string
end
`;
			const facts = extractTierB(ml, "lib.ml");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("Config");
			expect(names).toContain("Printable");
		});

		it("extracts open", () => {
			const ml = `
open Printf
open Lwt.Infix
`;
			const facts = extractTierB(ml, "main.ml");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("Printf");
		});
	});

	describe("Haskell (.hs)", () => {
		it("extracts data and newtype declarations", () => {
			const hs = `
module Main where

import Data.Map (Map, fromList)
import qualified Data.Text as T

data Color = Red | Green | Blue

newtype Name = Name String

class Printable a where
    display :: a -> String

instance Printable Color where
    display Red = "red"
    display Green = "green"
    display Blue = "blue"

greet :: String -> IO ()
greet name = putStrLn ("Hello, " ++ name)
`;
			const facts = extractTierB(hs, "src/Main.hs");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("Color");
			expect(names).toContain("Name");
			for (const f of facts) {
				expect(f.tags).toContain("haskell");
			}
		});

		it("extracts import", () => {
			const hs = `
import Data.Map (Map, fromList)
import qualified Data.Text as T
`;
			const facts = extractTierB(hs, "App.hs");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("Data.Map");
			expect(names).toContain("Data.Text");
		});

		it("extracts type-signature functions", () => {
			const hs = `
greet :: String -> IO ()
greet name = putStrLn ("Hello, " ++ name)

add :: Int -> Int -> Int
add x y = x + y
`;
			const facts = extractTierB(hs, "Lib.hs");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("greet");
			expect(names).toContain("add");
		});
	});

	describe("edge cases", () => {
		it("returns [] for unknown extension", () => {
			const facts = extractTierB("some content", "file.unknown");
			expect(facts).toEqual([]);
		});

		it("returns [] for empty content", () => {
			const facts = extractTierB("", "main.c");
			expect(facts).toEqual([]);
		});

		it("returns [] for no extension", () => {
			const facts = extractTierB("int main() {}", "Makefile");
			expect(facts).toEqual([]);
		});

		it("never produces call-tagged facts", () => {
			const c = `
#include <stdio.h>

int main() {
    printf("hello");
    return 0;
}
`;
			const facts = extractTierB(c, "main.c");
			const calls = facts.filter((f) => f.tags.includes("call"));
			expect(calls.length).toBe(0);
		});

		it("deduplicates by name+category", () => {
			const c = `
void foo(int x) { }
void foo(float y) { }
`;
			const facts = extractTierB(c, "test.c");
			const fooFns = facts.filter((f) => f.name === "foo" && f.tags.includes("function"));
			expect(fooFns.length).toBe(1);
		});

		it("content field contains surrounding lines", () => {
			const c = `line1
line2
int process(int data) {
    return data + 1;
}
line6`;
			const facts = extractTierB(c, "test.c");
			const fn = facts.find((f) => f.name === "process" && f.tags.includes("function"));
			expect(fn).toBeDefined();
			expect(fn?.content).toContain("process");
			expect(fn?.content.length).toBeGreaterThan(0);
		});
	});
});
