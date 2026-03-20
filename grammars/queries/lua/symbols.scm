;; Named function declarations
(function_declaration name: (identifier) @name) @function
(function_declaration name: (dot_index_expression) @name) @function

;; Local functions
(local_function_statement name: (identifier) @name) @function

;; Assignments with function values
(assignment_statement (variable_list (identifier) @name) (expression_list (function_definition))) @function
