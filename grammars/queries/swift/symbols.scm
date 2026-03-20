;; Functions
(function_declaration name: (simple_identifier) @name) @function

;; Classes
(class_declaration name: (type_identifier) @name) @class

;; Structs
(struct_declaration name: (type_identifier) @name) @struct

;; Enums
(enum_declaration name: (type_identifier) @name) @enum

;; Protocols
(protocol_declaration name: (type_identifier) @name) @protocol
