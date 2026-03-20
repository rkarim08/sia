;; Value / function bindings
(let_binding pattern: (value_name) @name) @binding

;; Type definitions
(type_definition (type_binding (type_constructor) @name)) @type

;; Module definitions
(module_definition (module_binding (module_name) @name)) @module
