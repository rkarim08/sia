;; Functions
(function_declaration name: (identifier) @name) @function
(lexical_declaration (variable_declarator name: (identifier) @name value: (arrow_function))) @function
(lexical_declaration (variable_declarator name: (identifier) @name value: (function_expression))) @function

;; Classes
(class_declaration name: (identifier) @name) @class

;; Methods
(method_definition name: (property_identifier) @name) @method

;; Exports
(export_statement declaration: (_) @exported)
