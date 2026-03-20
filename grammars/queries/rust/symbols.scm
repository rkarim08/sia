;; Functions
(function_item name: (identifier) @name) @function

;; Structs
(struct_item name: (type_identifier) @name) @struct

;; Enums
(enum_item name: (type_identifier) @name) @enum

;; Traits
(trait_item name: (type_identifier) @name) @trait

;; Impl blocks
(impl_item type: (type_identifier) @name) @impl

;; Type aliases
(type_item name: (type_identifier) @name) @type
