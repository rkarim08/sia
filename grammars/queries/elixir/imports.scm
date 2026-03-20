(call target: (identifier) @_fn (#eq? @_fn "alias") (arguments (alias) @imported_name)) @alias
(call target: (identifier) @_fn (#eq? @_fn "import") (arguments (alias) @imported_name)) @import
(call target: (identifier) @_fn (#eq? @_fn "use") (arguments (alias) @imported_name)) @use
