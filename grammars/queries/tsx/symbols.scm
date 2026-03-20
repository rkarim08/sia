;; Functions
(function_declaration name: (identifier) @name) @function
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function
(lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @function

;; Classes
(class_declaration name: (type_identifier) @name) @class
(abstract_class_declaration name: (type_identifier) @name) @class

;; Interfaces, types, enums
(interface_declaration name: (type_identifier) @name) @interface
(type_alias_declaration name: (type_identifier) @name) @type
(enum_declaration name: (identifier) @name) @enum

;; Methods
(method_definition name: (property_identifier) @name) @method

;; Exports
(export_statement declaration: (_) @exported)
