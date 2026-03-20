;; Functions (def/defp)
(call target: (identifier) @_fn (#match? @_fn "^def(p)?$") (arguments (identifier) @name)) @function

;; Modules (defmodule)
(call target: (identifier) @_fn (#eq? @_fn "defmodule") (arguments (alias) @name)) @module

;; Macros (defmacro/defmacrop)
(call target: (identifier) @_fn (#match? @_fn "^defmacro(p)?$") (arguments (identifier) @name)) @macro
