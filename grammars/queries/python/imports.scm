(import_statement name: (dotted_name) @imported_name) @import
(import_from_statement module_name: (dotted_name) @source name: (dotted_name) @imported_name) @import
(import_from_statement module_name: (dotted_name) @source name: (aliased_import alias: (identifier) @imported_name)) @import
(import_from_statement module_name: (relative_import) @source name: (dotted_name) @imported_name) @import
