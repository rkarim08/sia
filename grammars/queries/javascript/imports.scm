(import_statement (import_clause (named_imports (import_specifier name: (identifier) @imported_name))) source: (string) @source) @import
(import_statement (import_clause (identifier) @imported_name) source: (string) @source) @import
(import_statement (import_clause (namespace_import (identifier) @imported_name)) source: (string) @source) @import
(call_expression function: (identifier) @_fn (#eq? @_fn "require") arguments: (arguments (string) @source)) @require
