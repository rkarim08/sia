;; Functions
(function_definition declarator: (function_declarator declarator: (identifier) @name)) @function
(function_definition declarator: (function_declarator declarator: (qualified_identifier name: (identifier) @name))) @function

;; Classes
(class_specifier name: (type_identifier) @name) @class

;; Structs
(struct_specifier name: (type_identifier) @name) @struct

;; Namespaces
(namespace_definition name: (namespace_identifier) @name) @namespace

;; Enums
(enum_specifier name: (type_identifier) @name) @enum
