;; Functions
(function_definition name: (identifier) @name) @function

;; Classes
(class_definition name: (identifier) @name) @class

;; Decorated definitions
(decorated_definition definition: (function_definition name: (identifier) @name)) @function
(decorated_definition definition: (class_definition name: (identifier) @name)) @class
