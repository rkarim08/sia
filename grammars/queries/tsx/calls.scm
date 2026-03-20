(call_expression function: (identifier) @callee) @call
(call_expression function: (member_expression property: (property_identifier) @callee)) @call
(new_expression constructor: (identifier) @callee) @new_call
