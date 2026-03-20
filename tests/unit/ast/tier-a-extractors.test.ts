import { describe, expect, it } from "vitest";
import { extractTierA } from "@/ast/extractors/tier-a";

describe("extractTierA", () => {
	describe("TypeScript (.ts)", () => {
		const tsCode = `
import { foo } from "./bar";
import * as path from "node:path";

export async function fetchData(url: string): Promise<void> {
  const result = await fetch(url);
  return result.json();
}

const helper = (x: number) => x + 1;

export class UserService {
  private db: Database;

  async getUser(id: string) {
    return this.db.query(id);
  }
}

interface Config {
  host: string;
  port: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

enum Status {
  Active,
  Inactive,
}

const data = fetchData("https://example.com");
const user = new UserService();
const name = user.getUser("123");
`;

		it("extracts function declarations", () => {
			const facts = extractTierA(tsCode, "src/services/api.ts");
			const fns = facts.filter((f) => f.tags.includes("function"));
			const names = fns.map((f) => f.name);
			expect(names).toContain("fetchData");
			expect(names).toContain("helper");
			for (const fn of fns) {
				expect(fn.type).toBe("CodeEntity");
				expect(fn.tags).toContain("typescript");
				expect(fn.trust_tier).toBe(2);
				expect(fn.confidence).toBe(0.92);
				expect(fn.extraction_method).toBe("regex-ast");
				expect(fn.file_paths).toEqual(["src/services/api.ts"]);
			}
		});

		it("extracts class, interface, type, enum declarations", () => {
			const facts = extractTierA(tsCode, "src/services/api.ts");
			const classes = facts.filter((f) => f.tags.includes("class"));
			const names = classes.map((f) => f.name);
			expect(names).toContain("UserService");
			expect(names).toContain("Config");
			expect(names).toContain("Result");
			expect(names).toContain("Status");
		});

		it("extracts import statements", () => {
			const facts = extractTierA(tsCode, "src/services/api.ts");
			const imports = facts.filter((f) => f.tags.includes("import"));
			const names = imports.map((f) => f.name);
			expect(names).toContain("foo");
			expect(names).toContain("path");
		});

		it("extracts function calls", () => {
			const facts = extractTierA(tsCode, "src/services/api.ts");
			const calls = facts.filter((f) => f.tags.includes("call"));
			const names = calls.map((f) => f.name);
			expect(names).toContain("fetchData");
			expect(names).toContain("UserService");
		});

		it("sets correct summary format", () => {
			const facts = extractTierA(tsCode, "src/services/api.ts");
			const fn = facts.find((f) => f.name === "fetchData" && f.tags.includes("function"));
			expect(fn?.summary).toBe("function fetchData in api.ts");
		});
	});

	describe("TSX (.tsx)", () => {
		it("extracts from tsx files same as ts", () => {
			const tsx = `
import React from "react";

export function App() {
  return <div>Hello</div>;
}

class Component extends React.Component {}
`;
			const facts = extractTierA(tsx, "src/App.tsx");
			const names = facts.map((f) => f.name);
			expect(names).toContain("App");
			expect(names).toContain("Component");
			expect(names).toContain("React");
		});
	});

	describe("JavaScript (.js)", () => {
		it("extracts function and class declarations", () => {
			const js = `
import { readFile } from "fs";

function processData(input) {
  return input.map(transform);
}

class DataProcessor {
  constructor(config) {
    this.config = config;
  }
}

const result = processData([1, 2, 3]);
`;
			const facts = extractTierA(js, "lib/process.js");
			const fns = facts.filter((f) => f.tags.includes("function"));
			expect(fns.map((f) => f.name)).toContain("processData");

			const classes = facts.filter((f) => f.tags.includes("class"));
			expect(classes.map((f) => f.name)).toContain("DataProcessor");

			const imports = facts.filter((f) => f.tags.includes("import"));
			expect(imports.map((f) => f.name)).toContain("readFile");

			// Verify tags include language
			for (const f of facts) {
				expect(f.tags).toContain("javascript");
			}
		});
	});

	describe("JSX (.jsx)", () => {
		it("extracts from jsx files same as js", () => {
			const jsx = `
import React from "react";

function Button({ label }) {
  return <button>{label}</button>;
}
`;
			const facts = extractTierA(jsx, "src/Button.jsx");
			const names = facts.map((f) => f.name);
			expect(names).toContain("Button");
			expect(names).toContain("React");
			for (const f of facts) {
				expect(f.tags).toContain("jsx");
			}
		});
	});

	describe("Python (.py)", () => {
		it("extracts def and async def", () => {
			const py = `
from typing import List
import os

def process_data(items: List[str]) -> None:
    for item in items:
        print(item)

async def fetch_url(url: str) -> bytes:
    pass

class DataHandler:
    def __init__(self):
        self.data = []

    def handle(self, item):
        self.data.append(item)
`;
			const facts = extractTierA(py, "app/handler.py");

			const fns = facts.filter((f) => f.tags.includes("function"));
			const fnNames = fns.map((f) => f.name);
			expect(fnNames).toContain("process_data");
			expect(fnNames).toContain("fetch_url");

			const classes = facts.filter((f) => f.tags.includes("class"));
			expect(classes.map((f) => f.name)).toContain("DataHandler");

			const imports = facts.filter((f) => f.tags.includes("import"));
			const importNames = imports.map((f) => f.name);
			expect(importNames).toContain("List");
			expect(importNames).toContain("os");

			for (const f of facts) {
				expect(f.tags).toContain("python");
			}
		});
	});

	describe("Go (.go)", () => {
		it("extracts func and type struct", () => {
			const go = `
package main

import (
	"fmt"
	"net/http"
)

type Server struct {
	Host string
	Port int
}

type Handler interface {
	Handle(r *http.Request)
}

func NewServer(host string, port int) *Server {
	return &Server{Host: host, Port: port}
}

func (s *Server) Start() {
	fmt.Println("Starting server")
}
`;
			const facts = extractTierA(go, "cmd/server.go");

			const fns = facts.filter((f) => f.tags.includes("function"));
			const fnNames = fns.map((f) => f.name);
			expect(fnNames).toContain("NewServer");
			expect(fnNames).toContain("Start");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("Server");
			expect(classNames).toContain("Handler");

			const imports = facts.filter((f) => f.tags.includes("import"));
			const importNames = imports.map((f) => f.name);
			expect(importNames).toContain("fmt");
			expect(importNames).toContain("net/http");

			for (const f of facts) {
				expect(f.tags).toContain("go");
			}
		});
	});

	describe("Rust (.rs)", () => {
		it("extracts pub fn, struct, enum, trait, impl, use", () => {
			const rs = `
use std::collections::HashMap;
mod utils;

pub struct Config {
    pub host: String,
    pub port: u16,
}

enum Status {
    Active,
    Inactive,
}

trait Configurable {
    fn configure(&mut self);
}

impl Configurable for Config {
    fn configure(&mut self) {
        self.port = 8080;
    }
}

pub fn create_config() -> Config {
    Config {
        host: "localhost".to_string(),
        port: 3000,
    }
}

pub async fn serve(config: &Config) {
    println!("Serving on {}:{}", config.host, config.port);
}
`;
			const facts = extractTierA(rs, "src/config.rs");

			const fns = facts.filter((f) => f.tags.includes("function"));
			const fnNames = fns.map((f) => f.name);
			expect(fnNames).toContain("create_config");
			expect(fnNames).toContain("serve");
			expect(fnNames).toContain("configure");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("Config");
			expect(classNames).toContain("Status");
			expect(classNames).toContain("Configurable");

			const imports = facts.filter((f) => f.tags.includes("import"));
			const importNames = imports.map((f) => f.name);
			expect(importNames).toContain("HashMap");
			expect(importNames).toContain("utils");

			for (const f of facts) {
				expect(f.tags).toContain("rust");
			}
		});
	});

	describe("Java (.java)", () => {
		it("extracts class, interface, method, import", () => {
			const java = `
package com.example;

import java.util.List;
import java.util.Map;

public class UserService {
    private final Database db;

    public UserService(Database db) {
        this.db = db;
    }

    public List<User> findAll() {
        return db.query("SELECT * FROM users");
    }

    private void validate(User user) {
        // validation logic
    }
}

interface Repository {
    void save(Object entity);
}

enum Role {
    ADMIN,
    USER,
}
`;
			const facts = extractTierA(java, "src/main/java/UserService.java");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("UserService");
			expect(classNames).toContain("Repository");
			expect(classNames).toContain("Role");

			const fns = facts.filter((f) => f.tags.includes("function"));
			const fnNames = fns.map((f) => f.name);
			expect(fnNames).toContain("findAll");
			expect(fnNames).toContain("validate");

			const imports = facts.filter((f) => f.tags.includes("import"));
			expect(imports.length).toBeGreaterThanOrEqual(2);

			for (const f of facts) {
				expect(f.tags).toContain("java");
			}
		});
	});

	describe("Kotlin (.kt)", () => {
		it("extracts fun, class, data class, object, interface, import", () => {
			const kt = `
package com.example

import kotlinx.coroutines.launch

data class User(val name: String, val age: Int)

class UserRepository {
    fun findById(id: String): User? = null

    suspend fun fetchAll(): List<User> = emptyList()
}

object Singleton {
    val instance = "hello"
}

interface Cacheable {
    fun invalidate()
}
`;
			const facts = extractTierA(kt, "src/main/kotlin/User.kt");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("User");
			expect(classNames).toContain("UserRepository");
			expect(classNames).toContain("Singleton");
			expect(classNames).toContain("Cacheable");

			const fns = facts.filter((f) => f.tags.includes("function"));
			const fnNames = fns.map((f) => f.name);
			expect(fnNames).toContain("findById");
			expect(fnNames).toContain("fetchAll");

			for (const f of facts) {
				expect(f.tags).toContain("kotlin");
			}
		});
	});

	describe("Swift (.swift)", () => {
		it("extracts func, class, struct, enum, protocol, import", () => {
			const swift = `
import Foundation

class NetworkManager {
    func fetchData(from url: URL) -> Data? {
        return nil
    }
}

struct Config {
    let host: String
    let port: Int
}

enum Environment {
    case development
    case production
}

protocol Configurable {
    func configure()
}
`;
			const facts = extractTierA(swift, "Sources/Network.swift");

			const fns = facts.filter((f) => f.tags.includes("function"));
			expect(fns.map((f) => f.name)).toContain("fetchData");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("NetworkManager");
			expect(classNames).toContain("Config");
			expect(classNames).toContain("Environment");
			expect(classNames).toContain("Configurable");

			for (const f of facts) {
				expect(f.tags).toContain("swift");
			}
		});
	});

	describe("PHP (.php)", () => {
		it("extracts function, class, interface, trait, use", () => {
			const php = `<?php
namespace App\\Services;

use App\\Models\\User;
use Illuminate\\Support\\Collection;

class UserService {
    public function findUser(int $id): ?User {
        return User::find($id);
    }
}

interface Cacheable {
    public function cache(): void;
}

trait HasTimestamps {
    public function getCreatedAt(): string {
        return $this->created_at;
    }
}

function helper_function(): string {
    return "hello";
}
`;
			const facts = extractTierA(php, "app/Services/UserService.php");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("UserService");
			expect(classNames).toContain("Cacheable");
			expect(classNames).toContain("HasTimestamps");

			const fns = facts.filter((f) => f.tags.includes("function"));
			expect(fns.map((f) => f.name)).toContain("helper_function");

			for (const f of facts) {
				expect(f.tags).toContain("php");
			}
		});
	});

	describe("Ruby (.rb)", () => {
		it("extracts def, class, module, require", () => {
			const rb = `
require "json"
require_relative "./helpers"

class DataProcessor
  def initialize(config)
    @config = config
  end

  def process(data)
    data.map { |item| transform(item) }
  end
end

module Helpers
  def self.format(value)
    value.to_s
  end
end

def standalone_function
  puts "hello"
end
`;
			const facts = extractTierA(rb, "lib/processor.rb");

			const fns = facts.filter((f) => f.tags.includes("function"));
			expect(fns.map((f) => f.name)).toContain("process");
			expect(fns.map((f) => f.name)).toContain("standalone_function");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("DataProcessor");
			expect(classNames).toContain("Helpers");

			const imports = facts.filter((f) => f.tags.includes("import"));
			expect(imports.map((f) => f.name)).toContain("json");
			expect(imports.map((f) => f.name)).toContain("./helpers");

			for (const f of facts) {
				expect(f.tags).toContain("ruby");
			}
		});
	});

	describe("Scala (.scala)", () => {
		it("extracts def, class, object, trait, case class, import", () => {
			const scala = `
package com.example

import scala.concurrent.Future

case class User(name: String, age: Int)

class UserService {
  def findById(id: String): Option[User] = None
}

object UserService {
  def apply(): UserService = new UserService()
}

trait Repository {
  def save(entity: Any): Unit
}
`;
			const facts = extractTierA(scala, "src/main/scala/User.scala");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("User");
			expect(classNames).toContain("UserService"); // class or object
			expect(classNames).toContain("Repository");

			const fns = facts.filter((f) => f.tags.includes("function"));
			expect(fns.map((f) => f.name)).toContain("findById");

			for (const f of facts) {
				expect(f.tags).toContain("scala");
			}
		});
	});

	describe("Elixir (.ex, .exs)", () => {
		it("extracts def/defp, defmodule, import/alias/use", () => {
			const ex = `
defmodule MyApp.UserController do
  use MyApp.Web, :controller
  import Ecto.Query
  alias MyApp.Repo

  def index(conn, _params) do
    users = Repo.all(User)
    render(conn, "index.html", users: users)
  end

  defp authorize(conn) do
    # private function
  end
end
`;
			const facts = extractTierA(ex, "lib/my_app/user_controller.ex");

			const fns = facts.filter((f) => f.tags.includes("function"));
			const fnNames = fns.map((f) => f.name);
			expect(fnNames).toContain("index");
			expect(fnNames).toContain("authorize");

			const classes = facts.filter((f) => f.tags.includes("class"));
			expect(classes.map((f) => f.name)).toContain("MyApp.UserController");

			const imports = facts.filter((f) => f.tags.includes("import"));
			const importNames = imports.map((f) => f.name);
			expect(importNames).toContain("Ecto.Query");

			for (const f of facts) {
				expect(f.tags).toContain("elixir");
			}
		});

		it("also works for .exs extension", () => {
			const exs = `
defmodule MyApp.MixProject do
  def project do
    [app: :my_app]
  end
end
`;
			const facts = extractTierA(exs, "mix.exs");
			expect(facts.length).toBeGreaterThanOrEqual(1);
			for (const f of facts) {
				expect(f.tags).toContain("elixir");
			}
		});
	});

	describe("Dart (.dart)", () => {
		it("extracts functions, class, mixin, extension, import", () => {
			const dart = `
import 'package:flutter/material.dart';

class MyWidget extends StatelessWidget {
  Widget build(BuildContext context) {
    return Container();
  }
}

mixin Logging {
  void log(String message) {
    print(message);
  }
}

extension StringExt on String {
  String capitalize() => this[0].toUpperCase() + substring(1);
}

void main() {
  runApp(MyWidget());
}
`;
			const facts = extractTierA(dart, "lib/main.dart");

			const classes = facts.filter((f) => f.tags.includes("class"));
			const classNames = classes.map((f) => f.name);
			expect(classNames).toContain("MyWidget");
			expect(classNames).toContain("Logging");
			expect(classNames).toContain("StringExt");

			const fns = facts.filter((f) => f.tags.includes("function"));
			expect(fns.map((f) => f.name)).toContain("main");

			for (const f of facts) {
				expect(f.tags).toContain("dart");
			}
		});
	});

	describe("edge cases", () => {
		it("returns [] for unknown extension", () => {
			const facts = extractTierA("some content", "file.unknown");
			expect(facts).toEqual([]);
		});

		it("returns [] for empty content", () => {
			const facts = extractTierA("", "app.ts");
			expect(facts).toEqual([]);
		});

		it("returns [] for no extension", () => {
			const facts = extractTierA("function foo() {}", "Makefile");
			expect(facts).toEqual([]);
		});

		it("deduplicates by name+category", () => {
			const ts = `
function foo() { return 1; }
const x = foo();
const y = foo();
`;
			const facts = extractTierA(ts, "test.ts");
			const fooCalls = facts.filter((f) => f.name === "foo" && f.tags.includes("call"));
			// Should deduplicate calls with same name
			expect(fooCalls.length).toBe(1);
		});

		it("content field contains surrounding lines", () => {
			const ts = `line1
line2
export function myFunc() {
  return true;
}
line6`;
			const facts = extractTierA(ts, "test.ts");
			const fn = facts.find((f) => f.name === "myFunc" && f.tags.includes("function"));
			expect(fn).toBeDefined();
			expect(fn?.content).toContain("myFunc");
			expect(fn?.content.length).toBeGreaterThan(0);
		});
	});
});
