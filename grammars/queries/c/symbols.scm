;; Functions
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @function

;; Structs
(struct_specifier name: (type_identifier) @name) @struct

;; Enums
(enum_specifier name: (type_identifier) @name) @enum

;; Type definitions
(type_definition declarator: (type_identifier) @name) @typedef
