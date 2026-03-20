;; Functions
(function_declaration name: (identifier) @name) @function

;; Methods
(method_declaration name: (field_identifier) @name) @method

;; Type declarations (structs, interfaces, etc.)
(type_declaration (type_spec name: (type_identifier) @name)) @type
