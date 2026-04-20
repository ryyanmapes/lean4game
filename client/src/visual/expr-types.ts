export type Op = '+' | '-' | '*' | '/' | '=' | '<' | '>' | '≤' | '≥' | '∧' | '∨' | '→'

export type ExpressionNode =
  | { type: 'binary';   op: Op; left: ExpressionNode; right: ExpressionNode; id: string }
  | { type: 'variable'; name: string; id: string }
  | { type: 'constant'; value: number; id: string }
  | { type: 'app';      func: string; arg: ExpressionNode; id: string }
