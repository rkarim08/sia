;; Functions
(function_declaration (simple_identifier) @name) @function

;; Classes
(class_declaration (type_identifier) @name) @class

;; Objects
(object_declaration (type_identifier) @name) @object

;; Interfaces
(class_declaration (modifiers) (type_identifier) @name) @interface
